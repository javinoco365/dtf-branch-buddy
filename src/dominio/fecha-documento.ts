/**
 * La fecha con la que se emite el ticket o la factura de un pedido: la del
 * pedido, en hora de España.
 *
 * Un pedido de la tienda guarda el instante (timestamptz) y uno textil, el día.
 *
 * - Los creados en el CRM guardan el instante de verdad (UTC): se pasa a día
 *   en Europe/Madrid. Un pedido de las 00:30 del día 8 en Madrid son las 22:30
 *   del día 7 en UTC, y cortar la cadena le pondría el día anterior.
 * - Los de WooCommerce guardan `date_created`, que es la hora de la web sin
 *   zona: quedó grabada tal cual como si fuera UTC. Su día es el de la cadena;
 *   pasarla a Madrid le sumaría dos horas y un pedido de las 23:00 caería en el
 *   día siguiente.
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
 * ('2026-10-07T22:30:00Z'); con cualquier otra cosa, `hoy`. `horaDeLaWeb`:
 * el instante es la hora local de WooCommerce guardada como UTC.
 */
export function fechaDocumentoDePedido(
  fechaPedido: string | null | undefined,
  { horaDeLaWeb = false, hoy = new Date() }: { horaDeLaWeb?: boolean; hoy?: Date } = {},
): string {
  const texto = String(fechaPedido ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const instante = new Date(texto);
  if (!texto || Number.isNaN(instante.getTime())) return diaEnEspana(hoy);
  return horaDeLaWeb ? instante.toISOString().slice(0, 10) : diaEnEspana(instante);
}

/** ¿La base ha rechazado la fecha porque la serie ya tiene un documento posterior? */
export function esRechazoPorFecha(mensaje: string | null | undefined): boolean {
  return /No se puede emitir con fecha/i.test(mensaje ?? "");
}
