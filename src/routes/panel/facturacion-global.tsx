import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { addMonths, addWeeks, endOfWeek, format, startOfWeek } from "date-fns";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { eur, fechaCorta, metros, numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { useCobrosPeriodo, useTiendas } from "@/lib/periodo";
import { useFiltrosUrl } from "@/lib/filtros-url";
import { escribirFecha, esPeriodo, leerFecha, rangoPeriodo, type Periodo } from "@/dominio/filtros";
import { variacion } from "@/dominio/kpis";
import { TIENDA_TEXTIL, etiquetaMetodo, type MetodoCobro } from "@/dominio/cobros";
import {
  FILTRO_TODO,
  ORIGENES_COBRO,
  desglosePorMetodo,
  desglosePorTienda,
  etiquetaOrigenCobro,
  filtrarCobros,
  totalPorRangos,
  totalizar,
  type CriterioFecha,
  type FiltroConsolidada,
} from "@/dominio/facturacion";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  HandCoins,
  Receipt,
  Percent,
  Wallet,
  X,
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
  head: () => ({ meta: [{ title: "Facturación Consolidada · DTF Culture" }] }),
  component: FacturacionGlobal,
});

/** Los filtros de la pantalla, en la dirección; aquí sus valores por defecto. */
/** Cuántas semanas muestra la serie histórica. */
const SEMANAS_HISTORICO = 12;

const FILTROS_CONSOLIDADA = {
  periodo: "mes",
  fecha: "",
  criterio: "pedido",
  ...FILTRO_TODO,
};

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

const METODOS_FILTRO: readonly MetodoCobro[] = [
  "efectivo",
  "tarjeta",
  "transferencia",
  "web",
  "sin_especificar",
];

