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
 * La página se guarda con la fecha (`pedidos_pagina`, migración
 * 20261024110000): sin ella, una sincronización de una sola tanda (el botón de
 * Pedidos) volvía siempre a la página 1 de ese segundo y, con 500 o más
 * pedidos en él, no salía nunca de ahí. Lo que no cubre: si entre una tanda y
 * la siguiente se vuelve a modificar un pedido de las páginas ya vistas de ese
 * segundo, se va al final y los demás se corren un puesto; el que queda justo
 * en el borde de la página no se ve hasta que vuelva a cambiar. Solo pasa con
 * cientos de pedidos en el mismo segundo y otro cambio encima de ellos.
 *
 * ## Además, siempre, los 100 últimos por fecha
 *
 * Si la tienda guarda los pedidos en el almacenamiento clásico de WordPress
 * (sin HPOS), editar las líneas de un pedido sin cambiarle el estado no mueve
 * su fecha de modificación: por el cursor no llegaría nunca. Por eso cada
 * sincronización empieza trayendo los 100 últimos pedidos por fecha de
 * creación, como se hacía antes, y con esa misma lista mira qué pedidos se han
 * borrado en WooCommerce. Los que después vuelven a salir por el cursor con la
 * misma fecha de modificación no se guardan dos veces (`sinGuardarTodavia`).
 *
 * Sin la tabla del cursor (migración 20261024100000 sin aplicar) solo se hace
 * eso: sin un sitio donde guardar por dónde va, recorrer desde un día antes del
 * último pedido se quedaba dando vueltas sobre lo mismo si un cambio masivo
 * tocaba más pedidos de los que caben en una tanda.
 *
 * ## El primer cursor se guarda al empezar
 *
 * Sin cursor guardado (la primera vez) se empieza un día antes del último
 * pedido que ya está aquí (`cursorDesdeUltimoPedido`), y ese punto se guarda
 * ANTES de traer los 100 últimos. Si solo se guardara al terminar una página
 * del cursor, una llamada que se quedara antes sin tiempo (o fallara) dejaría
 * la siguiente calculándolo otra vez, ya con los 100 últimos aquí: los pedidos
 * de entre medias no llegarían nunca. «Desde el principio» (sin ningún pedido
 * de WooCommerce aquí) se guarda como `DESDE_EL_PRINCIPIO_WOO`.
 *
 * ## Por tandas, con un presupuesto
 *
 * Una llamada hace lo que cabe en `TANDA_WOO` (páginas y tiempo), contando
 * TODO lo que pide a WooCommerce, salvo dos páginas que van siempre aunque se
 * pasen: los 100 últimos (al empezar) y una de pedidos cambiados. Sin esa
 * segunda, el botón de Pedidos, que hace una sola llamada, podía no mover
 * nunca el cursor. Con lo que quede: más pedidos, clientes nuevos y productos,
 * por ese orden.
 * Lo que no cabe queda en `ContinuacionWoo`, que la pantalla de Ajustes
 * devuelve en la tanda siguiente, y además guardado en woo_sincronizacion, de
 * donde sigue cualquier sincronización posterior.
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
 * Cuánto trabajo hace una llamada a `sincronizarWoo`, contando todas las
 * páginas que pide a WooCommerce (los 100 últimos, pedidos, clientes y
 * productos). Los 100 últimos y la primera página de pedidos van siempre,
 * aunque se pasen (`otraPaginaDePedidos`). Una página de 100 pedidos completos
 * tarda unos segundos entre WooCommerce y la base; con esto una tanda se queda
 * por debajo de lo que una función en Vercel puede tardar. Lo que no cabe lo
 * hace la tanda siguiente, desde donde se quedó.
 */
export const TANDA_WOO = { paginas: 5, milisegundos: 10_000 } as const;

/**
 * Página más alta que se pide de una misma consulta. Para pedidos y productos
 * solo se pasa de la 1 cuando cientos comparten el mismo segundo de
 * modificación: 100 páginas son 10.000 en un segundo, y si se llega, algo va
 * mal. Para los clientes nuevos, una pasada mira como mucho 100 tandas de 100
 * ids: 10.000 cuentas nuevas desde la última vez. Para más está «Sincronizar
 * clientes».
 */
