import { useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, FileText, Receipt } from "lucide-react";
import { eur } from "@/lib/format";
import { calcularTotales } from "@/dominio/importes";
import {
  cabeEnTicket,
  decidirDocumento,
  explicarDecision,
  type TipoFiscal,
} from "@/dominio/tickets";
import {
  emitirFactura,
  emitirTicket,
  generarYSubirFacturaPDF,
  prepararFacturaPedido,
} from "@/lib/facturas.functions";

/**
 * El documento de un pedido con un botón: ticket o factura, según el cliente y
 * el importe (src/dominio/tickets.ts). Las líneas salen del pedido, no hay
 * nada que volver a escribir.
 *
 * No emite al primer clic. Primero se piden los datos
 * (`prepararFacturaPedido`, de solo lectura) y se enseñan; solo al confirmar
 * se emite. Un ticket o una factura no se pueden editar ni borrar después, así
 * que el hueco para revisar antes de emitir importa más aquí que en casi
 * cualquier otro sitio de la aplicación.
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
  const emitirFacturaFn = useServerFn(emitirFactura);
  const emitirTicketFn = useServerFn(emitirTicket);
  const generarPDFFn = useServerFn(generarYSubirFacturaPDF);

  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [nombre, setNombre] = useState("");
  const [nif, setNif] = useState("");
  const [direccion, setDireccion] = useState("");
  // Lo que se contesta cuando la regla pregunta si el cliente es particular.
  const [tipoElegido, setTipoElegido] = useState<TipoFiscal | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["preparar-factura-pedido", pedidoId],
    queryFn: () => prepararFn({ data: { pedido_id: pedidoId } }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setFecha(new Date().toISOString().slice(0, 10));
    setTipoElegido(null);
  }, [open]);

  useEffect(() => {
    if (!data || data.ya_facturado) return;
    setNotas(data.notas ?? "");
    setNombre(data.receptor.nombre ?? "");
    setNif(data.receptor.nif ?? "");
    setDireccion(data.receptor.direccion ?? "");
  }, [data]);

  const preparado = data && !data.ya_facturado ? data : null;
  const totales = preparado ? calcularTotales(preparado.lineas) : null;
  const tipoFiscal = tipoElegido ?? preparado?.tipo_fiscal ?? null;

  // Se recalcula con lo que haya en los campos: si alguien escribe el NIF, pasa a factura.
  const decision = useMemo(
    () =>
      preparado
        ? decidirDocumento(
            preparado.total,
            { nombre, nif, tipo_fiscal: tipoFiscal },
            preparado.limites,
          )
        : null,
    [preparado, nombre, nif, tipoFiscal],
  );

  const puedeTicket = !!preparado && cabeEnTicket(preparado.total, tipoFiscal, preparado.limites);
  const puedeFactura = nombre.trim() !== "";

  async function abrirPDF(id: string, emitido: string) {
    try {
      const res = await generarPDFFn({ data: { factura_id: id } });
      if (res?.url) window.open(res.url, "_blank");
      toast.success(emitido);
    } catch (errPdf: any) {
      toast.warning(
        `${emitido}, pero no se pudo generar el PDF: ${errPdf?.message ?? "error desconocido"}`,
      );
    }
  }

  function terminar() {
    qc.invalidateQueries({ queryKey: ["facturas"] });
    qc.invalidateQueries({ queryKey: ["preparar-factura-pedido", pedidoId] });
    qc.invalidateQueries({ queryKey: ["pedidos-sin-documento"] });
    onEmitida();
  }

  async function emitirComoTicket() {
    if (!preparado) return;
    setEmitiendo(true);
    try {
      const t = await emitirTicketFn({
        data: {
          tienda_id: preparado.tienda_id,
          lineas: preparado.lineas,
          fecha,
          cliente_id: preparado.cliente_id,
          pedido_id: pedidoId,
          nombre: nombre.trim() || null,
          tipo_fiscal: tipoFiscal,
          notas: notas.trim() || null,
        },
      });
      await abrirPDF(t.id, `Ticket ${t.referencia} emitido`);
      terminar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo emitir el ticket");
    } finally {
      setEmitiendo(false);
    }
  }

  async function emitirComoFactura() {
    if (!preparado) return;
    if (!puedeFactura) {
      toast.error("Una factura necesita el nombre del cliente");
      return;
    }
    setEmitiendo(true);
    try {
      const f = await emitirFacturaFn({
        data: {
          tienda_id: preparado.tienda_id,
          receptor: {
            ...preparado.receptor,
            nombre: nombre.trim(),
            nif: nif.trim() || null,
            direccion: direccion.trim() || null,
          },
          lineas: preparado.lineas,
          fecha,
          cliente_id: preparado.cliente_id,
          pedido_id: pedidoId,
          notas: notas.trim() || null,
        },
      });
      await abrirPDF(f.id, `Factura ${f.referencia} emitida`);
      terminar();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo emitir la factura");
    } finally {
      setEmitiendo(false);
    }
  }

  const principal = decision?.documento === "ticket" ? "ticket" : "factura";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ticket o factura · pedido {numeroPedido}</DialogTitle>
          <DialogDescription>
            Las líneas salen del pedido. La aplicación propone qué documento toca; revísalo y emite.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Preparando…</p>}

        {error && (
          <p className="py-6 text-center text-sm text-destructive">
            {(error as Error).message || "No se pudo preparar el documento"}
          </p>
        )}

        {data && data.ya_facturado && (
          <div className="py-6 text-center space-y-2">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm">
              Este pedido ya tiene{" "}
              {data.factura.tipo === "simplificada" ? "el ticket" : "la factura"}{" "}
              <strong>{data.factura.referencia}</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              Para cambiarlo, rectifícalo desde Facturas; después se puede emitir otro.
            </p>
          </div>
        )}

        {preparado && decision && (
          <div className="space-y-4">
            <div
              className={
                decision.documento === "ticket" || decision.documento === "factura"
                  ? "rounded-md border p-3 text-sm"
                  : "rounded-md border border-status-pendiente/40 bg-status-pendiente/5 p-3 text-sm"
              }
            >
              <p className="flex items-center gap-2 font-medium">
                {decision.documento === "ticket" ? (
                  <Receipt className="h-4 w-4 shrink-0" />
                ) : decision.documento === "factura" ? (
                  <FileText className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-status-pendiente" />
                )}
                {explicarDecision(decision)}
              </p>
              {decision.documento === "ticket" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Límite del ticket para este cliente: {eur(decision.limite)}.
                </p>
              )}
              {decision.documento === "preguntar_tipo" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Suma {eur(preparado.total)}: más de {eur(decision.limite)}, menos de{" "}
                    {eur(decision.limite_particular)}.
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setTipoElegido("particular")}>
                    Es particular
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTipoElegido("profesional")}>
                    Es profesional o empresa
                  </Button>
                </div>
              )}
              {decision.documento === "pedir_datos" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Suma {eur(preparado.total)} y el límite es {eur(decision.limite)}. Rellena abajo
                  el nombre y el NIF.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Cliente {principal === "ticket" && "(opcional en un ticket)"}
              </Label>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  placeholder="Nombre o razón social"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  aria-label="Nombre del cliente"
                />
                <Input
                  placeholder="NIF"
                  value={nif}
                  onChange={(e) => setNif(e.target.value)}
                  aria-label="NIF del cliente"
                />
              </div>
              <Input
                placeholder="Dirección"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                aria-label="Dirección del cliente"
              />
              {principal === "ticket" && (
                <p className="text-xs text-muted-foreground">
                  El ticket no lleva NIF. Si el cliente lo da, pasa a factura.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fecha de emisión</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  No puede ser anterior al último documento de su serie.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Notas</Label>
                <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
              </div>
            </div>

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
                {preparado.lineas.map((l, i) => (
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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {preparado && decision && (
            <>
              {principal === "factura" && puedeTicket && (
                <Button variant="outline" onClick={emitirComoTicket} disabled={emitiendo}>
                  Emitir ticket
                </Button>
              )}
              {principal === "ticket" && (
                <Button
                  variant="outline"
                  onClick={emitirComoFactura}
                  disabled={emitiendo || !puedeFactura}
                >
                  Emitir factura
                </Button>
              )}
              {principal === "ticket" ? (
                <Button onClick={emitirComoTicket} disabled={emitiendo}>
                  {emitiendo ? "Emitiendo…" : "Emitir ticket"}
                </Button>
              ) : (
                <Button
                  onClick={emitirComoFactura}
                  disabled={
                    emitiendo ||
                    !puedeFactura ||
                    decision.documento === "preguntar_tipo" ||
                    (decision.documento === "pedir_datos" && nif.trim() === "")
                  }
                >
                  {emitiendo ? "Emitiendo…" : "Emitir factura"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
