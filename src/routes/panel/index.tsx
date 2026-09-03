import { createFileRoute } from "@tanstack/react-router";
import { tabla } from "@/lib/rpc";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVacio } from "@/components/EstadoVacio";
import { eur, metros, numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { usePedidosPeriodo, useLineasPeriodo } from "@/lib/periodo";
import { agruparPorDia, calcularKpis, topPorMetros, variacion } from "@/dominio/kpis";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Euro,
  Receipt,
  ShoppingCart,
  Ruler,
  XCircle,
  TrendingUp,
  TrendingDown,
  Percent,
  Inbox,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/panel/")({
  head: () => ({ meta: [{ title: "Dashboard Global · CRM DTF" }] }),
  component: DashboardGlobal,
});

type Periodo = "mes" | "semana";

function rangoPeriodo(ref: Date, periodo: Periodo) {
  if (periodo === "mes") {
    return { desde: startOfMonth(ref), hasta: endOfMonth(ref) };
  }
  return {
    desde: startOfWeek(ref, { weekStartsOn: 1 }),
    hasta: endOfWeek(ref, { weekStartsOn: 1 }),
  };
}

function rangoAnterior(ref: Date, periodo: Periodo) {
  const refPrev = periodo === "mes" ? addMonths(ref, -1) : addWeeks(ref, -1);
  return rangoPeriodo(refPrev, periodo);
}

function etiquetaPeriodo(ref: Date, periodo: Periodo) {
  if (periodo === "mes") {
    return format(ref, "LLLL yyyy", { locale: es }).replace(/^./, (c) => c.toUpperCase());
  }
  const { desde, hasta } = rangoPeriodo(ref, periodo);
  return `${format(desde, "d MMM", { locale: es })} – ${format(hasta, "d MMM yyyy", { locale: es })}`;
}

function DashboardGlobal() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [ref, setRef] = useState(new Date());

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

  const { desde, hasta } = useMemo(() => rangoPeriodo(ref, periodo), [ref, periodo]);
  const ant = useMemo(() => rangoAnterior(ref, periodo), [ref, periodo]);

  const consultaPedidos = usePedidosPeriodo({ desde, hasta });
  const consultaAnterior = usePedidosPeriodo({ desde: ant.desde, hasta: ant.hasta });
  const consultaLineas = useLineasPeriodo({ desde, hasta });

  const pedidos = useMemo(() => consultaPedidos.data ?? [], [consultaPedidos.data]);
  const pedidosAnt = useMemo(() => consultaAnterior.data ?? [], [consultaAnterior.data]);

  const k = useMemo(() => calcularKpis(pedidos), [pedidos]);
  const kPrev = useMemo(() => calcularKpis(pedidosAnt), [pedidosAnt]);

  const costePer = costeMetro * k.metros;
  const margenPer = k.bruta - costePer;
  const margenPrev = kPrev.bruta - costeMetro * kPrev.metros;

  const ingresosDiarios = useMemo(() => {
    const dias = eachDayOfInterval({ start: desde, end: hasta });
    return agruparPorDia(pedidos, dias).map((d) => ({
      dia: format(d.dia, "d MMM", { locale: es }),
      total: d.total,
    }));
  }, [pedidos, desde, hasta]);

  const topProductos = useMemo(
    () => topPorMetros(consultaLineas.data ?? []),
    [consultaLineas.data],
  );

  const cargando = consultaPedidos.isPending;
  const error = consultaPedidos.error;
  const sinDatos = !cargando && !error && pedidos.length === 0;

  function navegar(dir: -1 | 1) {
    setRef((r) => (periodo === "mes" ? addMonths(r, dir) : addWeeks(r, dir)));
  }

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
          <div className="inline-flex rounded-md border bg-card p-0.5">
            {(["mes", "semana"] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 text-sm font-medium rounded ${
                  periodo === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "mes" ? "Mes" : "Semana"}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 rounded-md border bg-card px-1">
            <Button variant="ghost" size="icon" onClick={() => navegar(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="px-2 text-sm font-medium min-w-[160px] text-center">
              {etiquetaPeriodo(ref, periodo)}
            </div>
            <Button variant="ghost" size="icon" onClick={() => navegar(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => setRef(new Date())}>
            Hoy
          </Button>

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <KPI
              titulo="Total periodo"
              valor={eur(k.total)}
              delta={variacion(k.total, kPrev.total)}
              icon={Euro}
            />
            <KPI
              titulo="Facturación bruta"
              valor={eur(k.bruta)}
              delta={variacion(k.bruta, kPrev.bruta)}
              icon={Receipt}
            />
            <KPI
              titulo="Ticket medio"
              valor={eur(k.ticket)}
              delta={variacion(k.ticket, kPrev.ticket)}
              icon={ShoppingCart}
            />
            <KPI
              titulo="Metros vendidos"
              valor={metros(k.metros)}
              delta={variacion(k.metros, kPrev.metros)}
              icon={Ruler}
            />
            <KPI
              titulo="Cancelados"
              valor={String(k.cancelados)}
              delta={variacion(k.cancelados, kPrev.cancelados)}
              icon={XCircle}
              color="destructive"
              deltaInverso
            />
            <KPI
              titulo={costeMetro === 0 ? "Margen" : "Margen estimado"}
              valor={costeMetro === 0 ? "—" : eur(margenPer)}
              delta={costeMetro === 0 ? null : variacion(margenPer, margenPrev)}
              icon={Percent}
            />
          </div>

          {costeMetro === 0 && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Configura los costes por metro en Ajustes › Datos de la empresa para calcular el
              margen.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ingresos diarios</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ingresosDiarios}>
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

function KPI({
  titulo,
  valor,
  delta,
  icon: Icon,
  color = "primary",
  deltaInverso = false,
}: {
  titulo: string;
  valor: string;
  /** `null` cuando el periodo anterior no da para comparar. */
  delta: number | null;
  icon: LucideIcon;
  color?: "primary" | "destructive";
  deltaInverso?: boolean;
}) {
  const iconBg =
    color === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";
  const valorColor = color === "destructive" ? "text-destructive" : "text-foreground";

  const subiendo = (delta ?? 0) >= 0;
  // En "inverso" (por ejemplo, cancelados), subir es malo.
  const positivo = deltaInverso ? !subiendo : subiendo;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {titulo}
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className={`mt-3 text-3xl font-bold tracking-tight ${valorColor}`}>{valor}</div>
        {delta === null ? (
          <div className="mt-1 text-xs text-muted-foreground">Sin periodo anterior comparable</div>
        ) : (
          <div
            className={`mt-1 flex items-center gap-1 text-xs font-medium ${
              positivo ? "text-status-completado" : "text-status-cancelado"
            }`}
          >
            {subiendo ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {numero(Math.abs(delta), 1)}% vs periodo anterior
          </div>
        )}
      </CardContent>
    </Card>
  );
}
