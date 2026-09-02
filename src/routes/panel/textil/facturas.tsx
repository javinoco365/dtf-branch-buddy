import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2 } from "lucide-react";
import { listTextilFacturas, deleteTextilFactura } from "@/lib/textil.functions";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";

export const Route = createFileRoute("/panel/textil/facturas")({
  head: () => ({ meta: [{ title: "Facturas textil · CRM DTF" }] }),
  component: FacturasPage,
});

function FacturasPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTextilFacturas);
  const delFn = useServerFn(deleteTextilFactura);
  const { data = [] } = useQuery({ queryKey: ["textil-facturas"], queryFn: () => listFn() });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-facturas"] });
      toast.success("Eliminada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Facturas textil</h1>
        <p className="text-sm text-muted-foreground">
          Las facturas se generan al convertir un presupuesto aceptado.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Sin facturas.
                  </TableCell>
                </TableRow>
              )}
              {data.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.numero}</TableCell>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell>{f.cliente_nombre ?? "—"}</TableCell>
                  <TableCell>
                    {f.marca ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: f.marca.color ?? "#3b82f6" }}
                        />
                        {f.marca.nombre}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{f.estado}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{eur(Number(f.total))}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("¿Eliminar?")) del.mutate(f.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