export const PAGINA_MAXIMA_WOO = 100;

/**
 * Cuánto dura el turno de una sincronización (el arrendamiento de
 * woo_sincronizacion, migración 20261024110000). Se renueva antes de guardar
 * cada página, así que solo tiene que cubrir una página con holgura. Si la
 * función muere sin soltarlo, la tienda queda libre como mucho este rato
 * después.
 */
export const ARRENDAMIENTO_WOO_SEGUNDOS = 120;

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

/**
 * Cómo se guarda en woo_sincronizacion un cursor `desde: null` («desde el
 * principio»): la columna vacía es «nunca se ha guardado», que es otra cosa
 * (entonces se calcula desde el último pedido de aquí). Al leerlo vuelve a ser
 * `null`, y sin `modified_after` se pide todo, como siempre.
 */
export const DESDE_EL_PRINCIPIO_WOO = "1970-01-01T00:00:00.000Z";

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

/**
 * Los parámetros de los 100 más recientes, sin cursor: los pedidos por fecha
 * de creación (`date`), lo que se hacía antes de haber cursor, y los productos
 * por fecha de modificación (`modified`) cuando no hay dónde guardar el suyo.
 */
export function parametrosUltimosWoo(
  orden: "date" | "modified",
  porPagina = POR_PAGINA_WOO,
): Record<string, string> {
  return { per_page: String(porPagina), orderby: orden, order: "desc" };
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

/**
 * Si cabe otra página en esta tanda. La primera siempre se pide, aunque lo de
 * antes (credenciales, permisos) haya tardado: si no, una tanda podría no
 * hacer nada y la siguiente repetiría lo mismo.
 */
export function otraPaginaEnEstaTanda(
  paginasHechas: number,
  msTranscurridos: number,
  limites: { paginas: number; milisegundos: number } = TANDA_WOO,
): boolean {
  if (paginasHechas === 0) return true;
  return paginasHechas < limites.paginas && msTranscurridos < limites.milisegundos;
}

/**
 * Si se pide otra página de pedidos cambiados en esta llamada. La primera va
 * siempre, aunque los 100 últimos ya hayan gastado el presupuesto: el botón de
 * Pedidos hace una sola llamada, y si esa página dependiera del tiempo que
 * queda, en una tienda lenta el cursor no se movería nunca. Las siguientes,
 * como cualquier otra página.
 */
export function otraPaginaDePedidos(
  paginasDePedidos: number,
  paginasHechas: number,
  msTranscurridos: number,
  limites: { paginas: number; milisegundos: number } = TANDA_WOO,
): boolean {
  return paginasDePedidos === 0 || otraPaginaEnEstaTanda(paginasHechas, msTranscurridos, limites);
}

/**
 * Desde dónde empezar la primera vez que hay dónde guardar el cursor (con la
 * migración 20261024100000 aplicada y nada guardado todavía): un día antes del
 * pedido más reciente que ya está aquí. Sin la migración no se usa: se traen
 * los 100 últimos, como antes.
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
 * Una pasada por los clientes nuevos de WooCommerce: los de id mayor que
 * `hasta_id`, de mayor a menor. Solo da de alta a los que no están aquí; las
 * fichas que ya existen no se tocan (ver paginaDeClientes en
 * src/lib/woocommerce.functions.ts).
 *
 * WooCommerce no deja filtrar clientes por fecha, pero el id de un cliente
 * nuevo siempre es mayor que el de los anteriores: es el id de usuario de
 * WordPress, que solo crece.
 *
 * - `hasta_id`: hasta dónde están ya todos (los de id menor o igual); 0 si
 *   todavía ninguno. Es el tope de la pasada anterior; la primera vez, el id
 *   más alto que hay aquí. No se saca del id más alto de Clientes en cada
 *   pasada: los pedidos que se sincronizan dan de alta a sus clientes, y uno
 *   con un id alto haría creer que ya están todos los de debajo, aunque se
 *   registraran antes sin comprar.
 * - `tope_id`: el id más alto que se vio al empezar esta pasada. Al terminar,
 *   pasa a ser el `hasta_id` de la siguiente: quien se dé de alta mientras
 *   tanto tiene un id mayor y entra en ella. `null` si no ha empezado.
 * - `bajo_id`: hasta dónde ha bajado: todos los de id entre `bajo_id` y
 *   `tope_id` ya se han visto. `null` si no ha empezado.
 *
 * Entre pasadas solo queda `hasta_id` (`tope_id` y `bajo_id` a `null`): es una
 * pasada nueva sin empezar.
 *
 * ## Por ids, no por número de página
 *
 * La primera petición es la página 1 por id descendente: da el tope y los 100
 * más altos. Las siguientes no piden «la página 2»: piden con `include` los
 * 100 ids que siguen por debajo de `bajo_id` (`ventanaClientes`). Por número
 * de página, si entre una petición y la siguiente se borraba en WooCommerce un
 * cliente ya visto, la página siguiente se corría un puesto y su primer
 * cliente no se veía nunca. Por ids, lo que pase por encima no mueve nada: lo
 * que se borra ya no hace falta, y lo que se da de alta tiene un id mayor que
 * el tope y entra en la pasada siguiente.
 *
 * Una tanda de ids puede volver con menos de 100, o con ninguno: son ids de
 * usuarios que no son clientes (administradores, suscriptores) o que se
 * borraron. Se sigue bajando hasta `hasta_id`.
 *
 * Lo que no cubre: WordPress reutiliza el id más alto si ese usuario se borra
 * y MySQL (anterior a la 8.0) se reinicia antes del alta siguiente. Ese
 * cliente queda por debajo de `hasta_id` y no entra por aquí; sí con
 * «Sincronizar clientes», que recorre todos.
 */
export type PasadaClientesWoo = {
  hasta_id: number;
  tope_id: number | null;
  bajo_id: number | null;
};

/**
 * El id más bajo que pide la pasada: el siguiente a `hasta_id`, salvo que haya
 * más de `PAGINA_MAXIMA_WOO` tandas de ids entre medias (`recortada`).
 */
function pisoDePasada(
  p: PasadaClientesWoo,
  porPagina: number,
): { piso: number; recortada: boolean } {
  const siguiente = p.hasta_id + 1;
  if (p.tope_id === null) return { piso: siguiente, recortada: false };
  const limite = p.tope_id - PAGINA_MAXIMA_WOO * porPagina + 1;
  return limite > siguiente
    ? { piso: limite, recortada: true }
    : { piso: siguiente, recortada: false };
}

/**
 * Los ids que pide la siguiente petición de la pasada, de mayor a menor: los
 * hasta 100 que siguen por debajo de `bajo_id`. `null` si es la primera (la
 * página 1 por id); vacío si ya no queda nada que pedir.
 */
export function ventanaClientes(p: PasadaClientesWoo, porPagina = POR_PAGINA_WOO): number[] | null {
  if (p.bajo_id === null) return null;
  const { piso } = pisoDePasada(p, porPagina);
  const ids: number[] = [];
  for (let id = p.bajo_id - 1; id >= piso && ids.length < porPagina; id--) ids.push(id);
  return ids;
}

/**
 * Los parámetros de `/customers` para la siguiente petición de la pasada, o
 * `null` si ya no queda nada que pedir. Nunca un `include` vacío: WooCommerce
 * lo ignoraría y devolvería los primeros clientes.
 */
export function parametrosPasadaClientes(
  p: PasadaClientesWoo,
  porPagina = POR_PAGINA_WOO,
): Record<string, string> | null {
  const base = { orderby: "id", order: "desc", per_page: String(porPagina) };
  const ventana = ventanaClientes(p, porPagina);
  if (ventana === null) return base;
  if (!ventana.length) return null;
  return { ...base, include: ventana.join(",") };
}

/** Una pasada terminada: todo lo de debajo del tope ya está. Nunca hacia atrás. */
function pasadaTerminada(p: PasadaClientesWoo): PasadaClientesWoo {
  const hasta = p.tope_id !== null && p.tope_id > p.hasta_id ? p.tope_id : p.hasta_id;
  return { hasta_id: hasta, tope_id: null, bajo_id: null };
}

/** Lo que sale de una petición de la pasada de clientes. */
export type PasoClientesWoo<T> = {
  /** Los de la respuesta con id mayor que `hasta_id`: se dan de alta los que no estén. */
  nuevos: T[];
  /** Lo que queda de la pasada; `null` si ha terminado. */
  siguiente: PasadaClientesWoo | null;
  /** Lo que se guarda en woo_sincronizacion. */
  estado: PasadaClientesWoo;
  /**
   * Por qué ha terminado sin llegar a `hasta_id`: `limite`, más de
   * `PAGINA_MAXIMA_WOO` tandas de ids nuevos; `sin_filtro`, WooCommerce no ha
   * respetado el `include` y no se puede seguir por ids.
   */
  aviso: "limite" | "sin_filtro" | null;
};

/**
 * Lo que queda de la pasada después de una petición, y lo que hay que guardar.
 * `respuesta` es lo que ha devuelto `/customers` con
 * `parametrosPasadaClientes(pasada)` (vacía si eso era `null`).
 */
export function siguientePasadaClientes<T extends { id: number }>(
  pasada: PasadaClientesWoo,
  respuesta: readonly T[],
  porPagina = POR_PAGINA_WOO,
): PasoClientesWoo<T> {
  const terminar = (nuevos: T[], p: PasadaClientesWoo, aviso: PasoClientesWoo<T>["aviso"]) => ({
    nuevos,
    siguiente: null,
    estado: pasadaTerminada(p),
    aviso,
  });
  const ids = respuesta.map((c) => Number(c.id)).filter((id) => Number.isFinite(id));
  const ventana = ventanaClientes(pasada, porPagina);

  let nuevos: T[];
  let tope_id = pasada.tope_id;
  let bajo_id: number;
  if (ventana === null) {
    // La primera: la página 1 por id descendente.
    nuevos = respuesta.filter((c) => Number(c.id) > pasada.hasta_id);
    if (!ids.length) return terminar(nuevos, pasada, null);
    const maximo = Math.max(...ids);
    tope_id = tope_id === null || maximo > tope_id ? maximo : tope_id;
    const conTope = { ...pasada, tope_id };
    // Página incompleta: no hay más clientes. Alguno ya estaba: se ha llegado.
    if (respuesta.length < porPagina || nuevos.length < respuesta.length) {
      return terminar(nuevos, conTope, null);
    }
    bajo_id = Math.min(...ids);
  } else {
    if (!ventana.length) return terminar([], pasada, null);
    const enVentana = new Set(ventana);
    if (ids.some((id) => !enVentana.has(id))) return terminar([], pasada, "sin_filtro");
    nuevos = [...respuesta];
    bajo_id = ventana[ventana.length - 1];
  }

  const siguiente: PasadaClientesWoo = { hasta_id: pasada.hasta_id, tope_id, bajo_id };
  const { piso, recortada } = pisoDePasada(siguiente, porPagina);
  if (bajo_id <= piso) return terminar(nuevos, siguiente, recortada ? "limite" : null);
  return { nuevos, siguiente, estado: siguiente, aviso: null };
}

/**
 * Lo que le queda a una sincronización: cada parte es `null` cuando ya está al
 * día. Después de los 100 últimos y de la primera página de pedidos, se sigue
 * en este orden: pedidos, clientes nuevos, productos.
 */
export type ContinuacionWoo = {
  clientes: PasadaClientesWoo | null;
  pedidos: CursorWoo | null;
  productos: CursorWoo | null;
};

/** La continuación, o `null` si ya no queda nada. */
export function continuacionPendiente(c: ContinuacionWoo): ContinuacionWoo | null {
  return c.clientes || c.pedidos || c.productos ? c : null;
}

function mismoCursor(a: CursorWoo | null, b: CursorWoo | null): boolean {
  if (!a || !b) return a === b;
  return a.desde === b.desde && a.pagina === b.pagina;
}

/** Si dos continuaciones dicen exactamente lo mismo. */
export function mismaContinuacion(a: ContinuacionWoo, b: ContinuacionWoo): boolean {
  const mismosClientes =
    !a.clientes || !b.clientes
      ? a.clientes === b.clientes
      : a.clientes.hasta_id === b.clientes.hasta_id &&
        a.clientes.tope_id === b.clientes.tope_id &&
        a.clientes.bajo_id === b.clientes.bajo_id;
  return (
    mismosClientes && mismoCursor(a.pedidos, b.pedidos) && mismoCursor(a.productos, b.productos)
  );
}

/**
 * Si lo que queda lo retoma también una sincronización nueva (volver a pulsar
 * el botón de Pedidos), porque está guardado. Sin la migración 20261024110000
 * (`completo = false`) solo se guardan las fechas: ni la pasada de clientes ni
 * la página dentro de un mismo segundo.
 */
export function reanudableTrasTanda(siguiente: ContinuacionWoo | null, completo: boolean): boolean {
  if (!siguiente || completo) return true;
  return (
    !siguiente.clientes &&
    (siguiente.pedidos?.pagina ?? 1) === 1 &&
    (siguiente.productos?.pagina ?? 1) === 1
  );
}

/**
 * Cómo sigue quien ha pulsado el botón de Pedidos (una sola tanda), según lo
 * que ha quedado:
 * - `pulsar`: volver a pulsar sigue donde se quedó.
 * - `ajustes`: hay pedidos o productos a media página de un mismo segundo y la
 *   página no se guarda; volver a pulsar empezaría esa página otra vez.
 *   «Sincronizar ahora» de los ajustes la lleva de una tanda a la siguiente.
 * - `clientes`: la pasada de clientes no se guarda; la siguiente empezaría en
 *   el más alto de aquí y se saltaría a los que faltan. Los trae
 *   «Sincronizar clientes».
 */
export function comoSeguirWoo(
  siguiente: ContinuacionWoo,
  reanudable: boolean,
): { pulsar: boolean; ajustes: boolean; clientes: boolean } {
  if (reanudable) return { pulsar: true, ajustes: false, clientes: false };
  const cursores = [siguiente.pedidos, siguiente.productos].filter(
    (c): c is CursorWoo => c !== null,
  );
  const ajustes = cursores.some((c) => c.pagina > 1);
  return {
    pulsar: !ajustes && cursores.length > 0,
    ajustes,
    clientes: siguiente.clientes !== null,
  };
}

/**
 * Los pedidos de una página que no se han guardado ya en esta misma llamada
 * tal como vienen ahora.
 *
 * `guardados` es id de WooCommerce → fecha de modificación (ISO UTC) con la que
 * se guardó. Un pedido que ya se guardó con la misma fecha no se vuelve a
 * escribir (los 100 últimos y el cursor se solapan casi siempre); si la fecha
 * ha cambiado, o no se sabe, sí.
 */
export function sinGuardarTodavia<T extends { id: number } & ModificadoWoo>(
  pagina: readonly T[],
  guardados: ReadonlyMap<number, string | null>,
): T[] {
  return pagina.filter((o) => {
    const id = Number(o.id);
    if (!guardados.has(id)) return true;
    const ahora = fechaGmtWoo(o.date_modified_gmt);
    return ahora === null || ahora !== guardados.get(id);
  });
}

/**
 * Lo que hay guardado en woo_sincronizacion, leído de su fila. Las columnas que
 * no existan (migración 20261024110000 sin aplicar) se toman como la página 1 y
 * sin nada guardado de los clientes.
 */
export type EstadoGuardadoWoo = {
  /** `null`: nunca se ha guardado; se empieza desde el último pedido de aquí. */
  pedidos: CursorWoo | null;
  /** `null`: nunca se ha guardado; se empieza desde el principio del catálogo. */
  productos: CursorWoo | null;
  /** `null`: nunca se ha guardado; se empieza desde el último cliente de aquí. */
  clientes: PasadaClientesWoo | null;
};

function paginaGuardada(valor: unknown): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= PAGINA_MAXIMA_WOO ? n : 1;
}

