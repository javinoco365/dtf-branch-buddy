import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { eur } from "@/lib/format";
import { Euro, FileText, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/facturacion")({
  head: () => ({ meta: [{ title: "Facturación · CRM DTF" }] }),
  component: FacturacionTienda,
});

function FacturacionTienda() {
  const { tiendaId } = Route.useParams();

  const { data } = useQuery({
    queryKey: ["facturacion-tienda", tiendaId],
    queryFn: async () => {
      const { data: facturas } = await supabase
        .from("facturas")
        .select("id, total, base_imponible, iva_total, estado, fecha")
        .eq("tienda_id", tiendaId);
      return facturas ?? [];
    },
  });

  const facturas = data ?? [];
  const emitidas = facturas.filter((f) => f.estado !== "anulada" && f.estado !== "borrador");
  const totalBase = emitidas.reduce((s, f) => s + Number(f.base_imponible ?? 0), 0);
  const totalIva = emitidas.reduce((s, f) => s + Number(f.iva_total ?? 0), 0);
  const total = emitidas.reduce((s, f) => s + Number(f.total ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="text-muted-foreground">Resumen contable de esta tienda</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <KPI titulo="Base imponible" valor={eur(totalBase)} icon={TrendingUp} />
        <KPI titulo="IVA repercutido" valor={eur(totalIva)} icon={FileText} />
        <KPI titulo="Total facturado" valor={eur(total)} icon={Euro} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Facturas computadas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {emitidas.length} factura(s) (excluyendo borradores y anuladas).
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ titulo, valor, icon: Icon }: { titulo: string; valor: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {titulo}
          </div>
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 text-3xl font-bold tracking-tight text-primary">{valor}</div>
      </CardContent>
    </Card>
  );
}
