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
import type { Venta } from "./gerencia";

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
