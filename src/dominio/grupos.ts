/**
 * Los dos grandes grupos de números de Gerencia.
 *
 *   A · Documentado: lo que lleva factura o ticket. Es lo que cuenta para
 *       Hacienda: el IVA, las retenciones y Sociedades salen solo de aquí.
 *   B · Sin documento: pedidos sin factura ni ticket vigente. Toda venta
 *       tiene que llevar su documento, así que esto es lo pendiente de
 *       documentar: al emitir el ticket, el pedido pasa solo a A.
 *   Total negocio: A + B, sin contar nada dos veces.
 *
 * Los gastos van a A si tienen factura o justificante y a B si no: un gasto
 * sin justificante es coste del negocio, pero no rebaja ningún impuesto.
 *
 * El grupo no se elige a mano: sale de si existe un documento vigente (el
 * mismo criterio con el que la base se niega a emitir un segundo documento
 * para un pedido). Así no se puede equivocar ni manipular.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { ESTADO_CANCELADO, totalNeto } from "./kpis";
import { documentoVigente } from "./tickets";
import type { DocumentoDePedido, DocumentoFiscal } from "./fiscal";
import { beneficioEstimado, cifrasGerencia, type GastoFijo, type Venta } from "./gerencia";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type Grupo = "total" | "a" | "b";

export const GRUPOS: readonly { valor: Grupo; etiqueta: string; corta: string }[] = [
  { valor: "total", etiqueta: "Total negocio", corta: "Total" },
  { valor: "a", etiqueta: "Documentado (A)", corta: "A" },
  { valor: "b", etiqueta: "Sin documento (B)", corta: "B" },
];

export function esGrupo(v: unknown): v is Grupo {
  return GRUPOS.some((g) => g.valor === v);
}

/** Los pedidos que tienen una factura o un ticket vigente. */
export function pedidosDocumentados(docs: readonly DocumentoDePedido[]): Set<string> {
  const porPedido = new Map<string, DocumentoDePedido[]>();
  const rectificados = new Set<string>();
  for (const d of docs) {
    if (d.rectifica_a_id) rectificados.add(d.rectifica_a_id);
    if (!d.pedido_id) continue;
    porPedido.set(d.pedido_id, [...(porPedido.get(d.pedido_id) ?? []), d]);
  }
  const documentados = new Set<string>();
  for (const [pedido, lista] of porPedido) {
    if (documentoVigente(lista, rectificados)) documentados.add(pedido);
  }
  return documentados;
}

/** Las ventas de un grupo. Un pedido sin identificar cuenta como B. */
export function ventasDelGrupo<T extends Pick<Venta, "id">>(
  ventas: readonly T[],
  documentados: ReadonlySet<string>,
  grupo: Grupo,
): T[] {
  if (grupo === "total") return [...ventas];
  return ventas.filter((v) => (v.id ? documentados.has(v.id) : false) === (grupo === "a"));
}

/** Un gasto sin la marca (antes de la migración) tiene justificante. */
export function conJustificante(g: Pick<GastoFijo, "con_justificante">): boolean {
  return g.con_justificante !== false;
}

/** Los gastos de un grupo: A, con justificante; B, sin él; total, todos. */
export function gastosDelGrupo<T extends Pick<GastoFijo, "con_justificante">>(
  gastos: readonly T[],
  grupo: Grupo,
): T[] {
  if (grupo === "total") return [...gastos];
  return gastos.filter((g) => conJustificante(g) === (grupo === "a"));
}

export type CostesDelRango = Record<Grupo, number> & {
  /** Compras que cuestan el día de la factura (siempre A). */
  compras: number;
  /** Amortización de máquinas y equipos (siempre A). */
  amortizacion: number;
  hastaHoy: boolean;
};

/**
 * Los costes de estructura de un rango, sin IVA: los gastos fijos de cada
 * grupo, y aparte las compras y las amortizaciones (ver compras.ts). Con
 * `hoy`, solo hasta hoy si el rango sigue en curso (como el beneficio
 * estimado).
 */
export function gastosFijosPorGrupo(
  gastos: readonly GastoFijo[],
  r: { desde: Date; hasta: Date },
  hoy?: Date,
): CostesDelRango {
  const de = (lista: readonly GastoFijo[]) => beneficioEstimado(0, lista, r, hoy);
  const fijos = gastos.filter((g) => (g.origen ?? "gasto") === "gasto");
  const a = de(gastosDelGrupo(fijos, "a"));
  const b = de(gastosDelGrupo(fijos, "b"));
  return {
    a: a.gastos,
    b: b.gastos,
    total: redondear(a.gastos + b.gastos),
    compras: de(gastos.filter((g) => g.origen === "compra")).gastos,
    amortizacion: de(gastos.filter((g) => g.origen === "amortizacion")).gastos,
    hastaHoy: a.hastaHoy,
  };
}

export type PendienteDocumentar = {
  pedidos: number;
  /** Con IVA y sin devoluciones. */
  vendido: number;
  /** Por tienda (o TIENDA_TEXTIL.id), para mandar a emitir los tickets donde toca. */
  porTienda: { tienda_id: string; pedidos: number; vendido: number }[];
};

