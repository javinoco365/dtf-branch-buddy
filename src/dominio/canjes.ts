/**
 * Canjes de ticket por factura, cada paso en su fecha.
 *
 * Un ticket (factura simplificada) se puede canjear por una factura completa,
 * que lo dice en `sustituye_a_id`. La venta es una sola: su IVA y su ingreso
 * tienen que contar una vez. Para que cualquier periodo dé lo mismo se mire
 * solo (Gerencia › Fiscal) o dentro de un rango mayor (los trimestres de
 * Resultados), la regla va por apuntes, cada uno en la fecha de su documento:
 *
 * - Cada documento emitido suma lo suyo en su fecha. El ticket también: el
 *   día que se emite, la venta es él.
 * - La factura de canje F resta lo del ticket T que sustituye, en la fecha
 *   de F: desde ese día la venta la cuenta F.
 * - Una rectificativa R que corrige una factura de canje F vuelve a sumar lo
 *   de T, en la fecha de R: F queda anulada y la venta vuelve a ser el
 *   ticket, como en `documentoDelPedido`.
 *
 * Emitido es todo lo que no es borrador. Una factura con estado «anulada»
 * (de antes de que la anulación fuera siempre una rectificativa) cuenta lo
 * suyo, así que también resta su ticket: si no, la venta contaría dos veces.
 *
 * Los totales de las listas de facturas no van por fechas sino por lo que se
 * ve en la lista: eso es `ticketsCanjeados` (sumatorios.ts).
 *
 * Lógica pura: se prueba sin base de datos.
 */

import type { DocumentoCanjeable } from "./sumatorios";

export type DocumentoConFecha = DocumentoCanjeable & {
  /** `yyyy-MM-dd`. */
  fecha: string;
};

export type MotivoApunte = "documento" | "canje" | "canje_anulado";

/** Lo que un documento suma o resta en su fecha. */
export type ApunteVenta<D> = {
  /** El documento que lo apunta: el apunte va en su fecha. */
  documento: D;
  /** De quién son los importes: del propio documento o del ticket canjeado. */
  importes: D;
  /** 1 suma; −1 resta. */
  signo: 1 | -1;
  motivo: MotivoApunte;
};

const emitido = <D extends DocumentoCanjeable>(d: D | undefined): d is D =>
  !!d && d.estado !== "borrador";

const antes = (a: DocumentoConFecha, b: DocumentoConFecha) =>
  a.fecha < b.fecha || (a.fecha === b.fecha && a.id < b.id);

/**
 * Los apuntes de los documentos de `docs`, cada uno en la fecha de su
 * documento. Sumando los de un periodo sale lo que cuenta en ese periodo.
 *
 * `referencias` son otros documentos conocidos (de otro periodo, de otra
 * tienda) que solo se miran, sin apuntar nada por sí mismos: el ticket de una
 * factura de canje y la factura que corrige una rectificativa. Si el ticket
 * de un canje no se conoce, no hay qué restar y la factura cuenta entera.
 *
 * Si varias rectificativas corrigen la misma factura de canje (la base solo
 * deja emitir una), el ticket vuelve una sola vez: con la primera.
 */
export function apuntesDeVenta<D extends DocumentoConFecha>(
  docs: readonly D[],
  referencias: readonly D[] = [],
): ApunteVenta<D>[] {
  const porId = new Map<string, D>();
  for (const d of referencias) porId.set(d.id, d);
  for (const d of docs) porId.set(d.id, d);

  // La primera rectificativa emitida de cada documento, entre las conocidas.
  const primeraRectificativa = new Map<string, D>();
  for (const d of porId.values()) {
    if (!emitido(d) || !d.rectifica_a_id) continue;
    const otra = primeraRectificativa.get(d.rectifica_a_id);
    if (!otra || antes(d, otra)) primeraRectificativa.set(d.rectifica_a_id, d);
  }

  // El ticket que canjea una factura emitida, si se conoce.
  const ticketCanjeado = (f: D | undefined): D | undefined => {
    if (!emitido(f) || !f.sustituye_a_id) return undefined;
    const t = porId.get(f.sustituye_a_id);
    return emitido(t) ? t : undefined;
  };

  const apuntes: ApunteVenta<D>[] = [];
  for (const d of docs) {
    if (!emitido(d)) continue;
    apuntes.push({ documento: d, importes: d, signo: 1, motivo: "documento" });
    const canjeado = ticketCanjeado(d);
    if (canjeado) {
      apuntes.push({ documento: d, importes: canjeado, signo: -1, motivo: "canje" });
    }
    if (d.rectifica_a_id && primeraRectificativa.get(d.rectifica_a_id)?.id === d.id) {
      const vuelve = ticketCanjeado(porId.get(d.rectifica_a_id));
      if (vuelve) {
        apuntes.push({ documento: d, importes: vuelve, signo: 1, motivo: "canje_anulado" });
      }
    }
  }
  return apuntes;
}
