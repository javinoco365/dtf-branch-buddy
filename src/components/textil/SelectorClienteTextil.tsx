import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { tabla } from "@/lib/rpc";
import { upsertTextilCliente } from "@/lib/textil.functions";

export type ClienteTextil = {
  id: string;
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  nif?: string | null;
};

const NUEVO_CLIENTE = "__nuevo_cliente__";

/**
 * El desplegable de cliente de pedidos y presupuestos textil, con alta rápida.
 *
 * «+ Nuevo cliente…» abre un diálogo encima del formulario, sin cerrarlo ni
 * perder lo que ya se ha rellenado. Al crearlo queda elegido y entra en la
 * lista de clientes textil, igual que si se hubiera dado de alta en Clientes.
 *
 * Devuelve el cliente entero y no solo su id: el recién creado todavía no está
 * en la lista que tiene el formulario, así que buscarlo por id no lo
 * encontraría.
 *
 * Con `tiendaId` sirve también en una tienda: el cliente nuevo se da de alta
 * en la ficha única con esa tienda de origen, y se añade a la lista de
 * `claveLista`.
 */
export function SelectorClienteTextil({
  clientes,
  valor,
  onElegir,
  tiendaId,
  claveLista = ["textil-clientes"],
}: {
  clientes: ClienteTextil[];
  valor: string | null | undefined;
  onElegir: (cliente: ClienteTextil) => void;
  tiendaId?: string;
  claveLista?: readonly unknown[];
}) {
  const [altaAbierta, setAltaAbierta] = useState(false);

  return (
    <>
      <Select
        value={valor ?? ""}
        onValueChange={(v) => {
          if (v === NUEVO_CLIENTE) {
            setAltaAbierta(true);
            return;
          }
          const c = clientes.find((x) => x.id === v);
          if (c) onElegir(c);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecciona…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NUEVO_CLIENTE}>
            <span className="flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Nuevo cliente…
            </span>
          </SelectItem>
          {clientes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <NuevoClienteTextilDialog
        open={altaAbierta}
        onOpenChange={setAltaAbierta}
        onCreado={onElegir}
        tiendaId={tiendaId}
        claveLista={claveLista}
      />
    </>
  );
}

function NuevoClienteTextilDialog({
  open,
  onOpenChange,
  onCreado,
  tiendaId,
  claveLista,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreado: (cliente: ClienteTextil) => void;
  tiendaId?: string;
  claveLista: readonly unknown[];
}) {
  const qc = useQueryClient();
  const guardar = useServerFn(upsertTextilCliente);
  const [nombre, setNombre] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");

  useEffect(() => {
    if (!open) return;
    setNombre("");
    setNif("");
    setEmail("");
    setTelefono("");
    setDireccion("");
  }, [open]);

  const alta = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("Ponle un nombre al cliente");
      if (tiendaId) {
        // En una tienda: a la ficha única, con esa tienda como origen.
        const { data, error } = await tabla(supabase, "clientes")
          .insert({
            tienda_id: tiendaId,
            origen: "tienda",
            nombre: nombre.trim(),
            nif: nif.trim() || null,
            email: email.trim() || null,
            telefono: telefono.trim() || null,
            direccion: direccion.trim() || null,
          })
          .select("id, nombre, email, telefono, direccion, nif")
          .single();
        if (error) throw new Error(error.message);
        return data as ClienteTextil;
      }
      return (await guardar({
        data: {
          nombre: nombre.trim(),
          nif: nif.trim() || null,
          email: email.trim() || null,
          telefono: telefono.trim() || null,
          direccion: direccion.trim() || null,
        },
      })) as ClienteTextil;
    },
    onSuccess: (cliente) => {
      qc.setQueryData(claveLista, (actuales: ClienteTextil[] | undefined) =>
        [...(actuales ?? []), cliente].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      );
      qc.invalidateQueries({ queryKey: ["clientes-empresa"] });
      toast.success("Cliente creado");
      onCreado(cliente);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido crear el cliente"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tiendaId ? "Nuevo cliente" : "Nuevo cliente textil"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nombre</Label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>NIF</Label>
              <Input value={nif} onChange={(e) => setNif(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Dirección</Label>
            <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Solo el nombre es obligatorio. NIF y dirección hacen falta para facturarle; si no los
            tienes ahora, se completan después en Clientes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => alta.mutate()} disabled={alta.isPending}>
            {alta.isPending ? "Creando…" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
