import type { EstadoCobro } from "@/dominio/cobros";

/**
 * El fondo de la fila de un pedido cobrado entero: verde muy suave, para ver
 * de un vistazo lo que falta por cobrar. Los cancelados no se pintan.
 */
export function claseFilaCobrada(estado: EstadoCobro, cancelado: boolean): string | undefined {
  return !cancelado && (estado === "cobrado" || estado === "excedido")
    ? "bg-emerald-50/70 hover:bg-emerald-50 dark:bg-emerald-950/20"
    : undefined;
}
