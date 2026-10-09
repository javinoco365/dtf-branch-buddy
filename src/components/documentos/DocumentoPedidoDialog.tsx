import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { diaEnEspana, diaLegible } from "@/dominio/fecha-documento";
import {
  cabeEnTicket,
  decidirDocumento,
  explicarDecision,
  type LimitesTicket,
  type TipoFiscal,
} from "@/dominio/tickets";

/** Lo que devuelve la preparación: el documento que ya hay, o lo necesario para emitir. */
export type DocumentoPreparado =
  | {
      ya_facturado: true;
      factura: { id: string; tipo: string; referencia: string };
    }
  | {
      ya_facturado: false;
      receptor: { nombre: string; nif: string | null; direccion: string | null };
      lineas: {
        descripcion: string;
        cantidad: number;
        unidad: string;
        precio_unitario: number;
        iva_rate: number;
      }[];
      total: number;
      tipo_fiscal: TipoFiscal | null;
      /** El día del pedido ('yyyy-mm-dd'): la fecha del documento, que no se cambia. */
      fecha_pedido?: string | null;
      limites: LimitesTicket;
      notas: string | null;
    };

/** Lo que se pide al emitir. Las líneas no viajan: las pone quien emite, desde el pedido. */
export type PeticionDocumento = {
  documento: "ticket" | "factura";
  nombre: string;
  nif: string;
  direccion: string;
  tipo_fiscal: TipoFiscal | null;
  notas: string | null;
};

/**
 * Ticket o factura de un pedido, sea de tienda o de textil: la pantalla es la
 * misma y lo que cambia es de dónde se leen los datos y a qué función se
 * emite. Qué toca lo propone decidirDocumento() (src/dominio/tickets.ts).
 *
 * No emite al primer clic. Primero se preparan los datos (solo lectura) y se
 * enseñan; solo al confirmar se emite. Un ticket o una factura no se pueden
 * editar ni borrar después, así que el hueco para revisar antes de emitir
 * importa más aquí que en casi cualquier otro sitio de la aplicación.
 */
export function DocumentoPedidoDialog({
  open,
  onOpenChange,
  numeroPedido,
  claveQuery,
  preparar,
  emitir,
  abrirPdf,
  alEmitir,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  numeroPedido: string;
  claveQuery: readonly unknown[];
  preparar: () => Promise<DocumentoPreparado>;
  /** El servidor emite con la fecha del pedido, siempre: no se le manda ninguna. */
  emitir: (p: PeticionDocumento) => Promise<{ id: string; referencia: string }>;
  /**
   * Genera el PDF y devuelve una URL para abrirlo, si la hay. Un ticket sale en
   * 80 mm, para la impresora de tickets; una factura, en A4.
   */
  abrirPdf: (id: string, documento: "ticket" | "factura") => Promise<string | null>;
  alEmitir: () => void;
}) {
  const qc = useQueryClient();
  const [notas, setNotas] = useState("");
  const [nombre, setNombre] = useState("");
  const [nif, setNif] = useState("");
  const [direccion, setDireccion] = useState("");
  // Lo que se contesta cuando la regla pregunta si el cliente es particular.
  const [tipoElegido, setTipoElegido] = useState<TipoFiscal | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: claveQuery,
    queryFn: preparar,
    enabled: open,
  });

  // El formulario se rellena una vez por apertura: si los datos se vuelven a
  // leer (al volver a la pestaña), no se pisa lo que alguien ya haya escrito.
  const rellenado = useRef(false);
  useEffect(() => {
    if (!open) return;
    rellenado.current = false;
    setTipoElegido(null);
  }, [open]);

  useEffect(() => {
    if (!data || data.ya_facturado || rellenado.current) return;
    rellenado.current = true;
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

  // La fecha es la del pedido y no se cambia: el servidor la vuelve a leer
  // del pedido al emitir. Aquí solo se enseña.
  const fecha = preparado?.fecha_pedido ?? diaEnEspana(new Date());

  const puedeTicket = !!preparado && cabeEnTicket(preparado.total, tipoFiscal, preparado.limites);
  const puedeFactura = nombre.trim() !== "";

  async function emitirDocumento(documento: "ticket" | "factura") {
    if (!preparado) return;
    if (documento === "factura" && !puedeFactura) {
      toast.error("Una factura necesita el nombre del cliente");
      return;
    }
    setEmitiendo(true);
    // La pestaña del PDF se abre ya, con el clic: al volver de la red el
    // navegador no deja abrir ventanas. Se le pone la dirección cuando llega.
    const ventana = window.open("", "_blank");
    try {
      const r = await emitir({
        documento,
        nombre: nombre.trim(),
        nif: nif.trim(),
        direccion: direccion.trim(),
        tipo_fiscal: tipoFiscal,
        notas: notas.trim() || null,
      });
      const emitido =
        documento === "ticket"
          ? `Ticket ${r.referencia} emitido`
          : `Factura ${r.referencia} emitida`;
      try {
        const url = await abrirPdf(r.id, documento);
        if (url && ventana) ventana.location.href = url;
        else ventana?.close();
        toast.success(emitido);
      } catch (errPdf: any) {
        ventana?.close();
        toast.warning(
          `${emitido}, pero no se pudo generar el PDF: ${errPdf?.message ?? "error desconocido"}`,
        );
      }
      qc.invalidateQueries({ queryKey: claveQuery });
      alEmitir();
    } catch (e: any) {
      ventana?.close();
      toast.error(
        e?.message ??
          (documento === "ticket" ? "No se pudo emitir el ticket" : "No se pudo emitir la factura"),
      );
    } finally {
      setEmitiendo(false);
    }
  }
  const emitirComoTicket = () => emitirDocumento("ticket");
  const emitirComoFactura = () => emitirDocumento("factura");

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
                <p className="flex h-10 items-center text-sm font-medium tabular-nums">
                  {diaLegible(fecha)}
                </p>
                <p className="text-xs text-muted-foreground">La del pedido: no se cambia.</p>
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
