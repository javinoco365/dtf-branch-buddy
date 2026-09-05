import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { guardarInversion, type MovimientoInversion } from "@/lib/inversion.functions";
import type { SocioCaja } from "@/lib/caja.functions";
import type { TipoInversion } from "@/dominio/inversion";

export function InversionFormDialog({
  open,
  onOpenChange,
  movimiento,
  socios,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  movimiento?: MovimientoInversion;
  socios: SocioCaja[];
  onSaved: () => void;
}) {
  const esEdicion = !!movimiento;
  const [fecha, setFecha] = useState("");
  const [socioId, setSocioId] = useState("");
  const [tipo, setTipo] = useState<TipoInversion>("aportacion");
  const [importe, setImporte] = useState("");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    if (!open) return;
    setFecha(movimiento?.fecha ?? new Date().toISOString().slice(0, 10));
    setSocioId(movimiento?.socio_id ?? "");
    setTipo(movimiento?.tipo ?? "aportacion");
    setImporte(movimiento ? String(movimiento.importe) : "");
    setObservaciones(movimiento?.observaciones ?? "");
  }, [open, movimiento]);

  // Al editar, un socio desactivado tiene que seguir en la lista: si no, el
  // desplegable saldría vacío y guardar le cambiaría el socio al apunte.
  const visibles = useMemo(
    () => socios.filter((s) => s.activo || s.id === movimiento?.socio_id),
    [socios, movimiento],
  );

  const guardar = useServerFn(guardarInversion);

  const mut = useMutation({
    mutationFn: async () => {
      if (!socioId) throw new Error("Elige un socio");
      const n = Number(String(importe).replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) throw new Error("El importe tiene que ser mayor que cero");
      return guardar({
        data: {
          id: movimiento?.id,
          fecha,
          socio_id: socioId,
          tipo,
          importe: n,
          observaciones: observaciones || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(esEdicion ? "Apunte actualizado" : "Apunte guardado");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido guardar"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar apunte" : "Nuevo apunte de inversión"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Importe (€)</Label>
              <Input
                inputMode="decimal"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Socio</Label>
            <Select value={socioId} onValueChange={setSocioId}>
              <SelectTrigger>
                <SelectValue placeholder="Elige un socio" />
              </SelectTrigger>
              <SelectContent>
                {visibles.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                    {!s.activo && (
                      <span className="text-muted-foreground text-xs ml-2">desactivado</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoInversion)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aportacion">Aportación — el socio mete dinero</SelectItem>
                <SelectItem value="retirada">Retirada — recupera o se reparte</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Observaciones</Label>
            <Textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
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
