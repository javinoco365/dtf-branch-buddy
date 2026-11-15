import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DocumentoPedidoDialog } from "@/components/documentos/DocumentoPedidoDialog";
import {
  anularFactura,
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
  const anularFn = useServerFn(anularFactura);

  /**
   * El documento nuevo tras rectificar: del mismo tipo que el anulado, con lo
   * que hay ahora en la base (las líneas del pedido y sus devoluciones en
   * negativo).
   */
  async function emitirNuevo(tipo: string) {
    const prep = await qc.fetchQuery({
      queryKey: ["preparar-factura-pedido", pedidoId],
      queryFn: () => prepararFn({ data: { pedido_id: pedidoId } }),
      staleTime: 0,
    });
    if (prep.ya_facturado) throw new Error(`El pedido ya tiene ${prep.factura.referencia}`);
    if (tipo === "simplificada") {
      return emitirTicketFn({
        data: {
          tienda_id: prep.tienda_id,
          lineas: prep.lineas,
          cliente_id: prep.cliente_id,
          pedido_id: pedidoId,
          nombre: prep.receptor.nombre || null,
          tipo_fiscal: prep.tipo_fiscal,
          notas: prep.notas,
        },
      });
    }
    return emitirFacturaFn({
      data: {
        tienda_id: prep.tienda_id,
        receptor: prep.receptor,
        lineas: prep.lineas,
        cliente_id: prep.cliente_id,
        pedido_id: pedidoId,
        notas: prep.notas,
        metodo_pago: prep.metodo_pago ?? null,
      },
    });
  }

  return (
    <DocumentoPedidoDialog
      open={open}
      onOpenChange={onOpenChange}
      numeroPedido={numeroPedido}
      claveQuery={["preparar-factura-pedido", pedidoId]}
      preparar={() => prepararFn({ data: { pedido_id: pedidoId } })}
      emitir={async (p) => {
        // Las líneas y el receptor base salen de la preparación, que ya está en caché.
        // staleTime 0: se emite con lo que hay ahora en la base, aunque la
        // preparación en caché sea de hace menos de un minuto (otro usuario
        // puede haber cambiado el pedido entretanto).
        const prep = await qc.fetchQuery({
          queryKey: ["preparar-factura-pedido", pedidoId],
          queryFn: () => prepararFn({ data: { pedido_id: pedidoId } }),
          staleTime: 0,
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
            // Las de la vista previa: se emite con lo que se revisó y editó.
            lineas: p.lineas ?? prep.lineas,
            cliente_id: prep.cliente_id,
            pedido_id: pedidoId,
            notas: p.notas,
            metodo_pago: p.metodo_pago,
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
      // Devolución después de emitir: rectificativa total (R1, art. 80 Dos de
      // la Ley del IVA: devoluciones) y documento nuevo del mismo tipo.
      corregir={async (documento, descuadre, alAvanzar) => {
        alAvanzar("rectificar");
        const r = await anularFn({ data: { factura_id: documento.id, motivo: "R1" } });
        if (descuadre.devuelto_entero) return { rectificativa: r.referencia, nuevo: null };
        alAvanzar("emitir", r.referencia);
        const nuevo = await emitirNuevo(documento.tipo);
        return {
          rectificativa: r.referencia,
          nuevo: { id: nuevo.id, referencia: nuevo.referencia },
        };
      }}
      reintentarEmision={async (tipo) => {
        const nuevo = await emitirNuevo(tipo);
        return { id: nuevo.id, referencia: nuevo.referencia };
      }}
    />
  );
}
