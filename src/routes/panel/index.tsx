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
  eachDayOfInterval,
  differenceInCalendarDays,
  isWithinInterval,
} from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { eur, metros, numero } from "@/lib/format";
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
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/panel/")({
  head: () => ({ meta: [{ title: "Dashboard Global · CRM DTF" }] }),
  component: DashboardGlobal,
});

type Periodo = "mes" | "semana";

// ---------- Demo data ----------
const TIENDAS = ["DTF Pro", "Print&Go", "TextilDTF"] as const;
const PRODUCTOS = [
  "DTF Premium 60cm",
  "DTF Económico 60cm",
  "DTF Glitter 30cm",
  "DTF Reflectante",
  "DTF Glow 60cm",
  "DTF UV",
];

// Deterministic pseudo-random based on a seed (date string)
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

type Pedido = {
  fecha: Date;
  tienda: string;
  bruto: number; // base imponible (sin IVA, sin envío)
  iva: number;
  envio: number;
  total: number;
  metros: number;
  estado: "completado" | "procesando" | "cancelado";
  producto: string;
};

function generarPedidosRango(desde: Date, hasta: Date): Pedido[] {
  const out: Pedido[] = [];
  const dias = eachDayOfInterval({ start: desde, end: hasta });
  for (const dia of dias) {
    const key = format(dia, "yyyy-MM-dd");
    // 3-12 pedidos/día (variación por DoW)
    const dow = dia.getDay();
    const factor = dow === 0 || dow === 6 ? 0.5 : 1;
    const n = Math.floor(3 + hash(key) * 9 * factor);
    for (let i = 0; i < n; i++) {
      const seed = `${key}-${i}`;
      const r = hash(seed);
      const r2 = hash(seed + "x");
      const tienda = TIENDAS[Math.floor(r * TIENDAS.length)];
      const producto = PRODUCTOS[Math.floor(r2 * PRODUCTOS.length)];
      const mts = Number((2 + r * 18).toFixed(2));
      const precioM = 8 + r2 * 6;
      const bruto = Number((mts * precioM).toFixed(2));
      const envio = r2 < 0.3 ? 0 : Number((3 + r2 * 4).toFixed(2));
      const iva = Number((bruto * 0.21).toFixed(2));
      const total = Number((bruto + iva + envio).toFixed(2));
      const estado: Pedido["estado"] =
        r2 < 0.06 ? "cancelado" : r < 0.15 ? "procesando" : "completado";
      out.push({
        fecha: dia,
        tienda,
        bruto,
        iva,
        envio,
        total,
        metros: mts,
        estado,
        producto,
      });
    }
  }
  return out;
}

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

function pct(actual: number, anterior: number) {
  if (anterior === 0) return actual === 0 ? 0 : 100;
  return ((actual - anterior) / anterior) * 100;
}

