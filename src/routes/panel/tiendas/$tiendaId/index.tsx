import { createFileRoute } from "@tanstack/react-router";
import { faltaLaColumna, tabla } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { metros, numero } from "@/lib/format";
import { useCuentaResultados } from "@/lib/cuenta";
import { ETIQUETA_FILTRO_LINEA } from "@/dominio/por-linea";
import { variacion } from "@/dominio/kpis";
import { useLineaUrl } from "@/lib/filtros-url";
import { SelectorLinea } from "@/components/filtros/SelectorLinea";
import { compararCon, rangoDe } from "@/dominio/periodos";
import { TarjetaConcepto, TarjetaKpi } from "@/components/TarjetaKpi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { mensajeDeError } from "@/lib/errores";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { Clock, Euro, FileText, Package, Percent, Ruler, ShoppingCart, Wallet } from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/")({
  component: Dashboard,
});

function Dashboard() {
  const { tiendaId } = Route.useParams();
  const { data: tiendas } = useTiendasMenu();
  const nombreTienda = tiendas?.find((t) => t.id === tiendaId)?.nombre;
  const { data } = useQuery({
    queryKey: ["tienda-dashboard", tiendaId],
    queryFn: async () => {
      // metros_uv viene de 20261110100000: sin ella, se lee como antes.
      const leerPedidos = async () => {
        const r = await tabla(supabase, "pedidos")
          .select("metros_total, metros_uv, estado")
          .eq("tienda_id", tiendaId);
        if (!faltaLaColumna(r.error)) return r;
        return tabla(supabase, "pedidos").select("metros_total, estado").eq("tienda_id", tiendaId);
      };
      const [pedidos, facturas] = await Promise.all([
        leerPedidos(),
        // Solo cuántas: sin bajar las filas (y sin el tope de 1000 de Supabase).
        supabase
          .from("facturas")
          .select("id", { count: "exact", head: true })
          .eq("tienda_id", tiendaId),
      ]);
      const filas = (pedidos.data ?? []) as {
        metros_total: number | null;
        metros_uv?: number | null;
      }[];
      return { pedidos: filas, facturas: facturas.count ?? 0 };
    },
  });
  const pedidos = data?.pedidos ?? [];
  // Los metros de cada línea, por separado: no se suman entre sí.
  const mts = pedidos.reduce((s, p) => s + Number(p.metros_total ?? 0), 0);
  const mtsUv = pedidos.reduce((s, p) => s + Number(p.metros_uv ?? 0), 0);

  // El mes en curso con la cuenta de resultados (cuenta.ts) y comparado con
  // el mismo trozo del mes anterior: el día 5, contra del 1 al 5 del mes pasado.
  const hoy = useMemo(() => new Date(), []);
  const mes = useMemo(() => rangoDe({ tipo: "mes", ref: hoy })!, [hoy]);
  const comparacion = useMemo(
    () => compararCon({ tipo: "mes", ref: hoy }, "anterior", hoy)!,
    [hoy],
  );
  // La línea de producto (por-linea.ts): las dos, DTF o DTF UV.
  const [linea, cambiarLinea] = useLineaUrl();
  const filtro = useMemo(() => ({ tienda: tiendaId, linea }), [tiendaId, linea]);
  const lectura = useCuentaResultados({
    rango: mes,
    previo: comparacion.previo,
    filtro,
    soloTienda: true,
    gastos: false,
  });
  const { cuenta, previa } = lectura;
  const frente = comparacion.etiqueta;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Resumen{nombreTienda ? ` · ${nombreTienda}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          El mes en curso, sin IVA salvo el dinero, frente al mismo trozo del mes anterior; y los
          totales de la tienda.
          {linea !== "todo"
            ? ` El mes en curso, solo ${ETIQUETA_FILTRO_LINEA[linea]}; los totales, de toda la tienda.`
            : ""}
        </p>
        <SelectorLinea valor={linea} alCambiar={cambiarLinea} className="mt-2" />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Este mes</h2>
        {lectura.error && (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-destructive">
              <span>No se han podido cargar las cifras: {mensajeDeError(lectura.error)}</span>
              <Button size="sm" variant="outline" onClick={lectura.reintentar}>
                Reintentar
              </Button>
            </CardContent>
          </Card>
        )}
        {lectura.cargando && (
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
            ))}
          </div>
        )}
        {cuenta && (
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            <TarjetaConcepto
              clave="ventas_netas"
              cifra={cuenta.ventas_netas}
              previa={previa?.ventas_netas}
              frente={frente}
              icon={Euro}
              pie={
                <span className="text-muted-foreground">
                  {numero(cuenta.pedidos, 0)} {cuenta.pedidos === 1 ? "pedido" : "pedidos"}
                </span>
              }
            />
            <TarjetaConcepto
              clave="margen_bruto"
              cifra={cuenta.margen_bruto}
              previa={previa?.margen_bruto}
              frente={frente}
              icon={Percent}
              pie={
                cuenta.margenPct !== null ? (
                  <span className="text-muted-foreground">
                    {numero(cuenta.margenPct, 1)}&nbsp;% de las ventas netas
                  </span>
                ) : undefined
              }
            />
            <TarjetaConcepto
              clave="cobrado"
              cifra={cuenta.cobrado}
              previa={previa?.cobrado}
              frente={frente}
              icon={Wallet}
            />
            <TarjetaConcepto
              clave="pendiente_cobro"
              cifra={cuenta.pendiente_cobro}
              icon={Clock}
              pie={<span className="text-muted-foreground">Hoy, sea del mes que sea</span>}
            />
            {linea !== "uv" && (
              <TarjetaKpi
                titulo="Metros de DTF"
                explicacion="metros"
                valor={metros(cuenta.metros)}
                frente={frente}
                delta={previa ? variacion(cuenta.metros, previa.metros) : null}
                icon={Package}
              />
            )}
            {(linea === "uv" || cuenta.metrosUv > 0) && (
              <TarjetaKpi
                titulo="Metros de DTF UV"
                explicacion="metros"
                valor={metros(cuenta.metrosUv)}
                frente={frente}
                delta={previa ? variacion(cuenta.metrosUv, previa.metrosUv) : null}
                icon={Package}
              />
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Desde el principio</h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
          <TarjetaKpi
            titulo="Pedidos"
            valor={String(pedidos.length)}
            delta={null}
            icon={ShoppingCart}
          />
          <TarjetaKpi
            titulo="Metros"
            valor={metros(mts)}
            delta={null}
            icon={Ruler}
            pie={
              mtsUv > 0 ? (
                <span className="text-muted-foreground">
                  De DTF. Aparte,{" "}
                  <span className="font-medium text-violet-700 dark:text-violet-300">
                    {metros(mtsUv)} de DTF UV
                  </span>
                </span>
              ) : undefined
            }
          />
          <TarjetaKpi
            titulo="Facturas"
            valor={String(data?.facturas ?? 0)}
            delta={null}
            icon={FileText}
          />
        </div>
      </section>
    </div>
  );
}
