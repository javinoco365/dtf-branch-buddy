import { Percent } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La web le cobró recargo de equivalencia al cliente (un minorista en ese
 * régimen). Se ve en la lista y en el detalle del pedido, al lado de
 * «Factura»: a este pedido no se le hace ticket, y su factura lleva el
 * recargo, que el CRM añade solo.
 */
export function EtiquetaRecargo({
  conTexto = false,
  className,
}: {
  /** En el detalle: con la explicación entera. */
  conTexto?: boolean;
  className?: string;
}) {
  return (
    <span
      title="Recargo de equivalencia: la web se lo cobró. Hazle factura, no ticket; el recargo se añade solo"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0 text-[11px] font-semibold text-primary dark:border-primary/50 dark:bg-primary/25 dark:text-foreground",
        className,
      )}
    >
      <Percent className="h-3 w-3" aria-hidden="true" />
      {conTexto ? "R.E (recargo de equivalencia)" : "R.E"}
      {!conTexto && <span className="sr-only"> (recargo de equivalencia)</span>}
    </span>
  );
}
