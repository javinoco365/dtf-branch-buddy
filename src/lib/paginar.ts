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
