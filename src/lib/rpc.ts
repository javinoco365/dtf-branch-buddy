/**
 * Llamada a una función de base de datos con el tipo puesto a mano.
 *
 * `src/integrations/supabase/types.ts` está generado y todavía no conoce las
 * funciones que añadieron las migraciones de cimientos y facturación. Hasta que
 * se regenere, el casting vive aquí y no esparcido en cada llamada.
 *
 * Recibe el cliente como parámetro a propósito: así este módulo no importa
 * nada de servidor y puede usarse desde cualquier `*.functions.ts` sin
 * arrastrar la clave de servicio al bundle del navegador.
 */
export async function llamarRpc<T>(
  cliente: unknown,
  funcion: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const rpc = (
    cliente as {
      rpc: (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: T; error: { message: string } | null }>;
    }
  ).rpc;
  const { data, error } = await rpc.call(cliente, funcion, argumentos);
  if (error) throw new Error(error.message);
  return data;
}
