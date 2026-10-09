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
import { apuntesDeVenta } from "./canjes";
import type { DocumentoPedido } from "./tickets";
import { pedidosDocumentados, pendienteDocumentar } from "./grupos";
import type { Venta } from "./gerencia";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type TipoDocumento = "ordinaria" | "rectificativa" | "simplificada";

/** Una factura, ticket o rectificativa, de tienda o del textil, en una sola forma. */
export type DocumentoFiscal = {
  id: string;
  /** El pedido del que sale, si sale de uno. */
  pedido_id?: string | null;
  /** Solo rectificativas: el documento que corrigen. */
  rectifica_a_id?: string | null;
  /** Solo facturas de canje: el ticket al que sustituyen. */
  sustituye_a_id?: string | null;
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
  /**
   * Lo que cuenta en el periodo: ordinarias, tickets y rectificativas
   * emitidos (las rectificativas restan) y los canjes de ticket por factura
   * (`canjes`). `documentos` son los emitidos del periodo.
   */
  repercutido: CuentaFiscal;
  /** Lo de cada documento emitido en el periodo, por tipo, sin los canjes. */
  porTipoDocumento: { tipo: TipoDocumento; etiqueta: string; cuenta: CuentaFiscal }[];
  /** Por tipo de IVA (21, 10, 4…), de mayor a menor, con los canjes. */
  porTipoIva: { tipo: number; base: number; cuota: number }[];
  /** Borradores: no son facturas todavía y no cuentan. */
  borradores: number;
  /** Lo que mueven en el periodo los canjes de ticket por factura (ver canjes.ts). */
  canjes: CuentaCanjes;
};

/**
 * Los canjes de ticket por factura de un periodo. El ticket ya contó el día
 * que se emitió: la factura del canje resta lo suyo, y la rectificativa que
 * anula esa factura lo vuelve a sumar.
 */
export type CuentaCanjes = {
  /** Facturas del periodo que canjean un ticket: restan lo del ticket. */
  canjes: number;
  /** Rectificativas del periodo que anulan una factura de canje: lo del ticket vuelve. */
  anulados: number;
  base: number;
  iva: number;
  total: number;
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
 *
 * Un ticket canjeado por factura cuenta una sola vez, cada paso en su fecha
 * (`apuntesDeVenta`): el ticket suma el día que se emite, la factura del
 * canje resta lo del ticket el día de la factura, y una rectificativa que
 * anule esa factura lo vuelve a sumar el día de la rectificativa. Así un
 * periodo da lo mismo aquí que en los trimestres de Resultados.
 *
 * `docs` son los documentos del periodo. `referencias`, los de fuera que
 * hacen falta para casar los canjes: el ticket de cada factura de canje y la
 * factura (y su ticket) de cada rectificativa. Solo se miran: no cuentan.
 */
export function resumenIva(
  docs: readonly DocumentoFiscal[],
  referencias: readonly DocumentoFiscal[] = [],
): ResumenIva {
  const total = vacia();
  const porTipo = new Map<TipoDocumento, CuentaFiscal>(
    (["ordinaria", "simplificada", "rectificativa"] as const).map((t) => [t, vacia()]),
  );
  const canjes = { canjes: 0, anulados: 0, base: 0, iva: 0, total: 0 };
  const porIva = new Map<number, { base: number; cuota: number }>();

  for (const a of apuntesDeVenta(docs, referencias)) {
    const x = a.importes;
    const s = a.signo;
    total.base += s * num(x.base);
    total.iva += s * num(x.iva);
    total.total += s * num(x.total);
    if (a.motivo === "documento") {
      total.documentos += 1;
      sumar(porTipo.get(x.tipo) ?? vacia(), x);
    } else {
      if (a.motivo === "canje") canjes.canjes += 1;
      else canjes.anulados += 1;
      canjes.base += s * num(x.base);
      canjes.iva += s * num(x.iva);
      canjes.total += s * num(x.total);
    }
    const desglose = x.desglose_iva?.length
      ? x.desglose_iva
      : [{ tipo: 0, base: x.base, cuota: x.iva }];
    for (const l of desglose) {
      const t = num(l.tipo);
      const acc = porIva.get(t) ?? { base: 0, cuota: 0 };
      acc.base += s * num(l.base);
      acc.cuota += s * num(l.cuota);
      porIva.set(t, acc);
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
    borradores: docs.filter((d) => d.estado === "borrador").length,
    canjes: {
      canjes: canjes.canjes,
      anulados: canjes.anulados,
      base: redondear(canjes.base),
      iva: redondear(canjes.iva),
      total: redondear(canjes.total),
    },
  };
}

/** Una factura de compra con lo justo para el IVA. */
export type CompraResumen = {
  id?: string;
  estado: string;
  base: Numerico;
  iva: Numerico;
  /** Retención de IRPF de la factura, en euros. */
  irpf?: Numerico;
  total: Numerico;
  /** `yyyy-MM-dd`; para repartir por trimestres. */
  fecha?: string;
  /** Sin migración de compras generales, todas son de textil. */
  categoria?: string | null;
  /** El gasto fijo del que es factura. */
  gasto_id?: string | null;
  /** Calculados por la base (migración 20261014100000); ver compras.ts. */
  cuota_iva?: Numerico;
  cuota_irpf?: Numerico;
  liquido?: Numerico;
  liquido_origen?: string | null;
  /** Borrado lógico: si tiene fecha, no cuenta. */
  borrada_en?: string | null;
};

export type IvaSoportado = CuentaFiscal & {
  /** IRPF retenido en esas facturas. */
  irpf: number;
  /** Compras subidas que aún no se han registrado: no cuentan. */
  sinRegistrar: number;
};

/** El IVA de las compras registradas del periodo. */
export function ivaSoportado(compras: readonly CompraResumen[]): IvaSoportado {
  const c = vacia();
  let irpf = 0;
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
    irpf += num(x.irpf);
  }
  return { ...cerrar(c), irpf: redondear(irpf), sinRegistrar };
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
  const p = pendienteDocumentar(ventas, pedidosDocumentados(docs));
  return { pedidos: p.pedidos, vendido: p.vendido };
}

/** IVA repercutido − soportado: positivo, a ingresar; negativo, a compensar. */
export function resultadoIva(repercutido: number, soportado: number): number {
  return redondear(repercutido - soportado);
}
