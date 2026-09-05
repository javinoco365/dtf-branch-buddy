/**
 * El número de pedido que enseña WooCommerce.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin base de datos ni red.
 *
 * ## El problema
 *
 * WooCommerce tiene dos cosas distintas que parecen la misma:
 *
 *   - `id`     el identificador interno del pedido en la base de WordPress.
 *   - `number` el número que se ve en el panel y en el correo del cliente.
 *
 * **En una tienda sin plugins los dos valen lo mismo**, así que la diferencia
 * no se nota. En cuanto entra un plugin de numeración —los hay en casi todas
 * las tiendas, para que las facturas no delaten cuántos pedidos llevas— el
 * número visible pasa a ser otro y se guarda en `meta_data`, no en `number`.
 *
 * Si el CRM guarda el `id`, el número que aparece aquí no coincide con el que
 * el cliente tiene en su correo. Y cuando alguien llama preguntando por «el
 * pedido 1043», no hay forma de encontrarlo.
 *
 * ## El orden en que se busca
 *
 * De lo más específico a lo más genérico. Las dos primeras claves son las que
 * usan los plugins de numeración más extendidos; `number` es el campo estándar
 * de la API; el `id` es el último recurso y solo para no quedarse sin nada.
 */

/** Lo que hace falta de un pedido de la API de WooCommerce. */
export type PedidoWoo = {
  id?: number | string | null;
  number?: number | string | null;
  meta_data?: { key?: string | null; value?: unknown }[] | null;
};

/**
 * Claves de `meta_data` donde los plugins guardan el número visible, en orden
 * de preferencia. La «formatted» va primera porque incluye el prefijo y el
 * sufijo que el cliente ve; la otra es solo la parte numérica.
 */
export const CLAVES_NUMERO = [
  "_order_number_formatted",
  "_order_number",
  "_alg_wc_full_custom_order_number",
] as const;

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "string") return v.trim();
  return "";
}

/**
 * El número visible del pedido, o cadena vacía si no hay nada aprovechable.
 *
 * Nunca devuelve el `id` salvo que no exista ninguna otra cosa: es el último
 * recurso para no dejar un pedido sin identificar en pantalla.
 */
export function numeroPedidoWoo(pedido: PedidoWoo | null | undefined): string {
  if (!pedido) return "";

  const metas = Array.isArray(pedido.meta_data) ? pedido.meta_data : [];
  for (const clave of CLAVES_NUMERO) {
    const encontrado = metas.find((m) => m?.key === clave);
    const valor = texto(encontrado?.value);
    if (valor) return valor;
  }

  const numero = texto(pedido.number);
  if (numero) return numero;

  return texto(pedido.id);
}
