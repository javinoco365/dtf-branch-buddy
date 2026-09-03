import { llamarRpc } from "./rpc";

/**
 * Las credenciales de WooCommerce de una tienda, en claro y solo en servidor.
 *
 * Van por `tienda_credenciales_leer()`, que las saca de Vault y, mientras dure
 * la transición, cae a las columnas antiguas si esa tienda todavía no se ha
 * trasladado. Nadie debe volver a hacer un SELECT directo sobre
 * `tienda_credenciales`: cuando se retiren las columnas en claro, ese SELECT
 * dejará de devolver nada y el fallo será silencioso.
 *
 * La función de base de datos solo se la puede ejecutar el rol de servicio, así
 * que `cliente` tiene que ser un cliente de servicio.
 */
export type CredencialesWoo = { consumer_key: string; consumer_secret: string };

export async function leerCredencialesWoo(
  cliente: unknown,
  tiendaId: string,
): Promise<CredencialesWoo | null> {
  const filas = await llamarRpc<CredencialesWoo[] | null>(cliente, "tienda_credenciales_leer", {
    _tienda_id: tiendaId,
  });
  const fila = filas?.[0];
  if (!fila?.consumer_key || !fila.consumer_secret) return null;
  return fila;
}

/**
 * La cabecera Authorization que espera la API REST de WooCommerce.
 *
 * Con btoa y no con Buffer: el destino de despliegue no garantiza Buffer, y
 * btoa existe tanto en Node como en workers. Las claves de WooCommerce son
 * ASCII (ck_..., cs_...), que es lo único que btoa admite.
 */
export function autorizacionWoo(creds: CredencialesWoo): string {
  return "Basic " + btoa(`${creds.consumer_key}:${creds.consumer_secret}`);
}
