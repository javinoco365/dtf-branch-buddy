import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DocumentoPedidoDialog } from "@/components/documentos/DocumentoPedidoDialog";
import {
  emitirFactura,
  emitirTicket,
  generarYSubirFacturaPDF,
  prepararFacturaPedido,
} from "@/lib/facturas.functions";

/** Ticket o factura de un pedido de tienda. La pantalla es DocumentoPedidoDialog. */
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

  return (
    <DocumentoPedidoDialog
      open={open}
      onOpenChange={onOpenChange}
      numeroPedido={numeroPedido}
      claveQuery={["preparar-factura-pedido", pedidoId]}
      preparar={() => prepararFn({ data: { pedido_id: pedidoId } })}
      emitir={async (p) => {
        // Las líneas y el receptor base salen de la preparación, que ya está en caché.
        const prep = await qc.fetchQuery({
          queryKey: ["preparar-factura-pedido", pedidoId],
          queryFn: () => prepararFn({ data: { pedido_id: pedidoId } }),
        });
        if (prep.ya_facturado) throw new Error(`El pedido ya tiene ${prep.factura.referencia}`);
        if (p.documento === "ticket") {
          return emitirTicketFn({
            data: {
              tienda_id: prep.tienda_id,
              lineas: prep.lineas,
              cliente_id: prep.cliente_id,
              pedido_id: pedidoId,
              nombre: p.nombre || null,
              tipo_fiscal: p.tipo_fiscal,
              notas: p.notas,
            },
          });
        }
        return emitirFacturaFn({
          data: {
            tienda_id: prep.tienda_id,
            receptor: {
              ...prep.receptor,
              nombre: p.nombre,
              nif: p.nif || null,
              direccion: p.direccion || null,
            },
            lineas: prep.lineas,
            cliente_id: prep.cliente_id,
            pedido_id: pedidoId,
            notas: p.notas,
          },
        });
      }}
      // Ticket o factura, siempre en A4: el ticket sale como factura simplificada.
      abrirPdf={async (id) => (await generarPDFFn({ data: { factura_id: id } }))?.url ?? null}
      alEmitir={() => {
        qc.invalidateQueries({ queryKey: ["facturas"] });
        qc.invalidateQueries({ queryKey: ["pedidos-sin-documento"] });
        onEmitida();
      }}
    />
  );
}
