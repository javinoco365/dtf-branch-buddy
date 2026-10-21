import { lazy, Suspense, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { GastoFijo, Objetivo } from "@/dominio/gerencia";

// El contenido de la ventana se carga al abrirla: Gerencia no tiene que
// descargarlo para enseñar sus cifras. Solo se importa así, con import().
const ContenidoResumenDiario = lazy(() =>
  import("./ResumenDiario").then((m) => ({ default: m.ContenidoResumenDiario })),
);

type Tienda = { id: string; nombre: string; color?: string | null };

/**
 * El botón «Resumen diario» de Gerencia y su ventana: cómo ha ido el día (o
 * la semana, el mes…), por tienda y textil, para los socios. Página 1, el
 * esquema; página 2, el desglose. Se imprime (o se guarda en PDF) con una
 * página para cada parte.
 */
export function BotonResumenDiario(props: {
  tiendas: readonly Tienda[];
  /** Los gastos fijos con las compras que cuentan como gasto; nulo mientras cargan. */
  gastos: readonly GastoFijo[] | null;
  objetivos: readonly Objetivo[];
}) {
  const [abierto, setAbierto] = useState(false);
  // El generador del PDF de los socios se pide al abrir la ventana, no al
  // pulsar «Descargar»: cuando se pulsa ya está.
  useEffect(() => {
    if (abierto) void import("@/lib/pdf-informe-socios").catch(() => undefined);
  }, [abierto]);
  return (
    <>
      <Button size="sm" onClick={() => setAbierto(true)} className="max-md:w-full">
        <CalendarClock className="h-4 w-4" />
        Resumen diario
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="resumen-imprimible grid-cols-1 max-w-6xl max-h-[94vh] overflow-y-auto max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:p-4">
          {/* Solo montado mientras está abierto: cerrado no lee nada. */}
          {abierto && (
            <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
              <ContenidoResumenDiario {...props} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