function idGuardado(valor: unknown, minimo: number): number | null {
  if (valor == null) return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= minimo ? n : null;
}

function cursorGuardado(hasta: unknown, pagina: unknown): CursorWoo | null {
  const desde = fechaGmtWoo(hasta);
  if (!desde) return null;
  return {
    desde: desde === DESDE_EL_PRINCIPIO_WOO ? null : desde,
    pagina: paginaGuardada(pagina),
  };
}

export function estadoDeFilaWoo(
  fila: Record<string, unknown> | null | undefined,
): EstadoGuardadoWoo {
  const hastaId = idGuardado(fila?.clientes_hasta_id, 0);
  const topeId = idGuardado(fila?.clientes_tope_id, 1);
  const bajoId = idGuardado(fila?.clientes_bajo_id, 1);
  // Una pasada a medias necesita el tope y por dónde va; si falta alguno, se
  // empieza otra desde hasta_id.
  const enCurso = topeId !== null && bajoId !== null;
  return {
    pedidos: cursorGuardado(fila?.pedidos_hasta, fila?.pedidos_pagina),
    productos: cursorGuardado(fila?.productos_hasta, fila?.productos_pagina),
    clientes:
      hastaId === null
        ? null
        : {
            hasta_id: hastaId,
            tope_id: enCurso ? topeId : null,
            bajo_id: enCurso ? bajoId : null,
          },
  };
}

