import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El cliente marcó «Quiero factura» en la web. Se ve en la lista y en el
 * detalle del pedido: a este pedido no se le hace ticket, sino factura.
 */
export function EtiquetaPideFactura({
  conTexto = false,
  className,
}: {
  /** En el detalle: con la explicación entera. */
  conTexto?: boolean;
  className?: string;
}) {
  return (
    <span
      title="El cliente marcó «Quiero factura» en la web: hazle factura, no ticket"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0 text-[11px] font-semibold text-primary dark:border-primary/50 dark:bg-primary/25 dark:text-foreground",
        className,
      )}
    >
      <FileText className="h-3 w-3" aria-hidden="true" />
      {conTexto ? "Quiere factura (lo marcó en la web)" : "Quiere factura"}
    </span>
  );
}
