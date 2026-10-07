/**
 * Gerencia › Fiscal: el IVA del periodo según las facturas emitidas y las
 * compras registradas, y lo que se ha vendido sin documento.
 *
 * Es una foto orientativa para saber por dónde va el trimestre. El modelo 303
 * lo presenta la gestoría con todos los gastos, también los que no pasan por
 * el CRM.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { ESTADO_CANCELADO, totalNeto } from "./kpis";
import { documentoVigente, type DocumentoPedido } from "./tickets";
import type { Venta } from "./gerencia";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type TipoDocumento = "ordinaria" | "rectificativa" | "simplificada";

/** Una factura, ticket o rectificativa, de tienda o del textil, en una sola forma. */
export type DocumentoFiscal = {
  id: string;
  tipo: TipoDocumento;
  estado: string | null;
  /** `yyyy-MM-dd`. */
  fecha: string;
  tienda_id: string;
  base: Numerico;
  iva: Numerico;
  total: Numerico;
  /** El desglose por tipo de IVA congelado al emitir: `[{tipo, base, cuota}]`. */
  desglose_iva?: { tipo: Numerico; base: Numerico; cuota: Numerico }[] | null;
};

export type CuentaFiscal = { documentos: number; base: number; iva: number; total: number };

export type ResumenIva = {
  /** Ordinarias, tickets y rectificativas emitidos (las rectificativas restan). */
  repercutido: CuentaFiscal;
  porTipoDocumento: { tipo: TipoDocumento; etiqueta: string; cuenta: CuentaFiscal }[];
  /** Por tipo de IVA (21, 10, 4…), de mayor a menor. */
  porTipoIva: { tipo: number; base: number; cuota: number }[];
  /** Borradores: no son facturas todavía y no cuentan. */
  borradores: number;
};

const ETIQUETAS: Record<TipoDocumento, string> = {
  ordinaria: "Facturas",
  simplificada: "Tickets",
  rectificativa: "Rectificativas",
};

const vacia = (): CuentaFiscal => ({ documentos: 0, base: 0, iva: 0, total: 0 });
function sumar(c: CuentaFiscal, d: DocumentoFiscal) {
  c.documentos += 1;
  c.base += num(d.base);
  c.iva += num(d.iva);
  c.total += num(d.total);
}
const cerrar = (c: CuentaFiscal): CuentaFiscal => ({
  documentos: c.documentos,
  base: redondear(c.base),
  iva: redondear(c.iva),
  total: redondear(c.total),
});

/**
 * El IVA repercutido de los documentos emitidos en el periodo, por su fecha.
 * Las rectificativas llevan importes negativos y restan solas. Sin desglose
 * guardado, el documento cuenta entero en su IVA total, bajo el tipo 0 «sin
 * desglose».
 */
export function resumenIva(docs: readonly DocumentoFiscal[]): ResumenIva {
  const total = vacia();
  const porTipo = new Map<TipoDocumento, CuentaFiscal>(
    (["ordinaria", "simplificada", "rectificativa"] as const).map((t) => [t, vacia()]),
  );
  const porIva = new Map<number, { base: number; cuota: number }>();
  let borradores = 0;

  for (const d of docs) {
    if (d.estado === "borrador") {
      borradores += 1;
      continue;
    }
    sumar(total, d);
    sumar(porTipo.get(d.tipo) ?? vacia(), d);
    const desglose = d.desglose_iva?.length
      ? d.desglose_iva
      : [{ tipo: 0, base: d.base, cuota: d.iva }];
    for (const x of desglose) {
      const t = num(x.tipo);
      const a = porIva.get(t) ?? { base: 0, cuota: 0 };
      a.base += num(x.base);
      a.cuota += num(x.cuota);
      porIva.set(t, a);
    }
  }

  return {
    repercutido: cerrar(total),
    porTipoDocumento: [...porTipo.entries()].map(([tipo, c]) => ({
      tipo,
      etiqueta: ETIQUETAS[tipo],
      cuenta: cerrar(c),
    })),
    porTipoIva: [...porIva.entries()]
      .map(([tipo, a]) => ({ tipo, base: redondear(a.base), cuota: redondear(a.cuota) }))
      .sort((a, b) => b.tipo - a.tipo),
    borradores,
  };
}

/** Una factura de compra con lo justo para el IVA. */
export type CompraResumen = { estado: string; base: Numerico; iva: Numerico; total: Numerico };

export type IvaSoportado = CuentaFiscal & {
  /** Compras subidas que aún no se han registrado: no cuentan. */
  sinRegistrar: number;
};

/** El IVA de las compras registradas del periodo. */
export function ivaSoportado(compras: readonly CompraResumen[]): IvaSoportado {
  const c = vacia();
  let sinRegistrar = 0;
  for (const x of compras) {
    if (x.estado !== "registrada") {
      sinRegistrar += 1;
      continue;
    }
    c.documentos += 1;
    c.base += num(x.base);
    c.iva += num(x.iva);
    c.total += num(x.total);
  }
  return { ...cerrar(c), sinRegistrar };
}

/** Un documento con el pedido al que pertenece, para saber qué pedidos tienen el suyo. */
export type DocumentoDePedido = DocumentoPedido & { pedido_id: string | null };

export type SinFactura = {
  pedidos: number;
  /** Lo vendido en esos pedidos, con IVA y sin devoluciones. */
  vendido: number;
};

/**
 * Los pedidos del periodo, no cancelados, que no tienen factura ni ticket
 * vigente: sin documento, o con el suyo anulado por una rectificativa.
 */
export function vendidoSinDocumento(
  ventas: readonly Venta[],
  docs: readonly DocumentoDePedido[],
): SinFactura {
  const porPedido = new Map<string, DocumentoDePedido[]>();
  const rectificados = new Set<string>();
  for (const d of docs) {
    if (d.rectifica_a_id) rectificados.add(d.rectifica_a_id);
    if (!d.pedido_id) continue;
    porPedido.set(d.pedido_id, [...(porPedido.get(d.pedido_id) ?? []), d]);
  }
  let pedidos = 0;
  let vendido = 0;
  for (const v of ventas) {
    if (v.estado === ESTADO_CANCELADO || !v.id) continue;
    if (documentoVigente(porPedido.get(v.id) ?? [], rectificados)) continue;
    pedidos += 1;
    vendido += totalNeto(v);
  }
  return { pedidos, vendido: redondear(vendido) };
}

/** IVA repercutido − soportado: positivo, a ingresar; negativo, a compensar. */
export function resultadoIva(repercutido: number, soportado: number): number {
  return redondear(repercutido - soportado);
}
