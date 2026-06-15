import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { eur, fechaCorta } from "@/lib/format";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export const Route = createFileRoute("/panel/facturacion-global")({
  head: () => ({ meta: [{ title: "Facturación consolidada · CRM DTF" }] }),
  component: FacturacionGlobal,
});

function FacturacionGlobal() {
  const { data } = useQuery({
    queryKey: ["facturacion-global"],
    queryFn: async () => {
      const [tiendas, facturas] = await Promise.all([
        supabase.from("tiendas").select("id, nombre, color"),
        supabase.from("facturas").select("id, tienda_id, fecha, total, base_imponible, iva_total, estado, numero, serie"),
      ]);
      return { tiendas: tiendas.data ?? [], facturas: facturas.data ?? [] };
    },
  });

  const facturas = (data?.facturas ?? []).filter((f) => f.estado !== "anulada" && f.estado !== "borrador");

  // Agregado por mes
  const porMes: Record<string, Record<string, number> & { mes: string }> = {};
  for (const f of facturas) {
    const d = new Date(f.fecha);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    porMes[k] = porMes[k] || ({ mes: k } as any);
    const tienda = data?.tiendas.find((t) => t.id === f.tienda_id)?.nombre ?? "—";
    porMes[k][tienda] = (porMes[k][tienda] ?? 0) + Number(f.total);
  }
  const series = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes));

  const totalBase = facturas.reduce((s, f) => s + Number(f.base_imponible), 0);
  const totalIva = facturas.reduce((s, f) => s + Number(f.iva_total), 0);
  const totalGeneral = facturas.reduce((s, f) => s + Number(f.total), 0);

  const colores = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Facturación consolidada</h1>
        <p className="text-muted-foreground">Suma de la facturación de todas tus tiendas</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-6"><div className="text-sm text-muted-foreground">Base imponible</div><div className="text-2xl font-bold">{eur(totalBase)}</div></CardContent></Card>
        <Card><CardContent className="p-6"><div className="text-sm text-muted-foreground">IVA repercutido</div><div className="text-2xl font-bold">{eur(totalIva)}</div></CardContent></Card>
        <Card><CardContent className="p-6"><div className="text-sm text-muted-foreground">Total facturado</div><div className="text-2xl font-bold">{eur(totalGeneral)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Evolución mensual por tienda</CardTitle></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => eur(v).replace(",00", "")} />
              <Tooltip formatter={(v: number) => eur(v)} />
              <Legend />
              {(data?.tiendas ?? []).map((t, i) => (
                <Line key={t.id} type="monotone" dataKey={t.nombre} stroke={colores[i % colores.length]} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Últimas facturas (todas las tiendas)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tienda</TableHead>
                <TableHead>Nº</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facturas.slice(0, 30).map((f) => (
                <TableRow key={f.id}>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell>{data?.tiendas.find((t) => t.id === f.tienda_id)?.nombre ?? "—"}</TableCell>
                  <TableCell>{f.serie}-{f.numero}</TableCell>
                  <TableCell className="text-right">{eur(f.base_imponible)}</TableCell>
                  <TableCell className="text-right">{eur(f.iva_total)}</TableCell>
                  <TableCell className="text-right font-semibold">{eur(f.total)}</TableCell>
                </TableRow>
              ))}
              {facturas.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Aún no hay facturas emitidas</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}