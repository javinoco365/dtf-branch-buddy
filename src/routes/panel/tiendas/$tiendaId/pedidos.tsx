import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { eur, fechaCorta, metros } from "@/lib/format";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/pedidos")({ component: Pedidos });

function Pedidos() {
  const { tiendaId } = Route.useParams();
  const { data: pedidos = [] } = useQuery({
    queryKey: ["pedidos", tiendaId],
    queryFn: async () => {
      const { data } = await supabase.from("pedidos").select("*, clientes(nombre)").eq("tienda_id", tiendaId).order("fecha_pedido", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Metros</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
        <TableBody>
          {pedidos.map((p: any) => (
            <TableRow key={p.id}>
              <TableCell>{fechaCorta(p.fecha_pedido)}</TableCell>
              <TableCell className="font-mono">{p.numero}</TableCell>
              <TableCell>{p.clientes?.nombre ?? "—"}</TableCell>
              <TableCell><Badge variant="secondary">{p.estado}</Badge></TableCell>
              <TableCell className="text-right">{metros(p.metros_total)}</TableCell>
              <TableCell className="text-right font-semibold">{eur(p.total)}</TableCell>
            </TableRow>
          ))}
          {pedidos.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin pedidos. Sincroniza desde WooCommerce en Ajustes.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}