import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { eur } from "@/lib/format";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/productos")({ component: Productos });
function Productos() {
  const { tiendaId } = Route.useParams();
  const { data = [] } = useQuery({
    queryKey: ["productos", tiendaId],
    queryFn: async () => (await supabase.from("productos").select("*").eq("tienda_id", tiendaId).order("nombre")).data ?? [],
  });
  return (
    <Card><CardContent className="p-0"><Table>
      <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Nombre</TableHead><TableHead className="text-right">€/m</TableHead><TableHead className="text-right">IVA</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.map((p: any) => <TableRow key={p.id}><TableCell className="font-mono text-xs">{p.sku ?? "—"}</TableCell><TableCell>{p.nombre}</TableCell><TableCell className="text-right">{eur(p.precio_unitario)}</TableCell><TableCell className="text-right">{p.iva_rate}%</TableCell></TableRow>)}
        {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sin productos</TableCell></TableRow>}
      </TableBody>
    </Table></CardContent></Card>
  );
}