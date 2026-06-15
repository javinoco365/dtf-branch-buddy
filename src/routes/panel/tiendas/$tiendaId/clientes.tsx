import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/clientes")({ component: Clientes });
function Clientes() {
  const { tiendaId } = Route.useParams();
  const { data = [] } = useQuery({
    queryKey: ["clientes", tiendaId],
    queryFn: async () => (await supabase.from("clientes").select("*").eq("tienda_id", tiendaId).order("nombre")).data ?? [],
  });
  return (
    <Card><CardContent className="p-0"><Table>
      <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Email</TableHead><TableHead>NIF</TableHead><TableHead>Ciudad</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.map((c: any) => <TableRow key={c.id}><TableCell>{c.nombre}</TableCell><TableCell>{c.email}</TableCell><TableCell>{c.nif ?? "—"}</TableCell><TableCell>{c.ciudad ?? "—"}</TableCell></TableRow>)}
        {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sin clientes</TableCell></TableRow>}
      </TableBody>
    </Table></CardContent></Card>
  );
}