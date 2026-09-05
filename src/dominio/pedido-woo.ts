/**
 * El número de pedido que enseña WooCommerce.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin base de datos ni red.
 *
 * ## El problema
 *
 * WooCommerce tiene dos cosas que parecen la misma:
 *
 *   - `id`     el identificador interno del pedido en la base de WordPress.
 *   - `number` el número que se ve en el panel y en el correo del cliente.
 *
 * **En una tienda sin plugins los dos valen lo mismo**, así que la diferencia
 * no se nota. Con un plugin de numeración, el número visible pasa a ser otro
 * —en DTF Culture, `DCUL-23-2026`— y guardar el `id` significa que el número
 * de aquí no coincide con el que el cliente tiene en su correo. Cuando alguien
 * llama preguntando por «el pedido DCUL-23-2026», no hay forma de encontrarlo.
 *
 * ## Por qué `number` va PRIMERO y no las claves de `meta_data`
 *
 * Porque `number` en la API es el resultado de `$order->get_order_number()`, y
 * eso es exactamente lo que los plugins de numeración sustituyen: si hay
 * plugin, ahí ya viene el número completo y formateado.
 *
 * Las claves de `meta_data` son el respaldo para los plugins que guardan el
 * número pero no filtran esa función. Y van DESPUÉS a propósito: muchos
 * plugins guardan en `_order_number` solo la parte numérica —el `23` de
 * `DCUL-23-2026`— así que preferirla al `number` daría un número incompleto,
 * que es peor que el problema que se venía a resolver.
 *
 * Dentro del respaldo, primero la variante «formatted», que es la que lleva el
 * prefijo y el año.
 */

/** Lo que hace falta de un pedido de la API de WooCommerce. */
export type PedidoWoo = {
  id?: number | string | null;
  number?: number | string | null;
  meta_data?: { key?: string | null; value?: unknown }[] | null;
};

/**
 * Claves de `meta_data` donde los plugins guardan el número, en orden de
 * preferencia. Son las de WooCommerce Sequential Order Numbers, que es la
 * familia más extendida. Si el plugin de DTF Culture usara otra, se añade aquí
 * y no hay que tocar nada más.
 */
export const CLAVES_NUMERO = ["_order_number_formatted", "_order_number"] as const;

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "string") return v.trim();
  return "";
}

/**
 * El número visible del pedido, o cadena vacía si no hay nada aprovechable.
 *
 * El `id` solo se usa cuando no existe ninguna otra cosa: es el último recurso
 * para no dejar un pedido sin identificar en pantalla.
 */
export function numeroPedidoWoo(pedido: PedidoWoo | null | undefined): string {
  if (!pedido) return "";

  const id = texto(pedido.id);
  const numero = texto(pedido.number);

  // Con plugin, `number` ya trae el número completo. Sin plugin vale lo mismo
  // que el id, y entonces conviene mirar antes si hay algo en meta_data.
  if (numero && numero !== id) return numero;

  const metas = Array.isArray(pedido.meta_data) ? pedido.meta_data : [];
  for (const clave of CLAVES_NUMERO) {
    const encontrado = metas.find((m) => m?.key === clave);
    const valor = texto(encontrado?.value);
    if (valor) return valor;
  }

  return numero || id;
}
