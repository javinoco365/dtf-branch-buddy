import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, FileText } from "lucide-react";
import { eur } from "@/lib/format";
import { calcularTotales } from "@/dominio/importes";
import {
  emitirFactura,
  generarYSubirFacturaPDF,
  prepararFacturaPedido,
} from "@/lib/facturas.functions";

/**
 * Facturar un pedido con un botón: el receptor y las líneas salen del
 * propio pedido, no hay nada que volver a escribir.
 *
 * Aun así no emite al primer clic. Primero se piden los datos
 * (`prepararFacturaPedido`, de solo lectura) y se enseñan; solo al confirmar
 * se llama a `emitirFactura`, que es lo único que de verdad escribe. Una
 * factura no se puede editar ni borrar después, así que el hueco para
 * revisar antes de emitir importa más aquí que en casi cualquier otro sitio
 * de la aplicación.
 */
export function FacturarPedidoDialog({
  open,
  onOpenChange,
  pedidoId,
  numeroPedido,
  onEmitida,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pedidoId: string;
  numeroPedido: string;
  onEmitida: () => void;
}) {
  const qc = useQueryClient();
  const prepararFn = useServerFn(prepararFacturaPedido);
  const emitirFn = useServerFn(emitirFactura);
  const generarPDFFn = useServerFn(generarYSubirFacturaPDF);

  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [emitiendo, setEmitiendo] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["preparar-factura-pedido", pedidoId],
    queryFn: () => prepararFn({ data: { pedido_id: pedidoId } }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setFecha(new Date().toISOString().slice(0, 10));
  }, [open]);

  useEffect(() => {
    if (data && !data.ya_facturado) setNotas(data.notas ?? "");
  }, [data]);

  const totales = data && !data.ya_facturado ? calcularTotales(data.lineas) : null;

  async function emitir() {
    if (!data || data.ya_facturado) return;
    setEmitiendo(true);
    try {
      const factura = await emitirFn({
        data: {
          tienda_id: data.tienda_id,
          receptor: data.receptor,
          lineas: data.lineas,
          fecha,
          cliente_id: data.cliente_id,
          pedido_id: pedidoId,
          notas: notas.trim() || null,
        },
      });

      try {
        const res = await generarPDFFn({ data: { factura_id: factura.id } });
        if (res?.url) window.open(res.url, "_blank");
        toast.success(`Factura ${factura.referencia} emitida`);
      } catch (errPdf: any) {
        toast.warning(
          `Factura ${factura.referencia} emitida, pero no se pudo generar el PDF: ${errPdf?.message ?? "error desconocido"}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["facturas"] });
      qc.invalidateQueries({ queryKey: ["preparar-factura-pedido", pedidoId] });
      onEmitida();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo emitir la factura");
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Facturar pedido {numeroPedido}</DialogTitle>
          <DialogDescription>
            El receptor y las líneas salen del pedido. Revísalos y emite.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Preparando…</p>}

        {error && (
          <p className="py-6 text-center text-sm text-destructive">
            {(error as Error).message || "No se pudo preparar la factura"}
          </p>
        )}

        {data && data.ya_facturado && (
          <div className="py-6 text-center space-y-2">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm">
              Este pedido ya tiene la factura <strong>{data.factura.referencia}</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              Si de verdad hace falta otra —una corrección, un envío facturado aparte—, se emite a
              mano desde «Nueva factura», en Facturas.
            </p>
          </div>
        )}

        {data && !data.ya_facturado && (
          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Receptor
              </Label>
              <p className="font-medium">{data.receptor.nombre}</p>
              <p className="text-sm text-muted-foreground">
                {[data.receptor.direccion, data.receptor.ciudad, data.receptor.pais]
                  .filter(Boolean)
                  .join(", ") || "Sin dirección"}
              </p>
              {data.sin_nif ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-status-pendiente">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Sin NIF: este pedido no tiene un cliente vinculado con NIF en su ficha. La factura
                  va a salir sin NIF.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">NIF: {data.receptor.nif}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fecha de emisión</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  No puede ser anterior a la última factura emitida.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Notas</Label>
                <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
              </div>
            </div>

            <div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">IVA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lineas.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.cantidad} {l.unidad}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {eur(l.precio_unitario)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.iva_rate} %</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totales && (
              <div className="grid grid-cols-3 gap-3 text-sm pt-2 border-t">
                <div>
                  Subtotal: <span className="font-medium">{eur(totales.base_imponible)}</span>
                </div>
                <div>
                  IVA: <span className="font-medium">{eur(totales.iva_total)}</span>
                </div>
                <div>
                  Total: <span className="font-semibold">{eur(totales.total)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {data && !data.ya_facturado && (
            <Button onClick={emitir} disabled={emitiendo}>
              {emitiendo ? "Emitiendo…" : "Emitir factura"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
