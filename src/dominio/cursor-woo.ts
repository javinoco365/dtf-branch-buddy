/**
 * Por dónde va la sincronización con WooCommerce y qué página pedir después.
 *
 * Lógica pura: ni red ni base de datos. La usa `sincronizarWoo`
 * (src/lib/woocommerce.functions.ts), que hace las llamadas.
 *
 * ## El problema
 *
 * La sincronización pedía UNA página de 100 pedidos (los más recientes), una de
 * 100 clientes y una de 100 productos. Si entre dos sincronizaciones entraban
 * más de 100 pedidos, los más antiguos de ese tramo no llegaban nunca: la
 * siguiente vez ya había otros 100 por delante. Y un pedido viejo que cambiaba
 * de estado en WooCommerce no se enteraba aquí si no estaba entre esos 100.
 *
 * ## Cómo se recorre ahora
 *
 * Por fecha de modificación, de la más vieja a la más nueva (`orderby=modified`,
 * `order=asc`), y solo lo modificado desde el cursor (`modified_after`). Un
 * pedido nuevo también entra: su fecha de modificación es la de creación o una
 * posterior.
 *
 * Después de cada página el cursor pasa a la fecha de modificación más reciente
 * de esa página, y se vuelve a pedir la página 1 desde ahí. No se pide la
 * página 2 de la misma consulta porque, si entretanto se modifica un pedido de
 * la página 1, ese pedido se va al final de la lista y todos los demás se
 * corren un puesto: el primero de la página 2 no se vería nunca.
 *
 * Se pide desde un segundo ANTES del cursor. WordPress compara con «>» y las
 * fechas van al segundo: sin ese margen, un pedido modificado en el mismo
 * segundo que el último de la página, pero que cayó en la siguiente, se
 * quedaría fuera. Lo que se repite se vuelve a guardar igual: el upsert por
 * `(tienda_id, woo_order_id)` es idempotente.
 *
 * Si una página entera tiene la misma fecha que el cursor (una acción masiva en
 * WooCommerce que cambia cientos de pedidos en el mismo segundo), el cursor no
 * avanza; entonces sí se pide la página siguiente de la misma consulta.
 * WooCommerce desempata por id, así que ese orden es estable.
 *
 * ## La hora
 *
 * Con `dates_are_gmt=true` WooCommerce compara con la fecha GMT. WordPress lee
 * una fecha SIN zona como hora de pared y la usa tal cual; con «Z» la pasaría a
 * la hora de la tienda y el corte se movería una o dos horas, dejando fuera lo
 * modificado en ese rato. Por eso `modified_after` va sin zona.
 */

/** Lo máximo que deja pedir la API de WooCommerce por página. */
export const POR_PAGINA_WOO = 100;

/**
 * Cuánto trabajo hace una llamada a `sincronizarWoo` como mucho. Una página de
 * 100 pedidos completos tarda unos segundos entre WooCommerce y la base; con
 * esto una tanda se queda por debajo de lo que una función en Vercel puede
 * tardar. Lo que no cabe lo hace la tanda siguiente, desde donde se quedó.
 */
export const TANDA_WOO = { paginas: 5, milisegundos: 10_000 } as const;

/**
 * Páginas de productos o de clientes nuevos en una sincronización: 2.000 de
 * cada. Muy por encima de lo que cambia entre dos sincronizaciones; si se
 * alcanza, se avisa.
 */
export const PAGINAS_MAX_CATALOGO = 20;

/**
 * Página más alta que se pide de una misma consulta: solo se pasa de la 1
 * cuando cientos de pedidos comparten el mismo segundo de modificación.
 * 100 páginas son 10.000 pedidos en un segundo: si se llega, algo va mal.
 */
export const PAGINA_MAXIMA_WOO = 100;

/** Tandas seguidas que lanza la pantalla antes de parar y avisar. */
export const TANDAS_MAX_WOO = 200;

