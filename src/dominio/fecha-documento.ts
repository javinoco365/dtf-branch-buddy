/**
 * La fecha con la que se emite el ticket o la factura de un pedido: la del
 * pedido, en hora de España.
 *
 * Un pedido de la tienda guarda el instante (timestamptz) y uno textil, el día.
 * El instante se pasa a día en Europe/Madrid, no en UTC: un pedido de las
 * 00:30 del día 8 en Madrid son las 22:30 del día 7 en UTC, y cortar la cadena
 * ISO le pondría al ticket el día anterior.
 *
 * La base sigue mandando: no deja emitir con una fecha anterior a la última
 * factura de la serie (la numeración tiene que ir en orden de fechas). Si el
 * pedido es más antiguo que eso, la emisión se rechaza con ese motivo y la
 * fecha se puede cambiar a mano.
 */

const ZONA = "Europe/Madrid";

/** El día ('yyyy-mm-dd') de un instante en hora de España. */
export function diaEnEspana(instante: Date): string {
  // en-CA escribe las fechas como yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/**
 * El día del pedido. Acepta un día ('2026-10-07') o un instante
 * ('2026-10-07T22:30:00Z'); con cualquier otra cosa, `hoy`.
 */
export function fechaDocumentoDePedido(
  fechaPedido: string | null | undefined,
  hoy: Date = new Date(),
): string {
  const texto = String(fechaPedido ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const instante = new Date(texto);
  if (!texto || Number.isNaN(instante.getTime())) return diaEnEspana(hoy);
  return diaEnEspana(instante);
}