const COLORES_BARRA = [
  "var(--color-primary)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function FacturacionGlobal() {
  // Los filtros viven en la dirección. Por defecto, por la fecha del pedido:
  // lo vendido en el periodo, se cobrara cuando se cobrara.
  const { valores: f, cambiar, quitar } = useFiltrosUrl(FILTROS_CONSOLIDADA);
  const periodo: Periodo = esPeriodo(f.periodo) ? f.periodo : "mes";
  const ref = leerFecha(f.fecha);
  const setPeriodo = (p: Periodo) => cambiar({ periodo: p, fecha: escribirFecha(ref, p) });
  const setRef = (d: Date | ((r: Date) => Date)) =>
    cambiar({ fecha: escribirFecha(typeof d === "function" ? d(ref) : d, periodo) });
  const criterio: CriterioFecha = f.criterio === "cobro" ? "cobro" : "pedido";
  const setCriterio = (c: CriterioFecha) => cambiar({ criterio: c });
  const filtro: FiltroConsolidada = useMemo(
    () => ({
      metodo: f.metodo as FiltroConsolidada["metodo"],
      tienda: f.tienda,
      origen: f.origen as FiltroConsolidada["origen"],
    }),
    [f.metodo, f.tienda, f.origen],
  );
  const setFiltro = (siguiente: (actual: FiltroConsolidada) => FiltroConsolidada) =>
    cambiar(siguiente(filtro));

  const { desde, hasta } = rangoPeriodo(ref, periodo);

  const consultaTiendas = useTiendas();
  const consultaCobros = useCobrosPeriodo({ desde, hasta }, criterio);

  // Una sola consulta para las doce semanas, no una por barra.
  const semanas = useMemo(() => semanasRecientes(new Date(), SEMANAS_HISTORICO), []);
  const rangoHistorico = useMemo(
    () => ({ desde: semanas[0].desde, hasta: semanas[semanas.length - 1].hasta }),
    [semanas],
  );
  const consultaHistorico = useCobrosPeriodo(rangoHistorico, criterio);

  const tiendas = useMemo(() => consultaTiendas.data ?? [], [consultaTiendas.data]);
  const tiendasYTextil = useMemo(() => [...tiendas, TIENDA_TEXTIL], [tiendas]);
  const nombreTienda = useMemo(
    () => new Map(tiendasYTextil.map((t) => [t.id, t.nombre])),
    [tiendasYTextil],
  );

  const disponible = consultaCobros.data?.disponible ?? true;
  const cobros = useMemo(
    () => filtrarCobros(consultaCobros.data?.cobros ?? [], filtro),
    [consultaCobros.data, filtro],
  );

  const filas = useMemo(
    () =>
      desglosePorTienda(
        cobros,
        filtro.tienda === "todas"
          ? tiendasYTextil
          : tiendasYTextil.filter((t) => t.id === filtro.tienda),
      ),
    [cobros, tiendasYTextil, filtro.tienda],
  );
  const totales = useMemo(() => totalizar(cobros), [cobros]);
  const porMetodo = useMemo(() => desglosePorMetodo(cobros), [cobros]);
  const detalle = useMemo(
    () => [...cobros].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)),
    [cobros],
  );

  const historico = useMemo(
    () =>
      totalPorRangos(filtrarCobros(consultaHistorico.data?.cobros ?? [], filtro), semanas).map(
        (s) => ({
          semana: format(s.desde, "d MMM", { locale: es }),
          total: s.total,
        }),
      ),
    [consultaHistorico.data, filtro, semanas],
  );

  const deltaSemana = useMemo(() => {
    if (historico.length < 2) return null;
    return variacion(historico[historico.length - 1].total, historico[historico.length - 2].total);
  }, [historico]);

  const pctIva = totales.base === 0 ? 0 : (totales.iva / totales.base) * 100;

  const comparativa = filas
    .filter((f) => f.total > 0)
    .map((f) => ({ tienda: f.nombre, total: f.total }));

  const hayFiltro =
    filtro.metodo !== "todos" || filtro.tienda !== "todas" || filtro.origen !== "todos";

  const cargando = consultaCobros.isPending || consultaTiendas.isPending;
  const error = consultaCobros.error ?? consultaTiendas.error;
  const sinCobros = !cargando && !error && disponible && cobros.length === 0;

  function navegar(dir: -1 | 1) {
    setRef((r) => (periodo === "mes" ? addMonths(r, dir) : addWeeks(r, dir)));
  }

  function exportar() {
    const fil: (string | number)[][] = [
      [
        "Tienda",
        "Pedidos",
        "Cobros",
        "Metros",
        "Base",
        "IVA",
        "Envíos",
        "Cobrado",
        "Propina",
        "Total",
      ],
      ...filas.map((f) => [
        f.nombre,
        f.pedidos,
        f.cobros,
        f.metros,
        f.base,
        f.iva,
        f.envios,
        f.cobrado,
        f.propina,
        f.total,
      ]),
      [
        "TOTAL",
        totales.pedidos,
        totales.cobros,
        totales.metros,
        totales.base,
        totales.iva,
        totales.envios,
        totales.cobrado,
        totales.propina,
        totales.total,
      ],
      [],
      ["Fecha del cobro", "Pedido", "Cliente", "Tienda", "Método", "Origen", "Cobrado", "Propina"],
      ...detalle.map((c) => [
        c.fecha_cobro,
        c.pedido_numero,
        c.cliente ?? "",
        nombreTienda.get(c.tienda_id) ?? "",
        etiquetaMetodo(c.metodo),
        etiquetaOrigenCobro(c.origen),
        c.importe,
        c.propina,
      ]),
    ];
    const nombre = `facturacion-consolidada_${criterio === "pedido" ? "por-pedido" : "por-cobro"}_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`;
    descargarCSV(nombre, fil);
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturación Consolidada</h1>
          <p className="text-muted-foreground">
            Todo lo cobrado, de las tiendas y del textil, con su método de cobro
          </p>
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

          <Button onClick={exportar} size="sm" disabled={cobros.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5">
            {(
              [
                ["pedido", "Fecha del pedido"],
                ["cobro", "Fecha del cobro"],
              ] as [CriterioFecha, string][]
            ).map(([valor, etiqueta]) => (
              <button
                key={valor}
                onClick={() => setCriterio(valor)}
                title={
                  valor === "pedido"
                    ? "Lo vendido en el periodo, se cobrara cuando se cobrara"
                    : "El dinero que entró en el periodo"
                }
                className={`px-3 py-1.5 text-sm font-medium rounded ${
                  criterio === valor
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          <Select
            value={filtro.tienda}
            onValueChange={(v) => setFiltro((f) => ({ ...f, tienda: v }))}
          >
            <SelectTrigger className="w-[190px]" aria-label="Tienda">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las tiendas</SelectItem>
              {tiendasYTextil.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtro.metodo}
            onValueChange={(v) =>
              setFiltro((f) => ({ ...f, metodo: v as FiltroConsolidada["metodo"] }))
            }
          >
            <SelectTrigger className="w-[190px]" aria-label="Método de cobro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los métodos</SelectItem>
              {METODOS_FILTRO.map((m) => (
                <SelectItem key={m} value={m}>
                  {etiquetaMetodo(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtro.origen}
            onValueChange={(v) =>
              setFiltro((f) => ({ ...f, origen: v as FiltroConsolidada["origen"] }))
            }
          >
            <SelectTrigger className="w-[210px]" aria-label="Origen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los orígenes</SelectItem>
              {ORIGENES_COBRO.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hayFiltro && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => quitar(["periodo", "fecha", "criterio"])}
            >
              <X className="h-4 w-4 mr-1" /> Quitar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se ha podido cargar la facturación: {error.message}
          </CardContent>
        </Card>
      )}

      {!disponible && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            La Facturación Consolidada se calcula con los cobros, que necesitan la migración{" "}
            <code>20260929100000_cobros.sql</code>.
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

      {sinCobros && (
        <EstadoVacio
          icono={Receipt}
          titulo={hayFiltro ? "Nada con estos filtros" : "Sin cobros en este periodo"}
          descripcion={
            hayFiltro
              ? "Ningún cobro del periodo cumple los filtros elegidos. Quita alguno para ver más."
              : `${criterio === "pedido" ? "Ningún pedido hecho" : "No se cobró nada"} entre el ${format(desde, "d 'de' MMMM", { locale: es })} y el ${format(hasta, "d 'de' MMMM 'de' yyyy", { locale: es })}${criterio === "pedido" ? " tiene cobros" : ""}.`
          }
        />
      )}

      {!cargando && !error && disponible && !sinCobros && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaTotal
              titulo="Total cobrado"
              subtitulo="Con IVA, envíos y propinas"
              valor={eur(totales.total)}
              icon={Wallet}
              tono="success"
            />
            <TarjetaTotal
              titulo="Base imponible"
              subtitulo={`${totales.pedidos} ${totales.pedidos === 1 ? "pedido" : "pedidos"} · ${totales.cobros} ${totales.cobros === 1 ? "cobro" : "cobros"}`}
              valor={eur(totales.base)}
              icon={Receipt}
              tono="primary"
            />
            <TarjetaTotal
              titulo="IVA repercutido"
              subtitulo={`${numero(pctIva, 1)}% sobre la base`}
              valor={eur(totales.iva)}
              icon={Percent}
              tono="info"
            />
            <TarjetaTotal
              titulo="Propinas"
              subtitulo="Aparte de lo cobrado a los pedidos"
              valor={eur(totales.propina)}
              icon={HandCoins}
              tono="warn"
            />
          </div>

          {/* Desglose por tienda */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Desglose por tienda</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table movil="tarjetas">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tienda</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                      <TableHead className="text-right">Metros</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">IVA</TableHead>
                      <TableHead className="text-right">Envíos</TableHead>
                      <TableHead className="text-right">Cobrado</TableHead>
                      <TableHead className="text-right">Propina</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f) => (
                      <TableRow key={f.tienda_id}>
                        <TableCell className="font-medium">{f.nombre}</TableCell>
                        <TableCell className="text-right">{f.pedidos}</TableCell>
                        <TableCell className="text-right">{metros(f.metros)}</TableCell>
                        <TableCell className="text-right">{eur(f.base)}</TableCell>
                        <TableCell className="text-right">{eur(f.iva)}</TableCell>
                        <TableCell className="text-right">{eur(f.envios)}</TableCell>
                        <TableCell className="text-right">{eur(f.cobrado)}</TableCell>
                        <TableCell className="text-right">{eur(f.propina)}</TableCell>
                        <TableCell className="text-right font-semibold">{eur(f.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell>TOTAL</TableCell>
                      <TableCell className="text-right">{totales.pedidos}</TableCell>
                      <TableCell className="text-right">{metros(totales.metros)}</TableCell>
                      <TableCell className="text-right">{eur(totales.base)}</TableCell>
                      <TableCell className="text-right">{eur(totales.iva)}</TableCell>
                      <TableCell className="text-right">{eur(totales.envios)}</TableCell>
                      <TableCell className="text-right">{eur(totales.cobrado)}</TableCell>
                      <TableCell className="text-right">{eur(totales.propina)}</TableCell>
                      <TableCell className="text-right text-primary">
                        {eur(totales.total)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Por método + comparativa entre tiendas */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por método de cobro</CardTitle>
              </CardHeader>
              <CardContent>
                <Table movil="tarjetas">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Cobros</TableHead>
                      <TableHead className="text-right">Cobrado</TableHead>
                      <TableHead className="text-right">Propina</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {porMetodo.map((m) => (
                      <TableRow key={m.metodo}>
                        <TableCell className="font-medium">
                          {m.etiqueta}
                          {m.metodo === "efectivo" && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              también en Caja
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{m.cobros}</TableCell>
                        <TableCell className="text-right">{eur(m.cobrado)}</TableCell>
                        <TableCell className="text-right">{eur(m.propina)}</TableCell>
                        <TableCell className="text-right font-semibold">{eur(m.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparativa entre tiendas</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {comparativa.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Ninguna tienda cobró en este periodo.
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
                      <Bar dataKey="total" name="Total cobrado" radius={[6, 6, 0, 0]}>
                        {comparativa.map((_, i) => (
                          <Cell key={i} fill={COLORES_BARRA[i % COLORES_BARRA.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Histórico semanal */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Cobrado por semana — últimas {SEMANAS_HISTORICO} semanas
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

          {/* Detalle */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalle de cobros ({detalle.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[480px] overflow-auto">
                <Table movil="tarjetas">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cobro</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Tienda</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Origen</TableHead>
                      <TableHead className="text-right">Cobrado</TableHead>
                      <TableHead className="text-right">Propina</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalle.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="tabular-nums">{fechaCorta(c.fecha_cobro)}</TableCell>
                        <TableCell className="font-mono text-xs">{c.pedido_numero}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{c.cliente ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {nombreTienda.get(c.tienda_id) ?? "—"}
                        </TableCell>
                        <TableCell>{etiquetaMetodo(c.metodo)}</TableCell>
                        <TableCell>
                          <Badge variant={c.origen === "previo" ? "outline" : "secondary"}>
                            {etiquetaOrigenCobro(c.origen)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{eur(c.importe)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.propina > 0 ? eur(c.propina) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
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
