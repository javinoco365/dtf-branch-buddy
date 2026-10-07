import { createFileRoute } from "@tanstack/react-router";
import { tabla } from "@/lib/rpc";
import { useMemo } from "react";
import { usePeriodoUrl } from "@/lib/filtros-url";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVacio } from "@/components/EstadoVacio";
import { eur, metros } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { useCobrosPeriodo, usePedidosPeriodo, useLineasPeriodo } from "@/lib/periodo";
import { cobrosDeTiendas, totalizar } from "@/dominio/facturacion";
import {
  agruparPorRangos,
  calcularKpis,
  costeProduccion,
  topPorMetros,
  variacion,
} from "@/dominio/kpis";
import { PERIODOS_CUADRO, tramosGrafica } from "@/dominio/periodos";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import {
  Download,
  Euro,
  Receipt,
  ShoppingCart,
  Ruler,
  XCircle,
  Percent,
  Inbox,
  Undo2,
  Wallet,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/panel/")({
  head: () => ({ meta: [{ title: "Dashboard Global · DTF Culture" }] }),
  component: DashboardGlobal,
});

function DashboardGlobal() {
  // El periodo va en la dirección: sobrevive a recargar y se comparte.
  const periodo = usePeriodoUrl("mes");
  const { comparacion } = periodo;
  // Sin «todo» en la lista, siempre hay rango.
  const { desde, hasta } = periodo.rango!;

  const { data: empresa } = useQuery({
    queryKey: ["empresa_costes"],
    queryFn: async () => {
      const { data } = await tabla(supabase, "empresas")
        .select("coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro")
        .eq("activa", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  const costeMetro =
    Number(empresa?.coste_consumibles_metro ?? 0) +
    Number(empresa?.coste_packaging_metro ?? 0) +
    Number(empresa?.coste_electricidad_metro ?? 0);

  const consultaPedidos = usePedidosPeriodo({ desde, hasta });
  // Sin comparación se pide un rango vacío: la consulta existe igual (los
  // ganchos no pueden ser condicionales) pero no trae nada.
  const ant = comparacion?.previo ?? { desde: hasta, hasta: desde };
  const consultaAnterior = usePedidosPeriodo({ desde: ant.desde, hasta: ant.hasta });
  const consultaLineas = useLineasPeriodo({ desde, hasta });
  // Lo cobrado va por la fecha del cobro: el dinero que entró en el periodo,
  // fuera de cuándo se hizo el pedido.
  const consultaCobros = useCobrosPeriodo({ desde, hasta }, "cobro");
  const consultaCobrosAnt = useCobrosPeriodo(ant, "cobro");

  const pedidos = useMemo(() => consultaPedidos.data ?? [], [consultaPedidos.data]);
  const pedidosAnt = useMemo(() => consultaAnterior.data ?? [], [consultaAnterior.data]);

  const k = useMemo(() => calcularKpis(pedidos), [pedidos]);
  const kPrev = useMemo(() => calcularKpis(pedidosAnt), [pedidosAnt]);
  const cobrosDisponibles = consultaCobros.data?.disponible ?? false;
  const cobrado = totalizar(cobrosDeTiendas(consultaCobros.data?.cobros ?? [])).cobrado;
  const cobradoPrev = totalizar(cobrosDeTiendas(consultaCobrosAnt.data?.cobros ?? [])).cobrado;

  // Cada pedido con el coste que tenía al crearse; los de antes de congelarlo,
  // con el de hoy.
  const costePer = costeProduccion(pedidos, costeMetro);
  const margenPer = k.bruta - costePer;
  const margenPrev = kPrev.bruta - costeProduccion(pedidosAnt, costeMetro);
  // Sin ningún coste, ni de hoy ni congelado, el «margen» sería la bruta.
  const sinCostes = costeMetro === 0 && costePer === 0;

  const grafica = useMemo(() => {
    const { por, tramos } = tramosGrafica({ desde, hasta });
    const totales = agruparPorRangos(pedidos, tramos);
    return { por, datos: tramos.map((t, i) => ({ dia: t.etiqueta, total: totales[i].total })) };
  }, [pedidos, desde, hasta]);

  const topProductos = useMemo(
    () => topPorMetros(consultaLineas.data ?? []),
    [consultaLineas.data],
  );

  const cargando = consultaPedidos.isPending;
  const error = consultaPedidos.error;
  const sinDatos = !cargando && !error && pedidos.length === 0;

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Tienda", "Estado", "Metros", "Base", "IVA", "Envío", "Total"],
      ...pedidos.map((p) => [
        format(new Date(p.fecha_pedido), "yyyy-MM-dd"),
        p.tienda_id,
        p.estado,
        Number(p.metros_total ?? 0),
        Number(p.subtotal ?? 0),
        Number(p.iva ?? 0),
        Number(p.envio ?? 0),
        Number(p.total ?? 0),
      ]),
    ];
    const nombre = `dashboard-global_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`;
    descargarCSV(nombre, filas);
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard Global</h1>
          <p className="text-muted-foreground">Vista consolidada agregando todas las tiendas</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />

          <Button onClick={exportar} size="sm" disabled={pedidos.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se han podido cargar los pedidos: {error.message}
          </CardContent>
        </Card>
      )}

      {cargando && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {sinDatos && (
        <EstadoVacio
          icono={Inbox}
          titulo="Sin pedidos en este periodo"
          descripcion={`No hay ningún pedido registrado entre el ${format(desde, "d 'de' MMMM", { locale: es })} y el ${format(hasta, "d 'de' MMMM 'de' yyyy", { locale: es })}. Cambia de periodo o sincroniza una tienda para ver datos aquí.`}
        />
      )}

      {!cargando && !error && !sinDatos && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaKpi
              titulo="Vendido"
              explicacion="vendido"
              valor={eur(k.total)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.total, kPrev.total)}
              icon={Euro}
            />
            <TarjetaKpi
              titulo="Facturación bruta"
              explicacion="bruta"
              valor={eur(k.bruta)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.bruta, kPrev.bruta)}
              icon={Receipt}
            />
            <TarjetaKpi
              titulo="Cobrado"
              explicacion="cobrado"
              valor={cobrosDisponibles ? eur(cobrado) : "—"}
              frente={comparacion?.etiqueta}
              delta={cobrosDisponibles ? variacion(cobrado, cobradoPrev) : null}
              icon={Wallet}
            />
            <TarjetaKpi
              titulo={sinCostes ? "Margen" : "Margen estimado"}
              explicacion="margen"
              valor={sinCostes ? "—" : eur(margenPer)}
              delta={sinCostes ? null : variacion(margenPer, margenPrev)}
              frente={comparacion?.etiqueta}
              icon={Percent}
            />
            <TarjetaKpi
              titulo="Ticket medio"
              explicacion="ticket"
              valor={eur(k.ticket)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.ticket, kPrev.ticket)}
              icon={ShoppingCart}
            />
            <TarjetaKpi
              titulo="Metros vendidos"
              explicacion="metros"
              valor={metros(k.metros)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.metros, kPrev.metros)}
              icon={Ruler}
            />
            <TarjetaKpi
              titulo="Devoluciones"
              explicacion="devoluciones"
              valor={eur(k.devuelto)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.devuelto, kPrev.devuelto)}
              icon={Undo2}
              deltaInverso
            />
            <TarjetaKpi
              titulo="Cancelados"
              explicacion="cancelados"
              valor={String(k.cancelados)}
              frente={comparacion?.etiqueta}
              delta={variacion(k.cancelados, kPrev.cancelados)}
              icon={XCircle}
              color="destructive"
              deltaInverso
            />
          </div>

          {sinCostes && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Configura los costes por metro en Ajustes › Datos de la empresa para calcular el
              margen.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {grafica.por === "dia" ? "Ingresos por día" : "Ingresos por mes"}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grafica.datos}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(v: number) => eur(v)}
                      labelStyle={{ color: "var(--color-foreground)" }}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top productos por metros</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {consultaLineas.isPending ? (
                  <Skeleton className="h-full w-full" />
                ) : topProductos.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Los pedidos de este periodo no tienen líneas de detalle.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductos} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v} m`}
                      />
                      <YAxis
                        type="category"
                        dataKey="producto"
                        width={140}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(v: number) => metros(v)}
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                        }}
                      />
                      <Bar dataKey="metros" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
