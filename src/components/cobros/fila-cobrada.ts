import type { EstadoCobro } from "@/dominio/cobros";

/**
 * El fondo de la fila de un pedido cobrado entero: verde muy suave, para ver
 * de un vistazo lo que falta por cobrar. Los cancelados no se pintan.
 */
export function claseFilaCobrada(estado: EstadoCobro, cancelado: boolean): string | undefined {
  return !cancelado && (estado === "cobrado" || estado === "excedido")
    ? "bg-aviso-bien/70 hover:bg-aviso-bien"
    : undefined;
}
