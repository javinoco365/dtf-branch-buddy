import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { eur, metros } from "@/lib/format";
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
        supabase
          .from("empresa_global")
          .select("coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro")
          .eq("id", true)
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

  // Mes actual vs mes anterior
  const now = new Date();
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
  const inicioMesAnt = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const finMesAnt = inicioMes;

  const pedidosValidos = pedidos.filter((p) => p.estado !== "cancelado" && p.fecha_pedido);
  const inRange = (f: string, ini: Date, fin: Date) => {
    const d = new Date(f);
    return d >= ini && d < fin;
  };
  const pedidosMes = pedidosValidos.filter((p) =>
    inRange(p.fecha_pedido!, inicioMes, new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  );
  const pedidosMesAnt = pedidosValidos.filter((p) =>
    inRange(p.fecha_pedido!, inicioMesAnt, finMesAnt),
  );

  const facturadoMes = pedidosMes.reduce((s, p) => s + Number(p.total ?? 0), 0);
  const facturadoMesAnt = pedidosMesAnt.reduce((s, p) => s + Number(p.total ?? 0), 0);
  const variacion =
    facturadoMesAnt > 0 ? ((facturadoMes - facturadoMesAnt) / facturadoMesAnt) * 100 : null;

  const numPedidosMes = pedidosMes.length;
  const ticketMedio = numPedidosMes > 0 ? facturadoMes / numPedidosMes : 0;
  const metrosMes = pedidosMes.reduce((s, p) => s + Number(p.metros_total ?? 0), 0);
  const costeMes = costeMetro * metrosMes;
  const margenMes = facturadoMes - costeMes;
  const margenPct = facturadoMes > 0 ? (margenMes / facturadoMes) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <KPI
          t="Facturación del mes"
          v={eur(facturadoMes)}
          sub={
            variacion === null
              ? "Sin datos mes anterior"
              : `${variacion >= 0 ? "+" : ""}${variacion.toFixed(1)}% vs mes anterior`
          }
          tone={variacion === null ? "neutral" : variacion >= 0 ? "up" : "down"}
          Icon={variacion !== null && variacion < 0 ? TrendingDown : TrendingUp}
        />
        <KPI
          t="Pedidos del mes"
          v={String(numPedidosMes)}
          sub={`Ticket medio ${eur(ticketMedio)}`}
          Icon={Receipt}
        />
        <KPI
          t="Metros del mes"
          v={metros(metrosMes)}
          sub="Producción mes en curso"
          Icon={Package}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-1">
        <KPI
          t="Margen estimado del mes"
          v={eur(margenMes)}
          sub={
            costeMetro === 0
              ? "Configura los costes en Ajustes › Datos de la empresa"
              : `Coste ${eur(costeMes)} (${costeMetro.toFixed(3)} €/m × ${metros(metrosMes)})${
                  margenPct !== null ? ` · ${margenPct.toFixed(1)}% margen` : ""
                }`
          }
          tone={costeMetro === 0 ? "neutral" : margenMes >= 0 ? "up" : "down"}
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
}: {
  t: string;
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
          <div className="text-sm text-muted-foreground">{t}</div>
          <div className="text-2xl font-bold">{v}</div>
          {sub && <div className={`text-xs mt-0.5 ${toneClass}`}>{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