const MARGEN_MS = 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Dónde está la sincronización: la fecha de modificación (ISO, UTC) del último
 * elemento traído, y qué página pedir de la consulta desde esa fecha.
 * `desde: null` es «desde el principio».
 */
export type CursorWoo = { desde: string | null; pagina: number };

/** Lo mínimo de un pedido o producto de WooCommerce para mover el cursor. */
export type ModificadoWoo = {
  date_modified_gmt?: string | null;
  date_created_gmt?: string | null;
};

/**
 * Una fecha GMT de WooCommerce («2026-10-09T08:20:30», sin zona) a ISO en UTC
 * («2026-10-09T08:20:30.000Z»). `null` si no es una fecha.
 */
export function fechaGmtWoo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (!v) return null;
  const conZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(v) ? v : `${v}Z`;
  const t = Date.parse(conZona);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * El valor de `modified_after`: un segundo antes del cursor, al segundo y sin
 * zona (ver «La hora» arriba).
 */
export function modificadoDespuesDe(desde: string, margenMs = MARGEN_MS): string {
  return new Date(Date.parse(desde) - margenMs).toISOString().slice(0, 19);
}

/** Los parámetros de la consulta de una página, desde el cursor. */
export function parametrosPaginaWoo(
  cursor: CursorWoo,
  porPagina = POR_PAGINA_WOO,
): Record<string, string> {
  const p: Record<string, string> = {
    per_page: String(porPagina),
    page: String(cursor.pagina),
    orderby: "modified",
    order: "asc",
    dates_are_gmt: "true",
  };
  if (cursor.desde) p.modified_after = modificadoDespuesDe(cursor.desde);
  return p;
}

/** La fecha de modificación más reciente de una página, en ISO UTC. */
export function modificadoMasReciente(items: readonly ModificadoWoo[]): string | null {
  let max: string | null = null;
  for (const it of items) {
    const f = fechaGmtWoo(it.date_modified_gmt) ?? fechaGmtWoo(it.date_created_gmt);
    if (f && (max === null || f > max)) max = f;
  }
  return max;
}

/** Qué pedir después de una página, y si ya no queda nada. */
export type AvanceWoo = { siguiente: CursorWoo; fin: boolean };

/**
 * El cursor después de procesar una página.
 *
 * - Página incompleta: no queda nada más; el cursor se queda en lo último visto.
 * - Página llena que pasa del cursor: el cursor avanza y se vuelve a la página 1.
 * - Página llena que no pasa del cursor (todo en el mismo segundo): misma
 *   fecha, página siguiente.
 */
export function avanzarCursor(
  cursor: CursorWoo,
  items: readonly ModificadoWoo[],
  porPagina = POR_PAGINA_WOO,
): AvanceWoo {
  const max = modificadoMasReciente(items);
  const desde = max !== null && (cursor.desde === null || max > cursor.desde) ? max : cursor.desde;
  if (items.length < porPagina) return { siguiente: { desde, pagina: 1 }, fin: true };
  if (desde !== cursor.desde) return { siguiente: { desde, pagina: 1 }, fin: false };
  return { siguiente: { desde, pagina: cursor.pagina + 1 }, fin: false };
}

/**
 * Si WooCommerce no ha aplicado `modified_after` (anterior a la 5.8, que es
 * cuando llegó): ha devuelto algo modificado bastante antes del corte. Seguir
 * sería volver a pedir siempre la misma primera página.
 *
 * Un día de tolerancia para no confundir un desfase de zona horaria con esto.
 */
export function filtroDeFechaIgnorado(cursor: CursorWoo, items: readonly ModificadoWoo[]): boolean {
  if (!cursor.desde) return false;
  const corte = Date.parse(cursor.desde) - UN_DIA_MS;
  return items.some((it) => {
    const f = fechaGmtWoo(it.date_modified_gmt);
    return f !== null && Date.parse(f) < corte;
  });
}

