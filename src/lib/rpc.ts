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

/**
 * Acceso a una tabla que `types.ts` todavía no conoce.
 *
 * Mismo motivo que `llamarRpc`: el fichero de tipos está generado y se quedó en
 * el esquema anterior a las migraciones de cimientos, así que no sabe de
 * `empresas`, `auditoria` ni `series_facturacion`. Hasta que se regenere, el
 * casting vive aquí y no repartido por las pantallas.
 *
 * Cuando se regenere types.ts, esta función y `llamarRpc` sobran: quítalas y
 * deja que el compilador compruebe las consultas de verdad.
 */
export function tabla(cliente: unknown, nombre: string) {
  return (cliente as { from: (n: string) => any }).from(nombre);
}
