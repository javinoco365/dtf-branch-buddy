/**
 * Los importes de un pedido como se enseñan al desplegarlo en la lista.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 *
 * `subtotal` es la base imponible con el envío dentro (en los de WooCommerce,
 * total − IVA; ver importesPedidoWoo), y `envio`, la base del envío. La lista
 * los enseñaba como «Subtotal», «IVA», «Envío» y «Total», como si se sumaran:
 * el envío salía dos veces y las cuatro cifras no cuadraban. Aquí se separa lo
 * vendido del envío, y productos + envío + IVA = total.
 *
 * Con recargo de equivalencia, `iva` guarda los impuestos de WooCommerce
 * enteros (IVA + recargo) y `recargo` la parte del recargo. Aquí salen por
 * separado: productos + envío + IVA + recargo = total.
 */

import { redondear } from "./importes";
import { baseConEnvio, type PedidoResumen } from "./kpis";

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export type DesglosePedido = {
  /** Lo vendido sin el envío, sin IVA. */
  productos: number;
  /** El envío cobrado, sin IVA. */
  envio: number;
  /** Solo el IVA, sin el recargo de equivalencia. */
  iva: number;
  /** El recargo de equivalencia. 0 si no lleva. */
  recargo: number;
  /** El total del pedido, tal cual. */
  total: number;
};

/**
 * Productos y envío sin IVA, el IVA y el total. Vale también para los pedidos
 * manuales antiguos, que guardaban el envío fuera de `subtotal`: baseConEnvio
 * distingue un caso del otro por cuál de las dos sumas da el total.
 */
export function desglosePedido(
  p: Pick<PedidoResumen, "subtotal" | "iva" | "envio" | "total"> & {
    recargo?: number | string | null;
  },
): DesglosePedido {
  const envio = num(p.envio);
  const recargo = redondear(num(p.recargo));
  return {
    productos: redondear(baseConEnvio(p) - envio),
    envio: redondear(envio),
    iva: redondear(num(p.iva) - recargo),
    recargo,
    total: redondear(num(p.total)),
  };
}
