import { cn } from "@/lib/utils";

/**
 * Para la zona de datos mientras son del periodo anterior: atenuada y sin
 * poder tocarla (`inert`: ni clics ni teclado), para no exportar ni actuar
 * sobre lo que ya no es lo que se ha pedido. Sin `activo`, nada.
 */
export function propsDatosDeAntes(activo: boolean, className?: string) {
  return {
    inert: activo || undefined,
    "aria-busy": activo || undefined,
    className: cn(className, activo && "opacity-60 transition-opacity") || undefined,
  };
}
