import { llamarRpc } from "./rpc";
import type { Credenciales } from "./correo.server";

/**
 * Las credenciales del servidor de correo, en claro y solo en servidor.
 *
 * Van por `smtp_leer()`, que devuelve la configuración propia de la tienda si
 * la tiene y si no la general, y saca la contraseña de Vault. Esa función solo
 * la puede ejecutar el rol de servicio, así que `cliente` tiene que ser un
 * cliente de servicio.
 *
 * Nadie debe hacer un SELECT directo sobre `smtp_config`: la contraseña no
 * está ahí, solo la referencia al secreto.
 */
export async function leerCredencialesSmtp(
  cliente: unknown,
  tiendaId: string,
): Promise<Credenciales | null> {
  const filas = await llamarRpc<
    { host: string; puerto: number; usuario: string; clave: string | null }[] | null
  >(cliente, "smtp_leer", { _tienda_id: tiendaId });
  const fila = filas?.[0];
  if (!fila?.host || !fila.usuario || !fila.clave) return null;
  return { host: fila.host, puerto: Number(fila.puerto), usuario: fila.usuario, clave: fila.clave };
}
