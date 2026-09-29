import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { eur, fechaCorta } from "@/lib/format";
import { explicarDecision } from "@/dominio/tickets";
import {
  emitirTicketsPedidos,
  pedidosSinDocumento,
  type PedidoParaTicket,
} from "@/lib/facturas.functions";

/**
 * Emitir de una vez los tickets de los pedidos cobrados que no tienen
 * documento.
 *
 * Primero se ve qué entra, en un periodo que se elige (por defecto, este
 * mes): emitir hoy tickets de ventas de hace meses es una decisión fiscal, no
 * un clic. En bloque solo van los que no admiten duda —sin NIF y dentro del
 * límite—; el resto se enseña para hacerlo uno a uno desde el pedido.
 */
export function TicketsPendientesDialog({ tiendaId }: { tiendaId: string }) {
  const qc = useQueryClient();
  const listarFn = useServerFn(pedidosSinDocumento);
  const emitirFn = useServerFn(emitirTicketsPedidos);

  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [hasta, setHasta] = useState(() => format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<{
    emitidos: { pedido: string; referencia: string }[];
    omitidos: { pedido: string; motivo: string }[];
  } | null>(null);

  const clave = ["pedidos-sin-documento", tiendaId, desde, hasta] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: clave,
    queryFn: () => listarFn({ data: { tienda_id: tiendaId, desde, hasta } }),
    enabled: abierto && desde <= hasta,
  });

  async function emitir() {
    if (!data?.tickets.length) return;
    setEmitiendo(true);
    try {
      const r = await emitirFn({ data: { pedido_ids: data.tickets.map((p) => p.id) } });
      setResultado(r);
      if (r.emitidos.length) toast.success(`${r.emitidos.length} ticket(s) emitido(s)`);
      if (r.omitidos.length) toast.warning(`${r.omitidos.length} pedido(s) no se han emitido`);
      qc.invalidateQueries({ queryKey: ["facturas"] });
      qc.invalidateQueries({ queryKey: ["pedidos-sin-documento"] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudieron emitir los tickets");
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => {
        setAbierto(o);
        if (!o) setResultado(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Receipt className="h-4 w-4 mr-2" /> Tickets pendientes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tickets de pedidos cobrados</DialogTitle>
          <DialogDescription>
            Pedidos cobrados enteros que todavía no tienen ticket ni factura. Los tickets salen con
            la fecha de hoy.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Pedidos desde</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>hasta</Label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>

        {isLoading && <p className="py-4 text-center text-sm text-muted-foreground">Buscando…</p>}
        {error && (
          <p className="py-4 text-center text-sm text-destructive">
            {(error as Error).message || "No se pudo leer los pedidos"}
          </p>
        )}

        {resultado && (
          <div className="space-y-1 rounded-md border p-3 text-sm">
            {resultado.emitidos.length > 0 && (
              <p>
                Emitidos:{" "}
                {resultado.emitidos.map((e) => `${e.referencia} (${e.pedido})`).join(", ")}
              </p>
            )}
            {resultado.omitidos.map((o) => (
              <p key={o.pedido} className="text-status-pendiente">
                {o.pedido}: {o.motivo}
              </p>
            ))}
          </div>
        )}

        {data && !resultado && (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto text-sm">
            <Bloque
              titulo={`Van en ticket (${data.tickets.length})`}
              vacio="Ningún pedido cobrado sin documento en estas fechas."
              pedidos={data.tickets}
            />
            {data.revisar.length > 0 && (
              <Bloque
                titulo={`Uno a uno, desde el pedido (${data.revisar.length})`}
                pedidos={data.revisar}
                conMotivo
              />
            )}
            {data.facturas.length > 0 && (
              <Bloque
                titulo={`Tienen NIF: factura desde el pedido (${data.facturas.length})`}
                pedidos={data.facturas}
              />
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>
            Cerrar
          </Button>
          {data && !resultado && (
            <Button onClick={emitir} disabled={emitiendo || data.tickets.length === 0}>
              {emitiendo ? "Emitiendo…" : `Emitir ${data.tickets.length} ticket(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Bloque({
  titulo,
  pedidos,
  vacio,
  conMotivo,
}: {
  titulo: string;
  pedidos: PedidoParaTicket[];
  vacio?: string;
  conMotivo?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{titulo}</p>
      {pedidos.length === 0 && vacio && <p className="text-muted-foreground">{vacio}</p>}
      {pedidos.map((p) => (
        <div key={p.id} className="flex flex-wrap items-baseline gap-x-3 text-muted-foreground">
          <span className="font-mono text-foreground">{p.numero}</span>
          <span>{fechaCorta(p.fecha)}</span>
          <span className="truncate">{p.cliente_nombre || "Sin nombre"}</span>
          <span className="ml-auto tabular-nums text-foreground">{eur(p.total)}</span>
          {conMotivo && <span className="w-full text-xs">{explicarDecision(p.decision)}</span>}
        </div>
      ))}
    </div>
  );
}
