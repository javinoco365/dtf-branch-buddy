import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { supabase } from "@/integrations/supabase/client";
import {
  guardarMovimientoCaja,
  type ConceptoCaja,
  type MovimientoCaja,
  type SocioCaja,
} from "@/lib/caja.functions";

const SIN_CLIENTE = "__sin_cliente__";
const SIN_SOCIO = "__sin_socio__";

/**
 * Alta y edición de un apunte de caja.
 *
 * La categoría no se elige: la trae el concepto. Por eso el desplegable de
 * Cliente o el de Socio aparecen y desaparecen según lo que se elija ahí, en
 * vez de dejar los dos puestos y rechazar la combinación al guardar.
 */
export function CajaFormDialog({
  open,
  onOpenChange,
  movimiento,
  conceptos,
  socios,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  movimiento?: MovimientoCaja;
  conceptos: ConceptoCaja[];
  socios: SocioCaja[];
  onSaved: () => void;
}) {
  const esEdicion = !!movimiento;
  const [fecha, setFecha] = useState("");
  const [conceptoId, setConceptoId] = useState("");
  const [clienteId, setClienteId] = useState(SIN_CLIENTE);
  const [socioId, setSocioId] = useState(SIN_SOCIO);
  const [importe, setImporte] = useState("");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    if (!open) return;
    setFecha(movimiento?.fecha ?? new Date().toISOString().slice(0, 10));
    setConceptoId(movimiento?.concepto_id ?? "");
    setClienteId(movimiento?.cliente_id ?? SIN_CLIENTE);
    setSocioId(movimiento?.socio_id ?? SIN_SOCIO);
    setImporte(movimiento ? String(movimiento.importe) : "");
    setObservaciones(movimiento?.observaciones ?? "");
  }, [open, movimiento]);

  // Al editar, un concepto desactivado tiene que seguir apareciendo en la
  // lista: si no, el desplegable saldría vacío y guardar cambiaría el concepto
  // del apunte sin querer.
  const conceptosVisibles = useMemo(
    () => conceptos.filter((c) => c.activo || c.id === movimiento?.concepto_id),
    [conceptos, movimiento],
  );
  const sociosVisibles = useMemo(
    () => socios.filter((s) => s.activo || s.id === movimiento?.socio_id),
    [socios, movimiento],
  );

  const concepto = conceptos.find((c) => c.id === conceptoId);
  const esIngreso = concepto?.categoria === "ingreso";
  const esGasto = concepto?.categoria === "gasto";

  const { data: clientes } = useQuery({
    queryKey: ["caja-clientes"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("clientes").select("id, nombre").order("nombre");
      return (data ?? []) as { id: string; nombre: string }[];
    },
  });

  const guardar = useServerFn(guardarMovimientoCaja);

  const mut = useMutation({
    mutationFn: async () => {
      if (!conceptoId) throw new Error("Elige un concepto");
      const n = Number(String(importe).replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) throw new Error("El importe tiene que ser mayor que cero");
      return guardar({
        data: {
          id: movimiento?.id,
          fecha,
          concepto_id: conceptoId,
          // Lo que no corresponde a la categoría se manda vacío. La base lo
          // rechazaría igual, pero así el error no llega nunca a pasar.
          cliente_id: esIngreso && clienteId !== SIN_CLIENTE ? clienteId : null,
          socio_id: esGasto && socioId !== SIN_SOCIO ? socioId : null,
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
          <DialogTitle>{esEdicion ? "Editar apunte" : "Nuevo apunte de caja"}</DialogTitle>
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
            <Label>Concepto</Label>
            <Select value={conceptoId} onValueChange={setConceptoId}>
              <SelectTrigger>
                <SelectValue placeholder="Elige un concepto" />
              </SelectTrigger>
              <SelectContent>
                {conceptosVisibles.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                    <span className="text-muted-foreground text-xs ml-2">
                      {c.categoria === "ingreso" ? "ingreso" : "gasto"}
                      {!c.activo && " · desactivado"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!concepto && (
              <p className="text-xs text-muted-foreground">
                La categoría —ingreso o gasto— la marca el concepto.
              </p>
            )}
          </div>

          {esIngreso && (
            <div className="space-y-1">
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_CLIENTE}>Sin cliente (venta de mostrador)</SelectItem>
                  {(clientes ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {esGasto && (
            <div className="space-y-1">
              <Label>Socio</Label>
              <Select value={socioId} onValueChange={setSocioId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_SOCIO}>Ninguno (lo paga la empresa)</SelectItem>
                  {sociosVisibles.map((s) => (
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
          )}

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
