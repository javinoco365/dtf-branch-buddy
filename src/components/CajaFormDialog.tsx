import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { tabla } from "@/lib/rpc";
import {
  guardarMovimientoCaja,
  type ConceptoCaja,
  type MovimientoCaja,
  type SocioCaja,
} from "@/lib/caja.functions";

const SIN_CLIENTE = "__sin_cliente__";
const SIN_SOCIO = "__sin_socio__";
const NUEVO_CLIENTE = "__nuevo_cliente__";

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
  const qc = useQueryClient();
  const [fecha, setFecha] = useState("");
  const [conceptoId, setConceptoId] = useState("");
  const [clienteId, setClienteId] = useState(SIN_CLIENTE);
  const [socioId, setSocioId] = useState(SIN_SOCIO);
  const [importe, setImporte] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [nuevoClienteAbierto, setNuevoClienteAbierto] = useState(false);

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
              <Select
                value={clienteId}
                onValueChange={(v) => {
                  if (v === NUEVO_CLIENTE) {
                    setNuevoClienteAbierto(true);
                    return;
                  }
                  setClienteId(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_CLIENTE}>Sin cliente (venta de mostrador)</SelectItem>
                  <SelectItem value={NUEVO_CLIENTE}>
                    <span className="flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Nuevo cliente…
                    </span>
                  </SelectItem>
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

      <NuevoClienteDialog
        open={nuevoClienteAbierto}
        onOpenChange={setNuevoClienteAbierto}
        onCreado={(cliente) => {
          qc.setQueryData(
            ["caja-clientes"],
            (actuales: { id: string; nombre: string }[] | undefined) =>
              [...(actuales ?? []), cliente].sort((a, b) => a.nombre.localeCompare(b.nombre)),
          );
          setClienteId(cliente.id);
        }}
      />
    </Dialog>
  );
}

/**
 * Alta rápida de un cliente, sin salir del apunte de caja.
 *
 * Solo pide lo imprescindible. El cliente es de la empresa, no de una tienda,
 * y Caja no está dentro de ninguna: se da de alta con origen «general». El
 * resto de la ficha (NIF, dirección, apodo…) se completa después desde
 * Clientes, si hace falta.
 */
function NuevoClienteDialog({
  open,
  onOpenChange,
  onCreado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreado: (cliente: { id: string; nombre: string }) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    setNombre("");
    setTelefono("");
    setEmail("");
  }, [open]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("Ponle un nombre al cliente");
      const { data, error } = await tabla(supabase, "clientes")
        .insert({
          tienda_id: null,
          origen: "general",
          nombre: nombre.trim(),
          telefono: telefono.trim() || null,
          email: email.trim() || null,
        })
        .select("id, nombre")
        .single();
      if (error) throw error;
      return data as { id: string; nombre: string };
    },
    onSuccess: (cliente) => {
      toast.success("Cliente creado");
      onCreado(cliente);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido crear el cliente"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nombre</Label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            El resto de datos —NIF, dirección…— se rellenan luego desde Clientes, si hace falta.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Creando…" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
