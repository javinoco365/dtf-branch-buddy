import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { eur } from "@/lib/format";
import { devolucionesDelPedido, type DevolucionDePedido } from "@/dominio/cobros";

/**
 * Lo reembolsado en WooCommerce de un pedido. La sincronización ya lo guarda
 * (pedido_devoluciones) y el cobro de la web ya lo descuenta, pero en la lista
 * no se veía: un pedido devuelto en parte parecía uno normal.
 *
 * Solo los reembolsos de la web: la rebaja del importe real se ve en Cobros.
 * Sin reembolsos no pinta nada.
 */
export function EtiquetaDevuelto({
  devoluciones,
  conTexto = false,
  className,
}: {
  devoluciones: readonly DevolucionDePedido[] | null | undefined;
  /** En el detalle: con la explicación entera. */
  conTexto?: boolean;
  className?: string;
}) {
  const { reembolsado } = devolucionesDelPedido(devoluciones);
  if (!(reembolsado > 0)) return null;
  const importe = eur(reembolsado);
  return (
    <span
      title={`Se devolvieron ${importe} al cliente desde WooCommerce. Ya está descontado de lo cobrado.`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[11px] font-semibold text-amber-800 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200",
        className,
      )}
    >
      <Undo2 className="h-3 w-3" aria-hidden="true" />
      {conTexto ? `Devuelto ${importe} (reembolso en la web)` : `Devuelto ${importe}`}
    </span>
  );
}
