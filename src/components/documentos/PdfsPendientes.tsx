import { useState } from "react";
import { toast } from "sonner";
import { FileWarning, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Tanda = {
  generados: number;
  fallidos: { id: string; referencia: string; motivo: string }[];
  /** Las que siguen sin PDF, sin contar las que acaban de fallar. */
  quedan: number;
};

/**
 * Aviso de documentos emitidos sin su PDF guardado, con el botón para
 * generarlos. Son los de antes de guardarse siempre, los de los tickets en
 * bloque que fallaron y cualquiera cuyo PDF no salió al emitir.
 *
 * El servidor los hace de pocos en pocos (`generar` es una tanda); aquí se
 * repite hasta que no quedan. Los que fallan se le pasan para que no los
 * vuelva a intentar: si no, unos pocos que fallan siempre taparían a todos los
 * de detrás.
 */
export function PdfsPendientes({
  faltan,
  generar,
  alTerminar,
}: {
  faltan: number;
  generar: (excluir: string[]) => Promise<Tanda>;
  alTerminar: () => void;
}) {
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  if (faltan === 0 && !progreso) return null;

  async function lanzar() {
    let hechos = 0;
    let total = faltan;
    const fallidos: Tanda["fallidos"] = [];
    setProgreso({ hechos, total });
    try {
      for (;;) {
        const t = await generar(fallidos.map((f) => f.id));
        hechos += t.generados;
        fallidos.push(...t.fallidos);
        total = hechos + fallidos.length + t.quedan;
        setProgreso({ hechos, total });
        // Sin avance no hay nada más que hacer (y así el bucle no puede ser
        // infinito). Con cien fallos, algo va mal en general: mejor parar.
        if (t.quedan === 0 || t.generados + t.fallidos.length === 0) break;
        if (fallidos.length >= 100) break;
      }
      if (fallidos.length) {
        toast.warning(
          `${fallidos.length} sin PDF: ${fallidos
            .slice(0, 3)
            .map((f) => `${f.referencia} (${f.motivo})`)
            .join(", ")}${fallidos.length > 3 ? "…" : ""}`,
        );
      } else {
        toast.success(`${hechos} PDF guardado(s)`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudieron generar los PDF");
    } finally {
      setProgreso(null);
      alTerminar();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-status-pendiente/40 bg-status-pendiente/5 p-3 text-sm">
      <FileWarning className="h-4 w-4 shrink-0 text-status-pendiente" />
      <span className="flex-1">
        {progreso
          ? `Guardando los PDF… ${progreso.hechos} de ${progreso.total}`
          : `${faltan} documento(s) emitido(s) sin el PDF guardado.`}
      </span>
      <Button size="sm" variant="outline" onClick={lanzar} disabled={!!progreso}>
        {progreso ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Generar los que faltan
      </Button>
    </div>
  );
}
