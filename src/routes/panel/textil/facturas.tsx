import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Download, FileText, Loader2, Trash2 } from "lucide-react";
import {
  listTextilFacturas,
  deleteTextilFactura,
  generarPdfFacturaTextil,
  urlFacturaTextil,
} from "@/lib/textil.functions";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";

export const Route = createFileRoute("/panel/textil/facturas")({
  head: () => ({ meta: [{ title: "Facturas textil · DTF Culture" }] }),
  component: FacturasPage,
});

function FacturasPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTextilFacturas);
  const [borrando, setBorrando] = useState<any>(null);
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

  const [generando, setGenerando] = useState<string | null>(null);
  const generarFn = useServerFn(generarPdfFacturaTextil);
  const urlFn = useServerFn(urlFacturaTextil);

  /**
   * Genera el PDF si hace falta y lo abre.
   *
   * La ventana se abre ANTES de la llamada, no después: un navegador solo
   * permite abrir pestañas mientras dura el gesto del usuario, y al volver de
   * una espera de red ya la ha bloqueado. Se abre vacía y se le pone la
   * dirección cuando llega.
   */
  async function abrirPdf(factura: any) {
    const ventana = window.open("", "_blank");
    setGenerando(factura.id);
    try {
      if (!factura.pdf_path) {
        await generarFn({ data: { factura_id: factura.id } });
        qc.invalidateQueries({ queryKey: ["textil-facturas"] });
      }
      const { url } = (await urlFn({ data: { factura_id: factura.id } })) as {
        url: string | null;
      };
      if (!url) throw new Error("No se pudo obtener el PDF");
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    } catch (e: any) {
      ventana?.close();
      toast.error(e?.message ?? "No se pudo generar el PDF");
    } finally {
      setGenerando(null);
    }
  }

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
                      title={f.pdf_path ? "Abrir el PDF" : "Generar el PDF"}
                      disabled={generando === f.id || f.estado === "borrador"}
                      onClick={() => abrirPdf(f)}
                    >
                      {generando === f.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : f.pdf_path ? (
                        <Download className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setBorrando(f)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`la factura ${borrando?.numero ?? ""}`}
        cargando={del.isPending}
        impedimento={
          borrando && borrando.estado !== "borrador"
            ? "Está emitida. Una factura emitida no se borra ni se edita: para " +
              "corregirla hay que emitir una rectificativa."
            : null
        }
        onConfirmar={() => {
          del.mutate(borrando.id);
          setBorrando(null);
        }}
      />
    </div>
  );
}
