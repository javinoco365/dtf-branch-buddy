/**
 * Una consulta `in` sobre muchos ids, leída entera.
 *
 * Por trozos (`trozos`), para que la lista de ids no reviente la dirección de
 * la petición, y cada trozo por páginas (`leerTodas`): Supabase corta en 1000
 * filas sin avisar. La consulta tiene que llevar un orden fijo, como pide
 * leerTodas.
 *
 * Recibe la consulta ya montada, con el cliente que toque: así este módulo no
 * importa nada de servidor y sirve desde cualquier `*.functions.ts`.
 */
import { leerTodas, trozos } from "./paginar";

export type ErrorConsulta = { code?: string; message: string };

/**
 * Lee `consulta` para todos los `ids` (sin repetidos). Para en el primer
 * error y lo devuelve junto con lo leído hasta ahí.
 */
export async function leerPorIds<T>(
  ids: readonly string[],
  consulta: (
    trozo: string[],
    desde: number,
    hasta: number,
  ) => PromiseLike<{ data: T[] | null; error: ErrorConsulta | null }>,
): Promise<{ data: T[]; error: ErrorConsulta | null }> {
  const filas: T[] = [];
  for (const trozo of trozos([...new Set(ids)])) {
    const r = await leerTodas<T>((a, b) => consulta(trozo, a, b));
    filas.push(...r.data);
    if (r.error) return { data: filas, error: r.error };
  }
  return { data: filas, error: null };
}