function descargarCSV(nombre: string, filas: (string | number)[][]) {
  const csv = filas
    .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function DashboardGlobal() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [ref, setRef] = useState(new Date());

  const { desde, hasta } = useMemo(() => rangoPeriodo(ref, periodo), [ref, periodo]);
  const ant = useMemo(() => rangoAnterior(ref, periodo), [ref, periodo]);

  const pedidos = useMemo(() => generarPedidosRango(desde, hasta), [desde, hasta]);
  const pedidosAnt = useMemo(
    () => generarPedidosRango(ant.desde, ant.hasta),
    [ant.desde, ant.hasta],
  );

  const k = useMemo(() => calcularKPIs(pedidos), [pedidos]);
  const kPrev = useMemo(() => calcularKPIs(pedidosAnt), [pedidosAnt]);

  const ingresosDiarios = useMemo(() => {
    const dias = eachDayOfInterval({ start: desde, end: hasta });
    return dias.map((d) => {
      const total = pedidos
        .filter((p) => p.estado !== "cancelado" && isSameDay(p.fecha, d))
        .reduce((s, p) => s + p.total, 0);
      return { dia: format(d, "d MMM", { locale: es }), total: Number(total.toFixed(2)) };
    });
  }, [pedidos, desde, hasta]);

  const topProductos = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pedidos) {
      if (p.estado === "cancelado") continue;
      map.set(p.producto, (map.get(p.producto) ?? 0) + p.metros);
    }
    return Array.from(map.entries())
      .map(([producto, mts]) => ({ producto, metros: Number(mts.toFixed(2)) }))
      .sort((a, b) => b.metros - a.metros)
      .slice(0, 6);
  }, [pedidos]);

  function navegar(dir: -1 | 1) {
    setRef((r) => (periodo === "mes" ? addMonths(r, dir) : addWeeks(r, dir)));
  }

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Tienda", "Producto", "Metros", "Bruto", "IVA", "Envío", "Total", "Estado"],
      ...pedidos.map((p) => [
        format(p.fecha, "yyyy-MM-dd"),
        p.tienda,
        p.producto,
        p.metros,
        p.bruto,
        p.iva,
        p.envio,
        p.total,
        p.estado,
      ]),
    ];
    const nombre = `dashboard-global_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`;
    descargarCSV(nombre, filas);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard Global</h1>
          <p className="text-muted-foreground">
            Vista consolidada agregando todas las tiendas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mes / Semana */}
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

          {/* Navegación */}
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

          <Button onClick={exportar} size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KPI
          titulo="Total periodo"
          valor={eur(k.total)}
          delta={pct(k.total, kPrev.total)}
          icon={Euro}
          color="primary"
        />
        <KPI
          titulo="Facturación bruta"
          valor={eur(k.bruto)}
          delta={pct(k.bruto, kPrev.bruto)}
          icon={Receipt}
          color="primary"
        />
        <KPI
          titulo="Ticket medio"
          valor={eur(k.ticket)}
          delta={pct(k.ticket, kPrev.ticket)}
          icon={ShoppingCart}
          color="primary"
        />
        <KPI
          titulo="Metros vendidos"
          valor={metros(k.metros)}
          delta={pct(k.metros, kPrev.metros)}
          icon={Ruler}
          color="primary"
        />
        <KPI
          titulo="Cancelados"
          valor={String(k.cancelados)}
          delta={pct(k.cancelados, kPrev.cancelados)}
          icon={XCircle}
          color="destructive"
          deltaInverso
        />
      </div>

      {/* Charts */}
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
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
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
                <Bar
                  dataKey="total"
                  fill="var(--color-primary)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top productos por metros</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
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
                <Bar
                  dataKey="metros"
                  fill="var(--color-primary)"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function calcularKPIs(pedidos: Pedido[]) {
  const validos = pedidos.filter((p) => p.estado !== "cancelado");
  const total = validos.reduce((s, p) => s + p.total, 0);
  const bruto = validos.reduce((s, p) => s + p.bruto, 0);
  const metros = validos.reduce((s, p) => s + p.metros, 0);
  const cancelados = pedidos.filter((p) => p.estado === "cancelado").length;
  const ticket = validos.length ? total / validos.length : 0;
  return { total, bruto, metros, cancelados, ticket };
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
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
  delta: number;
  icon: any;
  color?: "primary" | "destructive";
  deltaInverso?: boolean;
}) {
  const subiendo = delta >= 0;
  // En "inverso" (p. ej. cancelados), subir es malo
  const positivo = deltaInverso ? !subiendo : subiendo;
  const iconBg =
    color === "destructive"
      ? "bg-destructive/10 text-destructive"
      : "bg-primary/10 text-primary";
  const valorColor = color === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {titulo}
          </div>
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className={`mt-3 text-3xl font-bold tracking-tight ${valorColor}`}>
          {valor}
        </div>
        <div
          className={`mt-1 flex items-center gap-1 text-xs font-medium ${
            positivo ? "text-status-completado" : "text-status-cancelado"
          }`}
        >
          {subiendo ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {numero(Math.abs(delta), 1)}% vs periodo anterior
        </div>
      </CardContent>
    </Card>
  );
}