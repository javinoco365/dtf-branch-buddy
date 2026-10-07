import { Link } from "@tanstack/react-router";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

/** Un campo de formulario con su etiqueta encima. */
export function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 max-md:w-full">
      <Label className="text-xs">{etiqueta}</Label>
      {children}
    </div>
  );
}

/** Editar y borrar, para la última columna de una tabla. */
export function Acciones({ onEditar, onBorrar }: { onEditar: () => void; onBorrar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Editar"
        onClick={onEditar}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive"
        title="Borrar"
        onClick={onBorrar}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </span>
  );
}
