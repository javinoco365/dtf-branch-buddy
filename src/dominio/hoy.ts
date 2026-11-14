/**
 * El bloque «Hoy» de Inicio: lo que hay que hacer hoy, en cuatro números.
 *
 * - Por producir: pedidos que aún no se han impreso (pendientes, en
 *   producción o imprimiendo), de las tiendas y del textil. Los de la web sin
 *   pagar no: hasta que se pagan no se hacen.
 * - Por enviar: los que están listos y esperan a salir.
 * - Cobros pendientes y tareas de la Agenda salen de su sitio (cuenta.ts,
 *   agenda.ts): aquí solo se cuentan los pedidos.
 *
 * Lógica pura: se prueba sin base de datos.
 */

/** Un pedido abierto con lo justo para contarlo. */
export type PedidoAbierto = {
  estado: string;
  /** «web», «manual» o «textil». */
  canal: string;
};

export const ESTADOS_POR_PRODUCIR = ["pendiente", "en_produccion", "imprimiendo"] as const;
export const ESTADO_POR_ENVIAR = "listo";

export type PedidosDeHoy = { porProducir: number; porEnviar: number };

export function pedidosDeHoy(pedidos: readonly PedidoAbierto[]): PedidosDeHoy {
  let porProducir = 0;
  let porEnviar = 0;
  for (const p of pedidos) {
    if (p.estado === ESTADO_POR_ENVIAR) porEnviar++;
    else if (
      (ESTADOS_POR_PRODUCIR as readonly string[]).includes(p.estado) &&
      !(p.canal === "web" && p.estado === "pendiente")
    ) {
      porProducir++;
    }
  }
  return { porProducir, porEnviar };
}
