import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { eur, metros, numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { usePedidosPeriodo, useTiendas } from "@/lib/periodo";
import { agruparPorRangos, agruparPorTienda, calcularKpis, variacion } from "@/dominio/kpis";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Receipt,
  Percent,
  Store,
  Truck,
  Wallet,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

export const Route = createFileRoute("/panel/facturacion-global")({
  head: () => ({ meta: [{ title: "Facturación Consolidada · CRM DTF" }] }),
  component: FacturacionGlobal,
});

type Periodo = "mes" | "semana";

/** Cuántas semanas muestra la serie histórica. */
const SEMANAS_HISTORICO = 12;

function rangoPeriodo(ref: Date, periodo: Periodo) {
  if (periodo === "mes") return { desde: startOfMonth(ref), hasta: endOfMonth(ref) };
  return {
    desde: startOfWeek(ref, { weekStartsOn: 1 }),
    hasta: endOfWeek(ref, { weekStartsOn: 1 }),
  };
}

function etiquetaPeriodo(ref: Date, periodo: Periodo) {
  if (periodo === "mes") {
    return format(ref, "LLLL yyyy", { locale: es }).replace(/^./, (c) => c.toUpperCase());
  }
  const { desde, hasta } = rangoPeriodo(ref, periodo);
  return `${format(desde, "d MMM", { locale: es })} – ${format(hasta, "d MMM yyyy", { locale: es })}`;
}

/** Las últimas N semanas naturales, de la más antigua a la actual. */
function semanasRecientes(hoy: Date, cuantas: number) {
  const finActual = endOfWeek(hoy, { weekStartsOn: 1 });
  return Array.from({ length: cuantas }, (_, i) => {
    const ref = addWeeks(finActual, i - (cuantas - 1));
    return {
      desde: startOfWeek(ref, { weekStartsOn: 1 }),
      hasta: endOfWeek(ref, { weekStartsOn: 1 }),
    };
  });
}

const COLORES_BARRA = [
  "var(--color-primary)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function FacturacionGlobal() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [ref, setRef] = useState(new Date());

  const { desde, hasta } = useMemo(() => rangoPeriodo(ref, periodo), [ref, periodo]);

  const consultaTiendas = useTiendas();
  const consultaPedidos = usePedidosPeriodo({ desde, hasta });

  // Una sola consulta para las doce semanas, no una por barra.
  const semanas = useMemo(() => semanasRecientes(new Date(), SEMANAS_HISTORICO), []);
  const consultaHistorico = usePedidosPeriodo({
    desde: semanas[0].desde,
    hasta: semanas[semanas.length - 1].hasta,
  });

  const tiendas = useMemo(() => consultaTiendas.data ?? [], [consultaTiendas.data]);
  const pedidos = useMemo(() => consultaPedidos.data ?? [], [consultaPedidos.data]);

  const filas = useMemo(() => agruparPorTienda(pedidos, tiendas), [pedidos, tiendas]);
  const totales = useMemo(() => calcularKpis(pedidos), [pedidos]);

  const historico = useMemo(
    () =>
      agruparPorRangos(consultaHistorico.data ?? [], semanas).map((s) => ({
        semana: format(s.desde, "d MMM", { locale: es }),
        total: s.total,
      })),
    [consultaHistorico.data, semanas],
  );

  const deltaSemana = useMemo(() => {
    if (historico.length < 2) return null;
    return variacion(historico[historico.length - 1].total, historico[historico.length - 2].total);
  }, [historico]);

  const pctIva = totales.bruta === 0 ? 0 : (totales.iva / totales.bruta) * 100;

  const comparativa = filas
    .filter((f) => f.total > 0)
    .map((f) => ({ tienda: f.nombre, total: f.total }));

  const cargando = consultaPedidos.isPending || consultaTiendas.isPending;
  const error = consultaPedidos.error ?? consultaTiendas.error;
  const sinTiendas = !cargando && !error && tiendas.length === 0;
  const sinPedidos = !cargando && !error && tiendas.length > 0 && pedidos.length === 0;

  function navegar(dir: -1 | 1) {
    setRef((r) => (periodo === "mes" ? addMonths(r, dir) : addWeeks(r, dir)));
  }

  function exportar() {
    const fil: (string | number)[][] = [
      ["Tienda", "Pedidos", "Metros", "Bruta", "IVA", "Envíos", "Total"],
      ...filas.map((f) => [f.nombre, f.pedidos, f.metros, f.bruta, f.iva, f.envios, f.total]),
      [
        "TOTAL",
        totales.pedidos,
        totales.metros,
        totales.bruta,
        totales.iva,
        totales.envios,
        totales.total,
      ],
    ];
    const nombre = `facturacion-consolidada_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`;
    descargarCSV(nombre, fil);
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturación Consolidada</h1>
          <p className="text-muted-foreground">Contabilidad conjunta de todas las webs</p>
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

          <Button onClick={exportar} size="sm" disabled={filas.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se ha podido cargar la facturación: {error.message}
          </CardContent>
        </Card>
      )}

      {cargando && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {sinTiendas && (
        <EstadoVacio
          icono={Store}
          titulo="Todavía no hay tiendas"
          descripcion="La facturación consolidada agrega las tiendas del grupo. Crea la primera en Tiendas para empezar a ver cifras aquí."
        />
      )}

      {sinPedidos && (
        <EstadoVacio
          icono={Receipt}
          titulo="Sin facturación en este periodo"
          descripcion={`Ninguna tienda registró pedidos entre el ${format(desde, "d 'de' MMMM", { locale: es })} y el ${format(hasta, "d 'de' MMMM 'de' yyyy", { locale: es })}.`}
        />
      )}

      {!cargando && !error && !sinTiendas && !sinPedidos && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaTotal
              titulo="Facturación bruta"
              subtitulo="Base imponible"
              valor={eur(totales.bruta)}
              icon={Receipt}
              tono="primary"
            />
            <TarjetaTotal
              titulo="IVA repercutido"
              subtitulo={`${numero(pctIva, 1)}% sobre bruta`}
              valor={eur(totales.iva)}
              icon={Percent}
              tono="info"
            />
            <TarjetaTotal
              titulo="Envíos"
              subtitulo="Total cobrado en envíos"
              valor={eur(totales.envios)}
              icon={Truck}
              tono="warn"
            />
            <TarjetaTotal
              titulo="Total facturado"
              subtitulo="Bruta + IVA + envíos"
              valor={eur(totales.total)}
              icon={Wallet}
              tono="success"
            />
          </div>

          {/* Desglose por tienda */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Desglose por tienda</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tienda</TableHead>
                      <TableHead className="text-right">Nº pedidos</TableHead>
                      <TableHead className="text-right">Metros</TableHead>
                      <TableHead className="text-right">Bruta</TableHead>
                      <TableHead className="text-right">IVA</TableHead>
                      <TableHead className="text-right">Envíos</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f) => (
                      <TableRow key={f.tienda_id}>
                        <TableCell className="font-medium">{f.nombre}</TableCell>
                        <TableCell className="text-right">{f.pedidos}</TableCell>
                        <TableCell className="text-right">{metros(f.metros)}</TableCell>
                        <TableCell className="text-right">{eur(f.bruta)}</TableCell>
                        <TableCell className="text-right">{eur(f.iva)}</TableCell>
                        <TableCell className="text-right">{eur(f.envios)}</TableCell>
                        <TableCell className="text-right font-semibold">{eur(f.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell>TOTAL grupo</TableCell>
                      <TableCell className="text-right">{totales.pedidos}</TableCell>
                      <TableCell className="text-right">{metros(totales.metros)}</TableCell>
                      <TableCell className="text-right">{eur(totales.bruta)}</TableCell>
                      <TableCell className="text-right">{eur(totales.iva)}</TableCell>
                      <TableCell className="text-right">{eur(totales.envios)}</TableCell>
                      <TableCell className="text-right text-primary">
                        {eur(totales.total)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Comparativa entre tiendas + histórico semanal */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparativa entre tiendas</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {comparativa.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Ninguna tienda facturó en este periodo.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparativa}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="tienda" tick={{ fontSize: 12 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        formatter={(v: number) => eur(v)}
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                        }}
                      />
                      <Bar dataKey="total" name="Total facturado" radius={[6, 6, 0, 0]}>
                        {comparativa.map((_, i) => (
                          <Cell key={i} fill={COLORES_BARRA[i % COLORES_BARRA.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  Ventas semanales — últimas {SEMANAS_HISTORICO} semanas
                </CardTitle>
                {deltaSemana === null ? (
                  <div className="text-xs text-muted-foreground">Sin semana anterior</div>
                ) : (
                  <div
                    className={`flex items-center gap-1 text-xs font-medium ${
                      deltaSemana >= 0 ? "text-status-completado" : "text-status-cancelado"
                    }`}
                  >
                    {deltaSemana >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {numero(Math.abs(deltaSemana), 1)}% vs anterior
                  </div>
                )}
              </CardHeader>
              <CardContent className="h-72">
                {consultaHistorico.isPending ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={historico}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="semana"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        formatter={(v: number) => eur(v)}
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                        }}
                      />
                      <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                        {historico.map((_, i) => (
                          <Cell
                            key={i}
                            fill="var(--color-primary)"
                            fillOpacity={i === historico.length - 1 ? 1 : 0.55}
                          />
                        ))}
                      </Bar>
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

function TarjetaTotal({
  titulo,
  subtitulo,
  valor,
  icon: Icon,
  tono,
}: {
  titulo: string;
  subtitulo: string;
  valor: string;
  icon: LucideIcon;
  tono: "primary" | "info" | "warn" | "success";
}) {
  const tonos: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    info: "bg-status-procesando/15 text-status-procesando",
    warn: "bg-status-pendiente/15 text-status-pendiente",
    success: "bg-status-completado/15 text-status-completado",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {titulo}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{subtitulo}</div>
          </div>
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tonos[tono]}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 text-2xl font-bold tracking-tight">{valor}</div>
      </CardContent>
    </Card>
  );
}
