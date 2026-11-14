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

import { diaDelPedido } from "./dia-pedido";
import { TIENDA_TEXTIL } from "./cobros";
import type { PedidoPendiente } from "./pendientes";

/** Un pedido abierto con lo justo para contarlo. */
export type PedidoAbierto = {
  estado: string;
  /** «web», «manual» o «textil». */
  canal: string;
};

const ESTADOS_POR_PRODUCIR = ["pendiente", "en_produccion", "imprimiendo"] as const;
const ESTADO_POR_ENVIAR = "listo";

export type PedidosDeHoy = { porProducir: number; porEnviar: number };

/** Si un pedido abierto está por producir (sin la web sin pagar). */
export function estaPorProducir(p: PedidoAbierto): boolean {
  return (
    (ESTADOS_POR_PRODUCIR as readonly string[]).includes(p.estado) &&
    !(p.canal === "web" && p.estado === "pendiente")
  );
}

/** Si un pedido abierto está listo para enviar. */
export function estaPorEnviar(p: PedidoAbierto): boolean {
  return p.estado === ESTADO_POR_ENVIAR;
}

export function pedidosDeHoy(pedidos: readonly PedidoAbierto[]): PedidosDeHoy {
  return {
    porProducir: pedidos.filter(estaPorProducir).length,
    porEnviar: pedidos.filter(estaPorEnviar).length,
  };
}

/** Un pedido de las listas de «Hoy», de tienda o del textil. */
export type FilaPedidoHoy = {
  id: string;
  numero: string;
  cliente: string | null;
  /** La tienda, o TIENDA_TEXTIL.id. */
  tiendaId: string;
  estado: string;
  /** El día del pedido, 'yyyy-mm-dd' (el de su ticket: ver dia-pedido.ts). */
  fecha: string;
  /** Lo que se enseña a la derecha: el total o lo pendiente. */
  importe: number;
};

/** Un pedido abierto del taller, con lo que hace falta para listarlo. */
export type PedidoAbiertoListable = PedidoAbierto & {
  id?: string;
  numero?: string | null;
  cliente_nombre?: string | null;
  tienda_id: string;
  fecha_pedido: string;
  total?: number | string | null;
};

/** Los pedidos que cuenta «Por producir» o «Por enviar», para listarlos. */
export function filasDelTaller(
  pedidos: readonly PedidoAbiertoListable[],
  cuales: "producir" | "enviar",
): FilaPedidoHoy[] {
  const entra = cuales === "producir" ? estaPorProducir : estaPorEnviar;
  return pedidos
    .filter((p) => entra(p) && !!p.id)
    .map((p) => ({
      id: p.id!,
      numero: p.numero ?? p.id!,
      cliente: p.cliente_nombre ?? null,
      tiendaId: p.tienda_id,
      estado: p.estado,
      fecha: diaDelPedido({
        fecha_pedido: p.fecha_pedido,
        origen: p.canal === "web" ? "woocommerce" : "manual",
      }),
      importe: Number(p.total) || 0,
    }));
}

/** Los pedidos por cobrar (ya elegidos: ver listaPorCobrarHoy), para listarlos. */
export function filasPorCobrar(pendientes: readonly PedidoPendiente[]): FilaPedidoHoy[] {
  return pendientes.map((p) => ({
    id: p.id,
    numero: p.numero,
    cliente: p.cliente_nombre,
    tiendaId: p.tipo === "textil" ? TIENDA_TEXTIL.id : (p.tienda_id ?? ""),
    estado: p.estado,
    fecha: p.fecha,
    importe: Number(p.pendiente) || 0,
  }));
}