/** Los pedidos no cancelados de B: lo que falta por documentar. */
export function pendienteDocumentar(
  ventas: readonly Venta[],
  documentados: ReadonlySet<string>,
): PendienteDocumentar {
  const porTienda = new Map<string, { tienda_id: string; pedidos: number; vendido: number }>();
  let pedidos = 0;
  let vendido = 0;
  for (const v of ventasDelGrupo(ventas, documentados, "b")) {
    if (v.estado === ESTADO_CANCELADO) continue;
    const t = porTienda.get(v.tienda_id) ?? { tienda_id: v.tienda_id, pedidos: 0, vendido: 0 };
    t.pedidos += 1;
    t.vendido += totalNeto(v);
    porTienda.set(v.tienda_id, t);
    pedidos += 1;
    vendido += totalNeto(v);
  }
  return {
    pedidos,
    vendido: redondear(vendido),
    porTienda: [...porTienda.values()]
      .map((t) => ({ ...t, vendido: redondear(t.vendido) }))
      .sort((a, b) => b.vendido - a.vendido),
  };
}

/**
 * Lo facturado que no sale de ningún pedido (una factura manual), sin IVA:
 * es A, aunque no esté en las ventas. Las rectificativas de esas facturas
 * restan; las de facturas de pedidos no, porque ese pedido ya salió de A al
 * quedarse sin documento vigente.
 */
export function facturadoSinPedido(docs: readonly DocumentoFiscal[]): number {
  const sinPedido = new Set(
    docs.filter((d) => d.tipo !== "rectificativa" && !d.pedido_id).map((d) => d.id),
  );
  let base = 0;
  for (const d of docs) {
    if (d.estado === "borrador") continue;
    if (d.tipo === "rectificativa") {
      if (d.rectifica_a_id && sinPedido.has(d.rectifica_a_id)) base += num(d.base);
      continue;
    }
    if (!d.pedido_id) base += num(d.base);
  }
  return redondear(base);
}

export type ColumnaResultados = {
  /** Sin IVA. */
  ingresos: number;
  produccion: number;
  envios: number;
  ropa: number;
  margen: number;
  costesFijos: number;
  /** Facturas de compra que cuestan el día de la factura. */
  compras: number;
  amortizacion: number;
  bai: number;
  sociedades: number;
  neto: number;
};

/**
 * La cuenta de resultados en tres columnas: A, B y el total.
 *
 * - A: las ventas con documento y lo facturado sin pedido, los gastos con
 *   justificante, las compras y amortizaciones (todas llevan factura) y el
 *   Impuesto sobre Sociedades, que se calcula solo sobre A.
 * - B: las ventas sin documento, su coste variable y los gastos sin
 *   justificante. Sin impuesto.
 * - Total: A + B. El impuesto es el de A.
 */
export function resultadosPorGrupo(d: {
  ventas: readonly Venta[];
  documentados: ReadonlySet<string>;
  costeActual: number;
  facturadoSinPedido: number;
  /** Los gastos fijos del periodo de cada grupo, sin IVA. */
  costesFijos: { a: number; b: number };
  /** Compras y amortizaciones del periodo, sin IVA: van en A. */
  compras?: number;
  amortizacion?: number;
  tipoIs: number;
}): { a: ColumnaResultados; b: ColumnaResultados; total: ColumnaResultados } {
  const columna = (
    ventas: readonly Venta[],
    extra: number,
    fijos: number,
    compras: number,
    amortizacion: number,
    conIs: boolean,
  ) => {
    const c = cifrasGerencia(ventas, d.costeActual);
    const ingresos = redondear(c.bruta + extra);
    const margen = redondear(ingresos - c.coste);
    const bai = redondear(margen - fijos - compras - amortizacion);
    const sociedades = conIs && bai > 0 ? redondear((bai * d.tipoIs) / 100) : 0;
    return {
      ingresos,
      produccion: c.costeDtf,
      envios: c.costeEnvios,
      ropa: c.costeTextil,
      margen,
      costesFijos: redondear(fijos),
      compras: redondear(compras),
      amortizacion: redondear(amortizacion),
      bai,
      sociedades,
      neto: redondear(bai - sociedades),
    };
  };
  const a = columna(
    ventasDelGrupo(d.ventas, d.documentados, "a"),
    d.facturadoSinPedido,
    d.costesFijos.a,
    d.compras ?? 0,
    d.amortizacion ?? 0,
    true,
  );
  const b = columna(ventasDelGrupo(d.ventas, d.documentados, "b"), 0, d.costesFijos.b, 0, 0, false);
  const suma = (k: keyof ColumnaResultados) => redondear(a[k] + b[k]);
  const total: ColumnaResultados = {
    ingresos: suma("ingresos"),
    produccion: suma("produccion"),
    envios: suma("envios"),
    ropa: suma("ropa"),
    margen: suma("margen"),
    costesFijos: suma("costesFijos"),
    compras: suma("compras"),
    amortizacion: suma("amortizacion"),
    bai: suma("bai"),
    sociedades: a.sociedades,
    neto: redondear(suma("bai") - a.sociedades),
  };
  return { a, b, total };
}
