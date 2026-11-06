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
 * Como `llamarRpc`, pero devuelve el error con su código en vez de lanzarlo:
 * para decidir qué hacer si la función todavía no existe (`faltaLaFuncion`).
 */
export async function llamarRpcConError<T>(
  cliente: unknown,
  funcion: string,
  argumentos: Record<string, unknown>,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const rpc = (
    cliente as {
      rpc: (
        f: string,
        a: Record<string, unknown>,
      ) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>;
    }
  ).rpc;
  return await rpc.call(cliente, funcion, argumentos);
}

/**
 * La función todavía no existe: su migración no se ha aplicado. PostgREST
 * responde PGRST202 si no la encuentra en su caché del esquema; Postgres,
 * 42883.
 */
export function faltaLaFuncion(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883");
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

/**
 * Una función de la base que devuelve filas (RETURNS TABLE), para leerla como
 * una tabla: con `select`, filtros, orden y `range`. Mismo motivo que `tabla`.
 * Con `count: "exact"`, la respuesta trae además el total; con `head`, solo
 * el total.
 */
export function filasDeFuncion(
  cliente: unknown,
  nombre: string,
  opciones?: { count?: "exact"; head?: boolean },
) {
  return (cliente as { rpc: (n: string, a: object, o?: object) => any }).rpc(nombre, {}, opciones);
}

/**
 * La tabla todavía no existe: su migración no se ha aplicado. Solo esos dos
 * códigos (Postgres y PostgREST); un error de permisos no es «falta la
 * migración» y tiene que verse.
 */
export function faltaLaTabla(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205");
}

/**
 * Si el error es «esa columna no existe»: la migración que la crea todavía no
 * está aplicada. Postgres responde 42703; PostgREST, PGRST204 si la columna
 * no está en su caché del esquema.
 */
export function faltaLaColumna(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "42703" || error.code === "PGRST204");
}

/**
 * Emite por emitir_factura() o emitir_factura_textil() guardando además el
 * método de pago elegido (migración 20261106100000): pasa por su envoltura
 * `*_con_pago`, que fija el texto para el INSERT de esa misma transacción.
 *
 * Con `metodoPago` undefined, o si la envoltura todavía no existe (falta la
 * migración), emite como siempre: el PDF saldrá con el de Ajustes > Empresa.
 */
export async function emitirConMetodoPago<T>(
  cliente: unknown,
  funcion: "emitir_factura" | "emitir_factura_textil",
  argumentos: Record<string, unknown>,
  metodoPago: string | null | undefined,
): Promise<T> {
  if (metodoPago === undefined) return llamarRpc<T>(cliente, funcion, argumentos);
  const { data, error } = await llamarRpcConError<T>(cliente, `${funcion}_con_pago`, {
    _metodo_pago: metodoPago?.trim() ?? "",
    ...argumentos,
  });
  if (faltaLaFuncion(error)) return llamarRpc<T>(cliente, funcion, argumentos);
  if (error) throw new Error(error.message);
  return data as T;
}