/** El número de la cabecera `X-WP-Total`, o `null` si no viene o no es un número. */
export function totalDeCabecera(valor: string | null | undefined): number | null {
  if (valor == null || valor.trim() === "") return null;
  const n = Number(valor.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Cuántos quedan después de esta página, con el `X-WP-Total` de su consulta.
 * Es aproximado por arriba: lo que se vuelve a pedir por el margen de un
 * segundo cuenta otra vez. `null` si WooCommerce no ha mandado el total.
 */
export function quedanTrasPagina(
  totalConsulta: number | null,
  cursor: CursorWoo,
  recibidos: number,
  fin: boolean,
  porPagina = POR_PAGINA_WOO,
): number | null {
  if (fin) return 0;
  if (totalConsulta === null) return null;
  return Math.max(0, totalConsulta - (cursor.pagina - 1) * porPagina - recibidos);
}

/** Si cabe otra página en esta tanda. La primera siempre se pide. */
export function otraPaginaEnEstaTanda(
  paginasHechas: number,
  msTranscurridos: number,
  limites: { paginas: number; milisegundos: number } = TANDA_WOO,
): boolean {
  return paginasHechas < limites.paginas && msTranscurridos < limites.milisegundos;
}

/**
 * Desde dónde empezar cuando no hay cursor guardado (la primera vez, o sin la
 * migración 20261024100000): un día antes del pedido más reciente que ya está
 * aquí.
 *
 * `fecha_pedido` guarda la hora de la tienda como si fuera UTC, así que puede
 * ir unas horas por delante o por detrás de la GMT; el día de margen lo cubre.
 * Todo lo modificado después de la sincronización anterior es posterior a ese
 * pedido, así que entra. Lo que se repite se vuelve a guardar igual.
 *
 * Sin ningún pedido de WooCommerce aquí, `null`: se trae todo, desde el
 * principio. Una fecha en el futuro no puede dejar fuera lo de hoy: se
 * recorta a ahora.
 */
export function cursorDesdeUltimoPedido(
  fechaPedido: string | null | undefined,
  ahora: Date,
): string | null {
  const t = fechaPedido ? Date.parse(fechaPedido) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(Math.min(t, ahora.getTime()) - UN_DIA_MS).toISOString();
}

/**
 * Los clientes nuevos de una página de `/customers` pedida por id de mayor a
 * menor, y si ya se ha llegado a los que había.
 *
 * WooCommerce no deja filtrar clientes por fecha, pero el id de un cliente
 * nuevo siempre es mayor que el de los anteriores. `hastaId` es el mayor que
 * ya está aquí; `null` si no hay ninguno (entonces todos son nuevos).
 */
export function clientesNuevosDePagina<T extends { id: number }>(
  pagina: readonly T[],
  hastaId: number | null,
  porPagina = POR_PAGINA_WOO,
): { nuevos: T[]; fin: boolean } {
  const nuevos = hastaId === null ? [...pagina] : pagina.filter((c) => Number(c.id) > hastaId);
  const fin = pagina.length < porPagina || nuevos.length < pagina.length;
  return { nuevos, fin };
}

/** Qué hace la pantalla después de una tanda. */
export type DecisionTanda = "seguir" | "terminado" | "sin_avance" | "tope";

/**
 * Si la pantalla lanza otra tanda: no si ya no queda nada, no si el cursor no
 * se ha movido (se repetiría lo mismo para siempre), y no más de `maxTandas`.
 */
export function seguirConOtraTanda(
  tandasHechas: number,
  anterior: CursorWoo | undefined,
  siguiente: CursorWoo | null,
  maxTandas = TANDAS_MAX_WOO,
): DecisionTanda {
  if (!siguiente) return "terminado";
  if (anterior && anterior.desde === siguiente.desde && anterior.pagina === siguiente.pagina) {
    return "sin_avance";
  }
  if (tandasHechas >= maxTandas) return "tope";
  return "seguir";
}
