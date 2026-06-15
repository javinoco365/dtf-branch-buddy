import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { eur, fechaCorta } from "@/lib/format";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/facturas")({ component: Facturas });
function Facturas() {
  const { tiendaId } = Route.useParams();
  const { data = [] } = useQuery({
    queryKey: ["facturas", tiendaId],
    queryFn: async () => (await supabase.from("facturas").select("*, clientes(nombre)").eq("tienda_id", tiendaId).order("fecha", { ascending: false })).data ?? [],
  });
  return (
    <Card><CardContent className="p-0"><Table>
      <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">IVA</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.map((f: any) => <TableRow key={f.id}><TableCell>{fechaCorta(f.fecha)}</TableCell><TableCell className="font-mono">{f.serie}-{f.numero}</TableCell><TableCell>{f.clientes?.nombre ?? f.cliente_nombre ?? "—"}</TableCell><TableCell><Badge variant="secondary">{f.estado}</Badge></TableCell><TableCell className="text-right">{eur(f.base_imponible)}</TableCell><TableCell className="text-right">{eur(f.iva_total)}</TableCell><TableCell className="text-right font-semibold">{eur(f.total)}</TableCell></TableRow>)}
        {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Sin facturas emitidas</TableCell></TableRow>}
      </TableBody>
    </Table></CardContent></Card>
  );
}