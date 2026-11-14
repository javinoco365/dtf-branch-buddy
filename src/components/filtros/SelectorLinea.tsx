import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ETIQUETA_FILTRO_LINEA,
  FILTROS_LINEA,
  esFiltroLinea,
  type FiltroLinea,
} from "@/dominio/por-linea";
import { cn } from "@/lib/utils";

/** El selector de línea, igual en todas las pantallas. El UV, en morado. */
export function SelectorLinea({
  valor,
  alCambiar,
  className,
}: {
  valor: FiltroLinea;
  alCambiar: (linea: FiltroLinea) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={valor}
      onValueChange={(v) => esFiltroLinea(v) && alCambiar(v)}
      aria-label="Línea de producto"
      className={className}
    >
      {FILTROS_LINEA.map((l) => (
        <ToggleGroupItem
          key={l}
          value={l}
          className={cn(
            l === "uv" && "data-[state=on]:bg-linea-uv-fondo data-[state=on]:text-linea-uv-texto",
          )}
        >
          {ETIQUETA_FILTRO_LINEA[l]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
