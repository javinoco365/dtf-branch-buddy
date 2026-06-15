import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { eur, metros } from "@/lib/format";
import { ShoppingCart, Euro, Ruler, FileText } from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/")({
  component: Dashboard,
});

function Dashboard() {
  const { tiendaId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["tienda-dashboard", tiendaId],
    queryFn: async () => {
      const [pedidos, facturas] = await Promise.all([
        supabase.from("pedidos").select("total, metros_total").eq("tienda_id", tiendaId),
        supabase.from("facturas").select("total, estado").eq("tienda_id", tiendaId),
      ]);
      return { pedidos: pedidos.data ?? [], facturas: facturas.data ?? [] };
    },
  });
  const fact = (data?.facturas ?? []).filter((f) => f.estado !== "anulada" && f.estado !== "borrador").reduce((s, f) => s + Number(f.total), 0);
  const mts = (data?.pedidos ?? []).reduce((s, p) => s + Number(p.metros_total), 0);
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <KPI t="Pedidos" v={String(data?.pedidos.length ?? 0)} Icon={ShoppingCart} />
      <KPI t="Metros" v={metros(mts)} Icon={Ruler} />
      <KPI t="Facturado" v={eur(fact)} Icon={Euro} />
      <KPI t="Facturas" v={String(data?.facturas.length ?? 0)} Icon={FileText} />
    </div>
  );
}
function KPI({ t, v, Icon }: { t: string; v: string; Icon: any }) {
  return <Card><CardContent className="p-6 flex items-center gap-4"><div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-6 w-6" /></div><div><div className="text-sm text-muted-foreground">{t}</div><div className="text-2xl font-bold">{v}</div></div></CardContent></Card>;
}