import { lazy, Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Las gráficas de las pantallas del panel, cargadas aparte (React.lazy): la
 * librería de gráficas pesa ~100 KB comprimida y antes se descargaba entera
 * antes de enseñar ninguna cifra. Ahora las cifras salen primero y la gráfica
 * un instante después, con un esqueleto que ocupa lo mismo (el contenedor de
 * la gráfica ya tiene su alto).
 *
 * Los ficheros de cada gráfica solo se importan desde aquí y con import().
 */
export const IngresosPorTramo = lazy(() =>
  import("./IngresosPorTramo").then((m) => ({ default: m.IngresosPorTramo })),
);
export const TopProductosMetros = lazy(() =>
  import("./TopProductosMetros").then((m) => ({ default: m.TopProductosMetros })),
);
export const ComparativaTiendas = lazy(() =>
  import("./ComparativaTiendas").then((m) => ({ default: m.ComparativaTiendas })),
);
export const CobradoPorSemana = lazy(() =>
  import("./CobradoPorSemana").then((m) => ({ default: m.CobradoPorSemana })),
);

/** Mientras llega la gráfica, un esqueleto del mismo tamaño que su hueco. */
export function ConGrafica({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Skeleton className="h-full w-full" />}>{children}</Suspense>;
}
