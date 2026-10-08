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
 * pedido es más antiguo que eso, el documento sale con la fecha de ese último
 * (la más temprana que admite la serie) y la del pedido queda escrita en él
 * como fecha de la operación: ver `fechaEmision`.
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

/**
 * La fecha con la que puede salir un documento y, si no puede ser la que se
 * quería, esa como fecha de la operación.
 *
 * La numeración es correlativa por serie y las fechas tienen que acompañarla:
 * un documento no puede llevar fecha anterior al último de su serie y año. Si
 * se quería una anterior (la de un pedido antiguo), sale con la del último, la
 * más cercana que admite la serie, y la deseada se escribe en el documento
 * como fecha de la operación, que es lo que pide el reglamento de facturación
 * cuando no coincide con la de expedición (RD 1619/2012, art. 6.1.f).
 *
 * Fechas 'yyyy-mm-dd'. `ultimaDeLaSerie`: la del último documento de la serie
 * en el año de `deseada`, o null si no hay ninguno. `hoy`: el día de hoy en
 * España; si el último es posterior a hoy, no se ajusta.
 */
export function fechaEmision(
  deseada: string,
  ultimaDeLaSerie: string | null | undefined,
  hoy: string,
): { fecha: string; fechaOperacion: string | null } {
  // Un documento con fecha futura (una errata) no arrastra a los demás a esa
  // fecha: sin ajuste, la base rechaza y dice cuál es la fecha que estorba.
  if (ultimaDeLaSerie && deseada < ultimaDeLaSerie && ultimaDeLaSerie <= hoy) {
    return { fecha: ultimaDeLaSerie, fechaOperacion: deseada };
  }
  return { fecha: deseada, fechaOperacion: null };
}

/** '2026-09-19' → '19/09/2026'. */
export function diaLegible(dia: string): string {
  const [a, m, d] = dia.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** La línea que deja escrita la fecha de la operación en el documento. */
export function notaFechaOperacion(fechaOperacion: string): string {
  return `Fecha de la operación: ${diaLegible(fechaOperacion)}`;
}

/** Las notas del documento con la fecha de la operación al final, una sola vez. */
export function notasConFechaOperacion(
  notas: string | null | undefined,
  fechaOperacion: string | null,
): string | null {
  const texto = (notas ?? "").trim();
  if (!fechaOperacion) return texto || null;
  const linea = notaFechaOperacion(fechaOperacion);
  if (texto.includes(linea)) return texto;
  return texto ? `${texto}\n${linea}` : linea;
}
