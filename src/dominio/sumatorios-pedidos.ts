/**
 * Los pies de las listas de pedidos y del historial de un cliente.
 *
 * Qué suma y qué no ya lo deciden `totalesPedidos` y `totalesDocumentos`
 * (sumatorios.ts). Aquí se juntan para estas pantallas y se dice con palabras
 * qué ha contado el pie y qué ha dejado fuera: «Total · 12 pedidos» a secas
 * escondería que había dos cancelados más en la lista, y el que suma a mano
 * las filas no entendería por qué no le cuadra.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 */

import { redondear } from "./importes";
import {
  totalesDocumentos,
  totalesPedidos,
  type TotalesDocumentos,
  type TotalesPedidos,
} from "./sumatorios";

const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «12 pedidos», o «12 pedidos · 2 cancelados aparte» si los hay. */
export function describirPedidos(pedidos: number, cancelados = 0): string {
  const partes = [contar(pedidos, "pedido", "pedidos")];
  if (cancelados > 0) partes.push(`${contar(cancelados, "cancelado", "cancelados")} aparte`);
  return partes.join(" · ");
}

/**
 * «5 documentos · sin 1 borrador · sin 1 ticket canjeado»: los que suman y
 * los que se ven en la lista pero no suman.
 */
export function describirDocumentos(
  t: Pick<TotalesDocumentos, "documentos" | "borradores" | "canjeados">,
): string {
  const partes = [contar(t.documentos, "documento", "documentos")];
  if (t.borradores > 0) partes.push(`sin ${contar(t.borradores, "borrador", "borradores")}`);
  if (t.canjeados > 0) {
    partes.push(`sin ${contar(t.canjeados, "ticket canjeado", "tickets canjeados")}`);
  }
  return partes.join(" · ");
}

/** Lo que suma la ficha de un cliente. */
export type TotalesCliente = {
  tienda: TotalesPedidos;
  textil: TotalesPedidos;
  facturas: TotalesDocumentos;
  /**
   * Lo que ha pedido en total, tiendas y textil juntos y sin cancelados: la
   * suma de los pies de sus dos tablas de pedidos, para que la tarjeta de
   * arriba y los pies de abajo no se contradigan.
   */
  totalPedidos: number;
};

/** Los pies del historial de un cliente y la cifra de «Total pedidos». */
export function totalesCliente(historial: {
  pedidos: Parameters<typeof totalesPedidos>[0];
  pedidosTextil: Parameters<typeof totalesPedidos>[0];
  facturas: Parameters<typeof totalesDocumentos>[0];
}): TotalesCliente {
  const tienda = totalesPedidos(historial.pedidos);
  const textil = totalesPedidos(historial.pedidosTextil);
  return {
    tienda,
    textil,
    facturas: totalesDocumentos(historial.facturas),
    totalPedidos: redondear(tienda.total + textil.total),
  };
}
