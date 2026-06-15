import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { eur, metros } from "@/lib/format";
import { Building2, ShoppingCart, Euro, Ruler } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export const Route = createFileRoute("/panel/")({
  head: () => ({ meta: [{ title: "Panel global · CRM DTF" }] }),
  component: PanelGlobal,
});

function PanelGlobal() {
  const { data: stats } = useQuery({
    queryKey: ["panel-global"],
    queryFn: async () => {
      const [tiendas, pedidos, facturas] = await Promise.all([
        supabase.from("tiendas").select("id, nombre, color"),
        supabase.from("pedidos").select("id, tienda_id, total, metros_total, fecha_pedido"),
        supabase.from("facturas").select("id, tienda_id, total, fecha, estado"),
      ]);
      return {
        tiendas: tiendas.data ?? [],
        pedidos: pedidos.data ?? [],
        facturas: facturas.data ?? [],
      };
    },
  });

  const totalFacturado = (stats?.facturas ?? [])
    .filter((f) => f.estado !== "anulada" && f.estado !== "borrador")
    .reduce((s, f) => s + Number(f.total), 0);
  const totalMetros = (stats?.pedidos ?? []).reduce((s, p) => s + Number(p.metros_total), 0);
  const numPedidos = stats?.pedidos.length ?? 0;
  const numTiendas = stats?.tiendas.length ?? 0;

  // Facturación por tienda
  const facturacionTienda = (stats?.tiendas ?? []).map((t) => {
    const total = (stats?.facturas ?? [])
      .filter((f) => f.tienda_id === t.id && f.estado !== "anulada" && f.estado !== "borrador")
      .reduce((s, f) => s + Number(f.total), 0);
    return { nombre: t.nombre, total };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Panel global</h1>
        <p className="text-muted-foreground">Vista consolidada de todas las tiendas</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KPI titulo="Tiendas activas" valor={String(numTiendas)} icon={Building2} />
        <KPI titulo="Pedidos totales" valor={String(numPedidos)} icon={ShoppingCart} />
        <KPI titulo="Facturado" valor={eur(totalFacturado)} icon={Euro} />
        <KPI titulo="Metros vendidos" valor={metros(totalMetros)} icon={Ruler} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Facturación por tienda</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={facturacionTienda}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="nombre" />
              <YAxis tickFormatter={(v) => eur(v).replace(",00", "")} />
              <Tooltip formatter={(v: number) => eur(v)} />
              <Legend />
              <Bar dataKey="total" name="Facturado" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
        <div className="mt-1 text-xs text-muted-foreground">Total acumulado</div>
      </CardContent>
    </Card>
  );
}