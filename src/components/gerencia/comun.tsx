import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Destino } from "./destinos";

/** «Ver detalle →», a la pantalla con la lista que hay detrás de una cifra. */
export function VerDetalle({
  destino,
  texto = "Ver detalle",
}: {
  destino: Destino;
  texto?: string;
}) {
  return (
    <Link
      to={destino.to as never}
      search={destino.search as never}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {texto} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

/** Una línea de aviso dentro de una pestaña: un estado vacío o una aclaración. */
export function Nota({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

/** Mientras carga una pestaña: el hueco de las tarjetas. */
export function CargandoPestana() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Si una lectura falla, se dice cuál y por qué, sin tumbar las demás pestañas. */
export function ErrorPestana({ que, error }: { que: string; error: Error }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">
        No se han podido cargar {que}: {error.message}
      </CardContent>
    </Card>
  );
}
