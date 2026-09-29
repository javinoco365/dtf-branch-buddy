import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DocumentoPedidoDialog } from "@/components/documentos/DocumentoPedidoDialog";
import {
  emitirDocumentoTextil,
  generarPdfFacturaTextil,
  generarTicket80Textil,
  prepararDocumentoTextil,
  urlFacturaTextil,
} from "@/lib/textil.functions";

/**
 * Ticket o factura de un pedido textil. Opcional: nada obliga a emitir y nada
 * se emite solo. La pantalla es la misma que en las tiendas.
 */
export function DocumentoTextilDialog({
  open,
  onOpenChange,
  pedidoId,
  numeroPedido,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pedidoId: string;
  numeroPedido: string;
}) {
  const qc = useQueryClient();
  const prepararFn = useServerFn(prepararDocumentoTextil);
  const emitirFn = useServerFn(emitirDocumentoTextil);
  const generarFn = useServerFn(generarPdfFacturaTextil);
  const urlFn = useServerFn(urlFacturaTextil);
  const ticket80Fn = useServerFn(generarTicket80Textil);

  return (
    <DocumentoPedidoDialog
      open={open}
      onOpenChange={onOpenChange}
      numeroPedido={numeroPedido}
      claveQuery={["preparar-documento-textil", pedidoId]}
      preparar={() => prepararFn({ data: { textil_pedido_id: pedidoId } })}
      emitir={(p) =>
        emitirFn({
          data: {
            textil_pedido_id: pedidoId,
            documento: p.documento,
            nombre: p.nombre || null,
            nif: p.nif || null,
            direccion: p.direccion || null,
            tipo_fiscal: p.tipo_fiscal,
            fecha: p.fecha,
            notas: p.notas,
          },
        })
      }
      abrirPdf={async (id, documento) => {
        // El A4 se genera siempre: es el que se guarda y el que enseña la lista de facturas.
        await generarFn({ data: { factura_id: id } });
        if (documento === "ticket") return (await ticket80Fn({ data: { factura_id: id } })).url;
        return (await urlFn({ data: { factura_id: id } })).url;
      }}
      alEmitir={() => {
        qc.invalidateQueries({ queryKey: ["textil-facturas"] });
        onOpenChange(false);
      }}
    />
  );
}
