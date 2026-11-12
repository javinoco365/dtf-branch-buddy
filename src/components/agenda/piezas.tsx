// Piezas visuales de la Agenda que comparten la lista, el panel y el
// calendario. El color de una tarea es SOLO el de su prioridad (tokens
// --prioridad-* de src/styles.css); el verde, que está realizada.
import { Check } from "lucide-react";
import type { Prioridad } from "@/dominio/agenda";
import { CLASES_PRIORIDAD, CLASES_REALIZADA, prioridadDe } from "./estilos";
import { iniciales } from "@/dominio/quien-soy";
import { cn } from "@/lib/utils";

export function PuntoPrioridad({
  prioridad,
  className,
}: {
  prioridad: Prioridad;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]",
        CLASES_PRIORIDAD[prioridad].punto,
        className,
      )}
    />
  );
}

/** «● !! Urgente»: color, marca y nombre, para no depender solo del color. */
export function EtiquetaPrioridad({
  prioridad,
  className,
}: {
  prioridad: Prioridad;
  className?: string;
}) {
  const p = prioridadDe(prioridad);
  const c = CLASES_PRIORIDAD[prioridad];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        c.suave,
        c.texto,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-[3px]", c.punto)} />
      {p.marca && <span aria-hidden="true">{p.marca}</span>}
      {p.nombre}
    </span>
  );
}

export function EtiquetaRealizada({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        CLASES_REALIZADA.suave,
        CLASES_REALIZADA.texto,
        className,
      )}
    >
      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> Realizada
    </span>
  );
}

export function Avatar({
  nombre,
  yo,
  className,
}: {
  nombre: string;
  yo?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold tracking-wide",
        yo ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-foreground",
        className,
      )}
    >
      {iniciales(nombre)}
    </span>
  );
}
