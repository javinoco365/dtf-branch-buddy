import { useEffect, useState } from "react";
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
import { enviarDocumentoPorCorreo } from "@/lib/facturas.functions";

/**
 * Mandar por correo una factura o un ticket de tienda, con el PDF adjunto.
 * El email se propone con el que se congeló en el documento, si lo hay.
 */
export function EnviarDocumentoDialog({
  open,
  onOpenChange,
  facturaId,
  referencia,
  esTicket,
  emailInicial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  facturaId: string;
  referencia: string;
  esTicket: boolean;
  emailInicial: string | null;
}) {
  const enviarFn = useServerFn(enviarDocumentoPorCorreo);
  const [para, setPara] = useState(emailInicial ?? "");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (open) setPara(emailInicial ?? "");
  }, [open, emailInicial]);

  async function enviar() {
    setEnviando(true);
    try {
      const r = await enviarFn({ data: { factura_id: facturaId, para: para.trim() } });
      if (r.ok) {
        toast.success(`${esTicket ? "Ticket" : "Factura"} ${referencia} enviado a ${r.para}`);
        onOpenChange(false);
      } else {
        toast.error(`No se ha enviado: ${r.error}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se ha podido enviar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Enviar {esTicket ? "el ticket" : "la factura"} {referencia}
          </DialogTitle>
          <DialogDescription>
            Sale con el remitente de la tienda y el PDF en A4 adjunto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="enviar-para">Email del cliente</Label>
          <Input
            id="enviar-para"
            type="email"
            value={para}
            onChange={(e) => setPara(e.target.value)}
            placeholder="cliente@ejemplo.com"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando || !para.trim()}>
            {enviando ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
