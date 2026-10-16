import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * El panel de la vista previa: el PDF de verdad, generado con la plantilla que
 * se está editando, dentro de un marco. Si el servidor no da los datos, el
 * error sale aquí dentro y el resto del editor sigue funcionando.
 */
export function VistaPreviaPdf({
  numero,
  hayDatos,
  cargando,
  error,
  onReintentar,
  pdf,
  generando,
  errorPdf,
  logoFallido = false,
  llenar = false,
}: {
  /** El presupuesto que se enseña; null si todavía no hay ninguno. */
  numero: string | null | undefined;
  /** Si ya han llegado los datos del servidor. */
  hayDatos: boolean;
  cargando: boolean;
  error: Error | null;
  onReintentar: () => void;
  pdf: { url: string } | null;
  generando: boolean;
  errorPdf: string | null;
  /** El logo no se ha podido cargar en el navegador: la vista previa sale sin él. */
  logoFallido?: boolean;
  /** Ocupar todo el alto disponible (en el ordenador) en vez de la proporción de un A4. */
  llenar?: boolean;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", llenar && "h-full")}>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {error
            ? "Sin vista previa"
            : !hayDatos
              ? "Cargando el último presupuesto…"
              : numero
                ? `Vista previa con el presupuesto ${numero}`
                : "Todavía no hay presupuestos: la vista previa sale sin líneas"}
        </p>
        <div className="flex items-center gap-3">
          {generando && !error && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Actualizando…
            </span>
          )}
          {pdf && !error && (
            <a
              href={pdf.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Abrir en una pestaña
            </a>
          )}
        </div>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-lg border bg-muted/40",
          llenar ? "min-h-0 flex-1" : "aspect-[210/297] w-full",
        )}
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No se ha podido preparar la vista previa</p>
              <p className="mx-auto max-w-xs break-words text-xs text-muted-foreground">
                {error.message || "Error desconocido"}
              </p>
              <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                La plantilla se puede seguir editando y guardando.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onReintentar}>
              <RefreshCw /> Reintentar
            </Button>
          </div>
        ) : pdf ? (
          <VisorPdf url={pdf.url} />
        ) : cargando || generando ? (
          <div className="flex h-full items-start justify-center p-4">
            <Skeleton className="aspect-[210/297] h-auto max-h-full w-full max-w-md bg-muted" />
          </div>
        ) : null}
        {errorPdf && !error && (
          <p className="absolute inset-x-2 bottom-2 rounded-md border border-destructive/40 bg-background/95 px-2.5 py-1.5 text-xs text-destructive">
            No se pudo generar el PDF: {errorPdf}
          </p>
        )}
      </div>
      {logoFallido && !error && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          No se ha podido cargar el logo en la vista previa, que sale sin él. Comprueba que es un
          PNG, JPG o WebP; si es así, súbelo aquí para que el PDF lo lleve seguro.
        </p>
      )}
      {!llenar && pdf && !error && (
        <p className="text-[11px] text-muted-foreground">
          Algunos móviles no enseñan el PDF dentro de la página: si no lo ves, usa «Abrir en una
          pestaña».
        </p>
      )}
    </div>
  );
}

/** Si el visor del PDF no avisa de que ha cargado, se enseña igual pasado este rato. */
const ESPERA_CARGA_MS = 1500;
/** Lo que se le deja al visor para pintar la página después de cargar. */
const PINTADO_MS = 250;

/**
 * El PDF en un marco, sin parpadeo al cambiar: el nuevo se carga debajo,
 * invisible, y solo cuando está listo sustituye al anterior. Así, al arrastrar
 * en el diseñador, la vista previa pasa de un PDF al siguiente sin quedarse en
 * blanco entre medias.
 */
function VisorPdf({ url }: { url: string }) {
  const [mostrada, setMostrada] = useState<string | null>(null);

  // Hay visores (los de algunos móviles) que no avisan al cargar: se enseña igual.
  useEffect(() => {
    const t = setTimeout(() => setMostrada(url), ESPERA_CARGA_MS);
    return () => clearTimeout(t);
  }, [url]);

  const marco = (u: string, visible: boolean) => (
    <iframe
      key={u}
      title="Vista previa del PDF del presupuesto"
      src={`${u}#toolbar=0&navpanes=0&view=Fit`}
      // Un respiro tras cargar: el visor aún tiene que pintar la página.
      onLoad={() => setTimeout(() => setMostrada(u), PINTADO_MS)}
      aria-hidden={!visible || undefined}
      tabIndex={visible ? undefined : -1}
      className={cn("absolute inset-0 h-full w-full bg-white", !visible && "opacity-0")}
    />
  );

  return (
    <>
      {mostrada && mostrada !== url && marco(mostrada, true)}
      {marco(url, mostrada === url || !mostrada)}
    </>
  );
}
