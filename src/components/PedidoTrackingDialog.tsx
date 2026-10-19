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
import { fijarCosteEnvioPedido, setPedidoTracking } from "@/lib/pedidos.functions";
import { useAuth } from "@/lib/auth-context";
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
  // Lo que cobró la agencia por este envío, sin IVA (nunca pasa de 5 €, pero
  // no siempre es lo mismo). Vacío: Gerencia lo estima con su coste por defecto.
  const [coste, setCoste] = useState("");
  const { isAdmin } = useAuth();

  useEffect(() => {
    if (!open) return;
    setTransportista(pedido?.tracking?.transportista ?? "");
    setCodigo(pedido?.tracking?.codigo_seguimiento ?? "");
    setUrl(pedido?.tracking?.url ?? "");
    setCoste(
      pedido?.coste_envio_real != null ? String(pedido.coste_envio_real).replace(".", ",") : "",
    );
  }, [open, pedido]);

  const fn = useServerFn(setPedidoTracking);
  const costeFn = useServerFn(fijarCosteEnvioPedido);
  const costeTexto = coste.trim().replace(",", ".");
  const costeValido =
    costeTexto === "" || (/^\d+(\.\d{1,2})?$/.test(costeTexto) && Number(costeTexto) <= 1000);

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
      const r = await fn({
        data: {
          pedido_id: pedido.id,
          transportista: transportista || null,
          codigo_seguimiento: codigo || null,
          url: url || null,
        },
      });
      const nuevo = costeTexto === "" ? null : Number(costeTexto);
      if (isAdmin && nuevo !== (pedido.coste_envio_real ?? null)) {
        await costeFn({ data: { tabla: "pedidos", id: pedido.id, coste: nuevo } });
      }
      return r;
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
          {isAdmin && (
            <div className="space-y-1">
              <Label htmlFor="coste-envio-real">Coste real del envío (€, sin IVA)</Label>
              <Input
                id="coste-envio-real"
                inputMode="decimal"
                value={coste}
                onChange={(e) => setCoste(e.target.value)}
                placeholder="Vacío: se estima con el coste por defecto"
                aria-invalid={!costeValido}
              />
              <p className="text-xs text-muted-foreground">
                Lo que te cobra la agencia por este envío. Sirve para el margen con envíos del
                Resumen de Gerencia.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !costeValido}>
            {mut.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
