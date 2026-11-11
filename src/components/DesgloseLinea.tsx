import { cn } from "@/lib/utils";

/**
 * Debajo de una cifra de «Todo», de qué línea es cada parte: «DTF 3.200 € ·
 * UV 200 €». Los valores llegan ya formateados (`eur`, `metros`…) y calculados
 * en src/dominio/por-linea.ts: aquí solo se pintan, el UV en morado.
 */
export function DesgloseLinea({
  dtf,
  uv,
  className,
}: {
  dtf: string;
  uv: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-x-2 text-xs text-muted-foreground", className)}>
      <span>
        DTF <span className="font-medium text-foreground tabular-nums">{dtf}</span>
      </span>
      <span aria-hidden>·</span>
      <span>
        UV{" "}
        <span className="font-medium tabular-nums text-violet-700 dark:text-violet-300">{uv}</span>
      </span>
    </div>
  );
}
