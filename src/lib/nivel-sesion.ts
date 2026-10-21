// El nivel de quien está dentro, leído con SU cliente (su JWT, con RLS).
//
// mi_nivel() la crea la migración 20261031200100. Mientras no esté aplicada
// en la base, se lee como antes de los niveles: admin quien tiene la fila de
// admin y editor el resto (hasta entonces todos podían escribir en sus
// tiendas). Así desplegar el código antes que la migración no deja a nadie
// sin poder trabajar ni da más permisos de los que había.
import { esNivel, type Nivel } from "@/dominio/permisos";
import { faltaLaFuncion, llamarRpcConError, tabla } from "./rpc";

export async function leerMiNivel(cliente: unknown, userId: string): Promise<Nivel | null> {
  const { data, error } = await llamarRpcConError<unknown>(cliente, "mi_nivel", {});
  if (!error) return esNivel(data) ? data : null;
  if (!faltaLaFuncion(error)) {
    throw new Error(`No se ha podido comprobar tu nivel: ${error.message}`);
  }
  const { data: fila, error: e } = await tabla(cliente, "user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (e) throw new Error(`No se ha podido comprobar tu nivel: ${e.message}`);
  return fila ? "admin" : "editor";
}
