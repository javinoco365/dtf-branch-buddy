import { Loader2 } from "lucide-react";

/**
 * Aviso de que lo que se ve es del periodo anterior mientras llega el nuevo
 * (consultas con `placeholderData`, ver `delPeriodoAnterior` en
 * src/lib/cache.ts). Sin `activo` no pinta nada: la pantalla queda igual.
 */
export function AvisoActualizando({ activo }: { activo: boolean }) {
  if (!activo) return null;
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Actualizando… Hasta que termine, las cifras son las del periodo de antes.
    </div>
  );
}
