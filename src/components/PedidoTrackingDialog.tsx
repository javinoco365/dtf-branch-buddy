import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { setPedidoTracking } from "@/lib/pedidos.functions";
import type { PedidoFila } from "@/components/PedidosTable";

export function PedidoTrackingDialog({
  open,
  onOpenChange,
  pedido,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pedido: PedidoFila | null;
  onSaved: () => void;
}) {
  const [transportista, setTransportista] = useState("");
  const [codigo, setCodigo] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setTransportista(pedido?.tracking?.transportista ?? "");
    setCodigo(pedido?.tracking?.codigo_seguimiento ?? "");
    setUrl(pedido?.tracking?.url ?? "");
  }, [open, pedido]);

  const fn = useServerFn(setPedidoTracking);
  const mut = useMutation({
    mutationFn: async () => {
      if (!pedido) return;
      return fn({
        data: {
          pedido_id: pedido.id,
          transportista: transportista || null,
          codigo_seguimiento: codigo || null,
          url: url || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Tracking guardado");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message || "Error al guardar tracking"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tracking de envío · {pedido?.numero}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Transportista</Label>
            <Input
              value={transportista}
              onChange={(e) => setTransportista(e.target.value)}
              placeholder="SEUR, MRW, Correos Express…"
            />
          </div>
          <div className="space-y-1">
            <Label>Número de seguimiento</Label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>URL de seguimiento</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}