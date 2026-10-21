import { faltaLaFuncion, llamarRpc, llamarRpcConError, tabla } from "./rpc";
import { leerMiNivel } from "./nivel-sesion";

/**
 * Control de acceso antes de usar la clave de servicio.
 *
 * `requireSupabaseAuth` solo comprueba que el token es válido: cualquiera con
 * una cuenta lo tiene. Si después se escribe o se lee con `supabaseAdmin` o
 * con `adminComoUsuario()`, la RLS ya no protege nada y la comprobación tiene
 * que hacerse aquí, ANTES de crear el cliente de servicio.
 *
 * Las tres preguntas se hacen con la sesión del propio usuario
 * (`context.supabase`) a las mismas funciones que usa la RLS (`has_role`,
 * `es_miembro_empresa`, `is_tienda_member`), así que la respuesta es la misma
 * que daría la base si la escritura fuera con su sesión.
 *
 * Mejor todavía es no necesitar nada de esto: si la tabla tiene políticas por
 * operación, escribe con `context.supabase` y deja decidir a la RLS
 * (`exigirFilas` avisa cuando la RLS no ha dejado tocar nada).
 *
 * La prueba src/arquitectura/acceso-clave-servicio.test.ts falla si una
 * server function nueva usa la clave de servicio sin pasar por aquí.
 */

type ClienteUsuario = unknown;

async function pregunta(
  supabase: ClienteUsuario,
  funcion: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const r = await llamarRpc<boolean | null>(supabase, funcion, args);
  return r === true;
}

/**
 * Lanza si quien llama no es administrador ACTIVO. Va por mi_nivel() (niveles,
 * 20261031200100), igual que el middleware exigeAdmin: has_role() no mira la
 * columna activo y un admin desactivado seguiría pasando. Sin esa migración
 * aplicada, leerMiNivel() vuelve a mirar la fila de admin, como antes.
 */
export async function exigirAdmin(supabase: ClienteUsuario, usuarioId: string): Promise<void> {
  const nivel = await leerMiNivel(supabase, usuarioId);
  if (nivel !== "admin") throw new Error("Solo un administrador puede hacer esto");
}

/** Lanza si quien llama no es de la empresa (los administradores lo son de todas). */
export async function exigirMiembroEmpresa(
  supabase: ClienteUsuario,
  usuarioId: string,
  empresaId: string,
): Promise<void> {
  const ok = await pregunta(supabase, "es_miembro_empresa", {
    _user_id: usuarioId,
    _empresa_id: empresaId,
  });
  if (!ok) throw new Error("Sin acceso a esta empresa");
}

/** Lanza si quien llama no es de la tienda (los administradores lo son de todas). */
export async function exigirMiembroTienda(
  supabase: ClienteUsuario,
  usuarioId: string,
  tiendaId: string,
): Promise<void> {
  const ok = await pregunta(supabase, "is_tienda_member", {
    _user_id: usuarioId,
    _tienda_id: tiendaId,
  });
  if (!ok) throw new Error("Sin acceso a esta tienda");
}

/**
 * ¿Es administrador ACTIVO? Con cualquier cliente, también el de servicio
 * (adminComoUsuario), para las comprobaciones que se hacen con él. Va por
 * rol_es_admin() (20261031200100), que mira la columna activo: leer
 * user_roles con role = 'admin' dejaba pasar a un admin desactivado. Sin esa
 * migración aplicada, mira la fila de admin, como antes.
 */
export async function esAdminActivo(cliente: ClienteUsuario, usuarioId: string): Promise<boolean> {
  const { data, error } = await llamarRpcConError<boolean>(cliente, "rol_es_admin", {
    _user_id: usuarioId,
  });
  if (!error) return data === true;
  if (!faltaLaFuncion(error)) {
    throw new Error(`No se ha podido comprobar tu nivel: ${error.message}`);
  }
  const { data: fila, error: e } = await tabla(cliente, "user_roles")
    .select("role")
    .eq("user_id", usuarioId)
    .eq("role", "admin")
    .maybeSingle();
  if (e) throw new Error(`No se ha podido comprobar tu nivel: ${e.message}`);
  return !!fila;
}

/**
 * ¿Es de la tienda, o administrador? Con cualquier cliente, también el de
 * servicio. Va por is_tienda_member(), la misma que usa la RLS: desde
 * 20261031300200 no cuenta a los usuarios desactivados. Mirar tienda_usuarios
 * y user_roles a mano sí los contaba.
 */
export async function esMiembroTienda(
  cliente: ClienteUsuario,
  usuarioId: string,
  tiendaId: string,
): Promise<boolean> {
  return pregunta(cliente, "is_tienda_member", { _user_id: usuarioId, _tienda_id: tiendaId });
}

/**
 * Una escritura con la sesión del usuario que la RLS filtra no da error:
 * simplemente no toca ninguna fila. Con `.select("id")` detrás, esto lo
 * convierte en un error que se entiende.
 */
export function exigirFilas(filas: unknown[] | null | undefined, que: string): void {
  if (!filas || filas.length === 0) {
    throw new Error(`No se ha encontrado ${que}, o no tienes permiso para cambiarlo`);
  }
}
