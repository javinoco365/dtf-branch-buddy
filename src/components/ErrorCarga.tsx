import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { errorLegible } from "@/lib/errores";
import { useReintentarFallidas } from "@/lib/reintentar";
import { cn } from "@/lib/utils";

type Props = {
  /** Lo que se lanzó al leer. */
  error: unknown;
  /**
   * Vuelve a pedir los datos: el `refetch` de la consulta. Sin él, se vuelven
   * a pedir todas las lecturas que han fallado.
   */
  onReintentar?: () => unknown;
  /** Mientras se vuelve a pedir: el botón no se pulsa dos veces. */
  reintentando?: boolean;
  /** Qué no se pudo cargar, en minúscula: «los cobros pendientes». */
  que?: string;
  /** Dentro de una tabla: ocupa una fila entera con estas columnas. */
  colSpan?: number;
  /** Sin tarjeta alrededor, para meterlo en una que ya hay. */
  sinMarco?: boolean;
  /** En una línea, dentro de una tarjeta o de una lista: el motivo y «Reintentar». */
  compacto?: boolean;
  className?: string;
};

/**
 * Lo que se enseña cuando una lectura falla.
 *
 * Antes, con un error de lectura, muchas pantallas enseñaban su estado vacío:
 * «Sin cobros pendientes» con una marca verde cuando en realidad no se había
 * podido leer nada. Eso es peor que un error: te dice que todo está en orden.
 * Aquí se dice que no se pudo cargar, por qué (en castellano llano) y se deja
 * volver a intentarlo. Los tres casos van siempre separados: cargando, error
 * y vacío. El vacío solo se enseña cuando la lectura salió bien.
 */
export function ErrorCarga({
  error,
  onReintentar,
  reintentando = false,
  que = "los datos",
  colSpan,
  sinMarco = false,
  compacto = false,
  className,
}: Props) {
  const { texto } = errorLegible(error, "Error desconocido");
  const fallidas = useReintentarFallidas();
  const alReintentar = onReintentar ?? fallidas.reintentar;
  const enCurso = onReintentar ? reintentando : fallidas.reintentando;

  if (compacto) {
    return (
      <p role="alert" className={cn("text-sm text-destructive", className)}>
        No se pudieron cargar {que}: {texto}{" "}
        <button
          type="button"
          disabled={enCurso}
          onClick={() => void alReintentar()}
          className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
        >
          {enCurso ? "Reintentando…" : "Reintentar"}
        </button>
      </p>
    );
  }

  const contenido = (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        sinMarco && className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">No se pudieron cargar {que}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      <Button variant="outline" size="sm" disabled={enCurso} onClick={() => void alReintentar()}>
        <RotateCw className={cn("mr-1.5 h-4 w-4", enCurso && "animate-spin")} />
        {enCurso ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  );

  if (colSpan) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="p-0">
          {contenido}
        </TableCell>
      </TableRow>
    );
  }
  if (sinMarco) return contenido;
  return (
    <Card className={className}>
      <CardContent className="p-0">{contenido}</CardContent>
    </Card>
  );
}
