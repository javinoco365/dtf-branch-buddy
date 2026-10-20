/**
 * Leer una consulta entera, página a página.
 *
 * Supabase devuelve como mucho 1000 filas por consulta (max_rows de la API) y
 * corta en silencio: sin paginar, un historial de 1500 pedidos se quedaría en
 * 1000 sin avisar. La consulta tiene que llevar un orden fijo, o las páginas
 * podrían repetir o saltarse filas.
 */

export const FILAS_POR_PAGINA = 1000;

type Respuesta<T> = { data: T[] | null; error: { code?: string; message: string } | null };

export async function leerTodas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
): Promise<Respuesta<T> & { data: T[] }> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const { data, error } = await pagina(desde, desde + FILAS_POR_PAGINA - 1);
    if (error) return { data: filas, error };
    filas.push(...(data ?? []));
    if ((data ?? []).length < FILAS_POR_PAGINA) return { data: filas, error: null };
  }
}

/** Parte una lista en trozos, para filtros `in` que no revienten la URL. */
export function trozos<T>(lista: readonly T[], tam = 150): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) r.push(lista.slice(i, i + tam));
  return r;
}

/**
 * Cuántas peticiones a la vez lanza `enParalelo` si no se dice otra cosa.
 *
 * Desde el navegador, HTTP/2 las lleva todas por una conexión. En el servidor
 * (un Worker de Cloudflare) hay como mucho 6 conexiones salientes abiertas por
 * petición: las que pasen de ahí esperan en cola, no fallan. Con 4 por rama, una
 * server function que lanza varias ramas a la vez se queda cerca de ese tope
 * en vez de amontonar decenas de peticiones en cola.
 */
export const PETICIONES_A_LA_VEZ = 4;

/**
 * `fn` sobre cada elemento de `lista`, con como mucho `limite` a la vez.
 *
 * Devuelve los resultados **en el orden de entrada**, no en el de llegada: así
 * quien concatena trozos obtiene las mismas filas en el mismo orden que con un
 * `for … await`. Si alguna llamada lanza, no se empiezan más, se espera a las
 * que ya estaban en marcha y se lanza el error de la primera que falló en el
 * orden de la lista (el mismo que habría salido en serie).
 */
export async function enParalelo<T, R>(
  lista: readonly T[],
  limite: number,
  fn: (x: T, i: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(lista.length);
  type Fallo = { i: number; error: unknown };
  let siguiente = 0;
  const fallos: Fallo[] = [];
  const trabajador = async () => {
    while (fallos.length === 0 && siguiente < lista.length) {
      const i = siguiente++;
      try {
        resultados[i] = await fn(lista[i], i);
      } catch (error) {
        fallos.push({ i, error });
      }
    }
  };
  const n = Math.min(Math.max(1, Math.floor(limite) || 1), lista.length);
  await Promise.all(Array.from({ length: n }, trabajador));
  if (fallos.length > 0) {
    throw fallos.reduce((primero, f) => (f.i < primero.i ? f : primero)).error;
  }
  return resultados;
}

/**
 * Junta en orden las respuestas de varios trozos leídos a la vez, con el mismo
 * contrato que leerlos en serie: se para en el primer trozo con error (en el
 * orden de la lista) y se devuelve lo leído hasta ahí, incluidas las filas que
 * ese trozo llegara a traer.
 */
export function juntarEnOrden<T, E>(
  respuestas: readonly { data: T[]; error: E | null }[],
): { data: T[]; error: E | null } {
  const filas: T[] = [];
  for (const r of respuestas) {
    filas.push(...r.data);
    if (r.error) return { data: filas, error: r.error };
  }
  return { data: filas, error: null };
}
