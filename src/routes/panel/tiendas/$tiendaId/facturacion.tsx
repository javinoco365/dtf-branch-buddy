import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  eachDayOfInterval,
} from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { eur, metros, numero } from "@/lib/format";
import {
  generarPedidosRango,
  descargarCSV,
  TIENDAS_DEMO,
  type PedidoDemo,
} from "@/lib/demo-data";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Euro,
  Receipt,
  Percent,
  Truck,
  Wallet,
  Ruler,
  ShoppingCart,
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

export const Route = createFileRoute("/panel/tiendas/$tiendaId/facturacion")({
  head: () => ({ meta: [{ title: "Facturación · CRM DTF" }] }),
  component: FacturacionTienda,
});

type Periodo = "mes" | "semana";

function rangoPeriodo(ref: Date, periodo: Periodo) {
  if (periodo === "mes") return { desde: startOfMonth(ref), hasta: endOfMonth(ref) };
  return {
    desde: startOfWeek(ref, { weekStartsOn: 1 }),
    hasta: endOfWeek(ref, { weekStartsOn: 1 }),
  };
}
function rangoAnterior(ref: Date, periodo: Periodo) {
  return rangoPeriodo(periodo === "mes" ? addMonths(ref, -1) : addWeeks(ref, -1), periodo);
}
function etiquetaPeriodo(ref: Date, periodo: Periodo) {
  if (periodo === "mes") {
    return format(ref, "LLLL yyyy", { locale: es }).replace(/^./, (c) => c.toUpperCase());
  }
  const { desde, hasta } = rangoPeriodo(ref, periodo);
  return `${format(desde, "d MMM", { locale: es })} – ${format(hasta, "d MMM yyyy", { locale: es })}`;
}
function pct(a: number, b: number) {
  if (b === 0) return a === 0 ? 0 : 100;
  return ((a - b) / b) * 100;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function calcKPIs(pedidos: PedidoDemo[]) {
  const validos = pedidos.filter((p) => p.estado !== "cancelado");
  const total = validos.reduce((s, p) => s + p.total, 0);
  const bruta = validos.reduce((s, p) => s + p.bruto, 0);
  const iva = validos.reduce((s, p) => s + p.iva, 0);
  const envios = validos.reduce((s, p) => s + p.envio, 0);
  const mts = validos.reduce((s, p) => s + p.metros, 0);
  const cancelados = pedidos.filter((p) => p.estado === "cancelado").length;
  const ticket = validos.length ? total / validos.length : 0;
  return { total, bruta, iva, envios, metros: mts, cancelados, ticket, numPedidos: validos.length };
}

function FacturacionTienda() {
  const { tiendaId } = Route.useParams();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [ref, setRef] = useState(new Date());

  const { data: tienda } = useQuery({
    queryKey: ["tienda", tiendaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tiendas")
        .select("id, nombre")
        .eq("id", tiendaId)
        .maybeSingle();
      return data;
    },
  });

  // Mapear tienda real → tienda demo (por nombre exacto; si no, por índice estable del id)
  const tiendaDemo = useMemo(() => {
    if (tienda?.nombre && (TIENDAS_DEMO as readonly string[]).includes(tienda.nombre)) {
      return tienda.nombre;
    }
    // hash del id → posición estable
    let h = 0;
    for (const c of tiendaId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return TIENDAS_DEMO[h % TIENDAS_DEMO.length];
  }, [tienda, tiendaId]);

  const { desde, hasta } = useMemo(() => rangoPeriodo(ref, periodo), [ref, periodo]);
  const ant = useMemo(() => rangoAnterior(ref, periodo), [ref, periodo]);

  const pedidos = useMemo(
    () => generarPedidosRango(desde, hasta).filter((p) => p.tienda === tiendaDemo),
    [desde, hasta, tiendaDemo],
  );
  const pedidosAnt = useMemo(
    () => generarPedidosRango(ant.desde, ant.hasta).filter((p) => p.tienda === tiendaDemo),
    [ant, tiendaDemo],
  );

  const k = useMemo(() => calcKPIs(pedidos), [pedidos]);
  const kPrev = useMemo(() => calcKPIs(pedidosAnt), [pedidosAnt]);

  const ingresosDiarios = useMemo(() => {
    const dias = eachDayOfInterval({ start: desde, end: hasta });
    return dias.map((d) => ({
      dia: format(d, "d MMM", { locale: es }),
      total: Number(
        pedidos
          .filter((p) => p.estado !== "cancelado" && isSameDay(p.fecha, d))
          .reduce((s, p) => s + p.total, 0)
          .toFixed(2),
      ),
    }));
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

  const pctIva = k.bruta === 0 ? 0 : (k.iva / k.bruta) * 100;

  function navegar(dir: -1 | 1) {
    setRef((r) => (periodo === "mes" ? addMonths(r, dir) : addWeeks(r, dir)));
  }

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Producto", "Metros", "Bruta", "IVA", "Envío", "Total", "Estado"],
      ...pedidos.map((p) => [
        format(p.fecha, "yyyy-MM-dd"),
        p.producto,
        p.metros,
        p.bruto,
        p.iva,
        p.envio,
        p.total,
        p.estado,
      ]),
    ];
    const slug = (tienda?.nombre ?? tiendaDemo).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    descargarCSV(`facturacion-${slug}_${format(desde, "yyyyMMdd")}_${format(hasta, "yyyyMMdd")}.csv`, filas);
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Facturación</h2>
          <p className="text-sm text-muted-foreground">
            Vista contable filtrada a esta tienda
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

          <Button onClick={exportar} size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KPI titulo="Total periodo" valor={eur(k.total)} delta={pct(k.total, kPrev.total)} icon={Euro} />
        <KPI titulo="Facturación bruta" valor={eur(k.bruta)} delta={pct(k.bruta, kPrev.bruta)} icon={Receipt} />
        <KPI titulo="Ticket medio" valor={eur(k.ticket)} delta={pct(k.ticket, kPrev.ticket)} icon={ShoppingCart} />
        <KPI titulo="Metros vendidos" valor={metros(k.metros)} delta={pct(k.metros, kPrev.metros)} icon={Ruler} />
        <KPI
          titulo="Cancelados"
          valor={String(k.cancelados)}
          delta={pct(k.cancelados, kPrev.cancelados)}
          icon={XCircle}
          color="destructive"
          deltaInverso
        />
      </div>

      {/* Desglose de facturación */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Bloque titulo="Bruta" subtitulo="Solo metros vendidos" valor={eur(k.bruta)} icon={Receipt} tono="primary" />
        <Bloque titulo="IVA" subtitulo={`${numero(pctIva, 1)}% sobre bruta`} valor={eur(k.iva)} icon={Percent} tono="info" />
        <Bloque titulo="Envíos" subtitulo="Total cobrado en envíos" valor={eur(k.envios)} icon={Truck} tono="warn" />
        <Bloque titulo="Total" subtitulo="Bruta + IVA + envíos" valor={eur(k.total)} icon={Wallet} tono="success" />
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
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={(v: number) => eur(v)}
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
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProductos} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v} m`} />
                <YAxis type="category" dataKey="producto" width={140} tick={{ fontSize: 11 }} />
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
          </CardContent>
        </Card>
      </div>
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
  delta: number;
  icon: any;
  color?: "primary" | "destructive";
  deltaInverso?: boolean;
}) {
  const subiendo = delta >= 0;
  const positivo = deltaInverso ? !subiendo : subiendo;
  const iconBg = color === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";
  const valorColor = color === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{titulo}</div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className={`mt-3 text-3xl font-bold tracking-tight ${valorColor}`}>{valor}</div>
        <div
          className={`mt-1 flex items-center gap-1 text-xs font-medium ${
            positivo ? "text-status-completado" : "text-status-cancelado"
          }`}
        >
          {subiendo ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {numero(Math.abs(delta), 1)}% vs periodo anterior
        </div>
      </CardContent>
    </Card>
  );
}

function Bloque({
  titulo,
  subtitulo,
  valor,
  icon: Icon,
  tono,
}: {
  titulo: string;
  subtitulo: string;
  valor: string;
  icon: any;
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
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{titulo}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{subtitulo}</div>
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tonos[tono]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 text-2xl font-bold tracking-tight">{valor}</div>
      </CardContent>
    </Card>
  );
}
