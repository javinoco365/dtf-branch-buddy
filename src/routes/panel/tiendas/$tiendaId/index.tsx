import { createFileRoute } from "@tanstack/react-router";
import { tabla } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { useMemo } from "react";
import { eur, metros, numero } from "@/lib/format";
import { usePedidosPeriodo } from "@/lib/periodo";
import { calcularKpis, costeVariable, variacion } from "@/dominio/kpis";
import { compararCon, rangoDe } from "@/dominio/periodos";
import { DEFINICIONES, type ClaveDefinicion } from "@/dominio/definiciones";
import { Explicacion } from "@/components/Explicacion";
import {
  ShoppingCart,
  Euro,
  Ruler,
  FileText,
  TrendingUp,
  TrendingDown,
  Receipt,
  Package,
  Percent,
} from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/")({
  component: Dashboard,
});

function Dashboard() {
  const { tiendaId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["tienda-dashboard", tiendaId],
    queryFn: async () => {
      const [pedidos, facturas, empresa] = await Promise.all([
        supabase
          .from("pedidos")
          .select("total, metros_total, fecha_pedido, estado")
          .eq("tienda_id", tiendaId),
        supabase.from("facturas").select("total, estado").eq("tienda_id", tiendaId),
        tabla(supabase, "empresas")
          .select("coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro")
          .eq("activa", true)
          .order("created_at")
          .limit(1)
          .maybeSingle(),
      ]);
      return { pedidos: pedidos.data ?? [], facturas: facturas.data ?? [], empresa: empresa.data };
    },
  });
  const pedidos = data?.pedidos ?? [];
  const facturas = data?.facturas ?? [];
  const eg = data?.empresa;
  const costeMetro =
    Number(eg?.coste_consumibles_metro ?? 0) +
    Number(eg?.coste_packaging_metro ?? 0) +
    Number(eg?.coste_electricidad_metro ?? 0);
  const fact = facturas
    .filter((f) => f.estado !== "anulada" && f.estado !== "borrador")
    .reduce((s, f) => s + Number(f.total), 0);
  const mts = pedidos.reduce((s, p) => s + Number(p.metros_total ?? 0), 0);

  // El mes en curso con las mismas cuentas que el dashboard (devoluciones
  // restadas, coste congelado por pedido) y comparado con el mismo trozo del
  // mes anterior: el día 5, contra del 1 al 5 del mes pasado.
  const hoy = useMemo(() => new Date(), []);
  const mes = useMemo(() => rangoDe({ tipo: "mes", ref: hoy })!, [hoy]);
  const comparacion = useMemo(
    () => compararCon({ tipo: "mes", ref: hoy }, "anterior", hoy)!,
    [hoy],
  );
  const consultaMes = usePedidosPeriodo({ ...mes, tiendaId });
  const consultaAnt = usePedidosPeriodo({ ...comparacion.previo, tiendaId });
  const pedidosMes = useMemo(() => consultaMes.data ?? [], [consultaMes.data]);
  const k = useMemo(() => calcularKpis(pedidosMes), [pedidosMes]);
  const kAnt = useMemo(() => calcularKpis(consultaAnt.data ?? []), [consultaAnt.data]);

  const delta = variacion(k.total, kAnt.total);
  // El envío no entra: la bruta ya va sin él, y lo que se cobra al cliente es
  // lo que se paga a la agencia.
  const costeMes = costeVariable(pedidosMes, costeMetro);
  const margenMes = k.bruta - costeMes.produccion;
  const margenPct = k.bruta > 0 ? (margenMes / k.bruta) * 100 : null;
  const sinCostes = costeMetro === 0 && costeMes.produccion === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <KPI
          t="Vendido este mes"
          explicacion="vendido"
          v={eur(k.total)}
          sub={
            delta === null
              ? `Sin datos en ${comparacion.etiqueta}`
              : `${delta >= 0 ? "+" : "−"}${numero(Math.abs(delta), 1)} % frente a ${comparacion.etiqueta}`
          }
          tone={delta === null ? "neutral" : delta >= 0 ? "up" : "down"}
          Icon={delta !== null && delta < 0 ? TrendingDown : TrendingUp}
        />
        <KPI
          t="Pedidos del mes"
          explicacion="pedidos"
          v={String(k.pedidos)}
          sub={`Ticket medio ${eur(k.ticket)}`}
          Icon={Receipt}
        />
        <KPI
          t="Metros del mes"
          explicacion="metros"
          v={metros(k.metros)}
          sub="Producción mes en curso"
          Icon={Package}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-1">
        <KPI
          t="Margen estimado del mes"
          explicacion="margen"
          v={sinCostes ? "—" : eur(margenMes)}
          sub={
            sinCostes
              ? "Configura los costes en Ajustes › Datos de la empresa"
              : `Bruta ${eur(k.bruta)} − producción ${eur(costeMes.produccion)} (${metros(k.metros)})${
                  margenPct !== null ? ` · ${numero(margenPct, 1)} % de la bruta` : ""
                }`
          }
          tone={sinCostes ? "neutral" : margenMes >= 0 ? "up" : "down"}
          Icon={Percent}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <KPI t="Pedidos totales" v={String(pedidos.length)} Icon={ShoppingCart} />
        <KPI t="Metros totales" v={metros(mts)} Icon={Ruler} />
        <KPI t="Facturado total" v={eur(fact)} Icon={Euro} />
        <KPI t="Facturas" v={String(facturas.length)} Icon={FileText} />
      </div>
    </div>
  );
}
function KPI({
  t,
  v,
  sub,
  Icon,
  tone = "neutral",
  explicacion,
}: {
  t: string;
  explicacion?: ClaveDefinicion;
  v: string;
  sub?: string;
  Icon: any;
  tone?: "up" | "down" | "neutral";
}) {
  const toneClass =
    tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="p-6 flex items-center gap-4">
        <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{t}</span>
            {explicacion && <Explicacion titulo={t} definicion={DEFINICIONES[explicacion]} />}
          </div>
          <div className="text-2xl font-bold">{v}</div>
          {sub && <div className={`text-xs mt-0.5 ${toneClass}`}>{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
