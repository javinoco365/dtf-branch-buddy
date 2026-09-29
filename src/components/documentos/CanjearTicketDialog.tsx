import { useEffect, useState } from "react";
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
import { eur } from "@/lib/format";

export type DatosCanje = { nombre: string; nif: string; direccion: string };

/**
 * Canjear un ticket por una factura completa, cuando el cliente la pide
 * después. Sale una factura nueva con las mismas líneas y sus datos fiscales;
 * el ticket se queda como estaba. Sirve para tiendas y para textil: cada lado
 * dice a qué función emite y cómo abre el PDF.
 */
export function CanjearTicketDialog({
  open,
  onOpenChange,
  referencia,
  total,
  nombreInicial,
  canjear,
  abrirPdf,
  alCanjear,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  referencia: string;
  total: number;
  nombreInicial: string | null;
  canjear: (d: DatosCanje) => Promise<{ id: string; referencia: string }>;
  abrirPdf: (id: string) => Promise<string | null>;
  alCanjear: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [nif, setNif] = useState("");
  const [direccion, setDireccion] = useState("");
  const [canjeando, setCanjeando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNombre(nombreInicial ?? "");
    setNif("");
    setDireccion("");
  }, [open, nombreInicial]);

  const listo = nombre.trim() !== "" && nif.trim() !== "";

  async function confirmar() {
    setCanjeando(true);
    // La pestaña del PDF se abre con el clic: al volver de la red el navegador
    // ya no deja abrir ventanas.
    const ventana = window.open("", "_blank");
    try {
      const f = await canjear({
        nombre: nombre.trim(),
        nif: nif.trim(),
        direccion: direccion.trim(),
      });
      toast.success(`Ticket ${referencia} canjeado por la factura ${f.referencia}`);
      try {
        const url = await abrirPdf(f.id);
        if (url && ventana) ventana.location.href = url;
        else ventana?.close();
      } catch {
        ventana?.close();
      }
      alCanjear();
      onOpenChange(false);
    } catch (e: any) {
      ventana?.close();
      toast.error(e?.message ?? "No se pudo canjear el ticket");
    } finally {
      setCanjeando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Canjear el ticket {referencia} por factura</DialogTitle>
          <DialogDescription>
            Sale una factura nueva con las mismas líneas ({eur(total)}) y los datos fiscales del
            cliente. El ticket no se modifica: queda enlazado a la factura que lo sustituye.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="canje-nombre">Nombre o razón social</Label>
            <Input id="canje-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="canje-nif">NIF</Label>
            <Input id="canje-nif" value={nif} onChange={(e) => setNif(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="canje-direccion">Dirección</Label>
            <Input
              id="canje-direccion"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={canjeando || !listo}>
            {canjeando ? "Emitiendo…" : "Emitir factura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
