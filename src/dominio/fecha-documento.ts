/**
 * La fecha con la que se emite el ticket o la factura de un pedido: la del
 * pedido, en hora de España. Siempre la del pedido, aunque la serie ya tenga
 * un documento posterior (decisión de Javier, 8-10-2026): la numeración sigue
 * correlativa, pero un número posterior puede llevar una fecha anterior.
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

/** '2026-09-19' → '19/09/2026'. */
export function diaLegible(dia: string): string {
  const [a, m, d] = dia.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
