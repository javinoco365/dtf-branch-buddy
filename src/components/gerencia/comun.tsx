import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
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
