import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Lo que se enseña cuando no hay datos.
 *
 * Existe para que ninguna pantalla tenga la tentación de rellenar el hueco con
 * cifras de ejemplo: un periodo sin ventas es información, no un fallo.
 */
export function EstadoVacio({
  icono: Icono,
  titulo,
  descripcion,
  accion,
}: {
  icono: LucideIcon;
  titulo: string;
  descripcion: string;
  accion?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icono className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{titulo}</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{descripcion}</p>
        </div>
        {accion}
      </CardContent>
    </Card>
  );
}
