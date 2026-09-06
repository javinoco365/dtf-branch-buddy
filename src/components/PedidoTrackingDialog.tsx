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
import { TRANSPORTISTAS_CONOCIDOS, transportistaConocido } from "@/dominio/transportistas";

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

  const aplicarConocido = (nombre: string) => {
    setTransportista(nombre);
    const generada = transportistaConocido(nombre)?.urlSeguimiento(codigo);
    if (generada) setUrl(generada);
  };

  const onCodigoChange = (v: string) => {
    setCodigo(v);
    const generada = transportistaConocido(transportista)?.urlSeguimiento(v);
    if (generada) setUrl(generada);
  };

  const conocidoActual = transportistaConocido(transportista);
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
            <div className="flex flex-wrap gap-2 mt-1">
              {TRANSPORTISTAS_CONOCIDOS.map((t) => (
                <Button
                  key={t.nombre}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => aplicarConocido(t.nombre)}
                >
                  Usar {t.nombre}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Número de seguimiento</Label>
            <Input
              value={codigo}
              onChange={(e) => onCodigoChange(e.target.value)}
              placeholder={conocidoActual?.marcador ?? "0034050034059700104370"}
            />
          </div>
          <div className="space-y-1">
            <Label>URL de seguimiento</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            <p className="text-xs text-muted-foreground">
              {conocidoActual
                ? `${conocidoActual.ayuda} Si recibes por correo un enlace propio, pégalo aquí para sustituirlo.`
                : "Con CTT Express y Nacex el enlace se genera solo desde el número de envío."}
            </p>
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