/** Lo que se escribe en woo_sincronizacion de cada parte. */
export type CambioEstadoWoo = {
  pedidos?: CursorWoo;
  productos?: CursorWoo;
  clientes?: PasadaClientesWoo;
};

/**
 * Las columnas de woo_sincronizacion para un cambio. Sin la migración
 * 20261024110000 (`completo = false`) solo existen las fechas: ni la página ni
 * lo de los clientes. Un cursor «desde el principio» se escribe como
 * `DESDE_EL_PRINCIPIO_WOO`.
 */
export function columnasEstadoWoo(
  cambio: CambioEstadoWoo,
  completo: boolean,
): Record<string, string | number | null> {
  const c: Record<string, string | number | null> = {};
  if (cambio.pedidos) {
    c.pedidos_hasta = cambio.pedidos.desde ?? DESDE_EL_PRINCIPIO_WOO;
    if (completo) c.pedidos_pagina = cambio.pedidos.pagina;
  }
  if (cambio.productos) {
    c.productos_hasta = cambio.productos.desde ?? DESDE_EL_PRINCIPIO_WOO;
    if (completo) c.productos_pagina = cambio.productos.pagina;
  }
  if (completo && cambio.clientes) {
    c.clientes_hasta_id = cambio.clientes.hasta_id;
    c.clientes_tope_id = cambio.clientes.tope_id;
    c.clientes_bajo_id = cambio.clientes.bajo_id;
  }
  return c;
}

/** Qué hace la pantalla después de una tanda. */
export type DecisionTanda = "seguir" | "terminado" | "sin_avance" | "tope";

/**
 * Si la pantalla lanza otra tanda: no si ya no queda nada, no si la
 * continuación no se ha movido (se repetiría lo mismo para siempre), y no más
 * de `maxTandas`.
 */
export function seguirConOtraTanda(
  tandasHechas: number,
  anterior: ContinuacionWoo | undefined,
  siguiente: ContinuacionWoo | null,
  maxTandas = TANDAS_MAX_WOO,
): DecisionTanda {
  if (!siguiente) return "terminado";
  if (anterior && mismaContinuacion(anterior, siguiente)) return "sin_avance";
  if (tandasHechas >= maxTandas) return "tope";
  return "seguir";
}
