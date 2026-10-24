import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { tabla } from "@/lib/rpc";
import { upsertTextilCliente } from "@/lib/textil.functions";
import { avisarError } from "@/lib/errores";
import { cn } from "@/lib/utils";

export type ClienteTextil = {
  id: string;
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  nif?: string | null;
};

/**
 * El desplegable de cliente de pedidos y presupuestos (textil y tiendas) y del
 * pedido manual de tienda: con buscador (nombre, email, teléfono o NIF) y alta
 * rápida.
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
  const [abierto, setAbierto] = useState(false);
  const elegido = clientes.find((c) => c.id === valor);

  return (
    <>
      {/* modal: dentro de un diálogo, si no, la lista no se deja desplazar. */}
      <Popover open={abierto} onOpenChange={setAbierto} modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={abierto}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !elegido && "text-muted-foreground")}>
              {elegido?.nombre ?? "Buscar o crear cliente…"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Nombre, email, teléfono o NIF…" />
            <CommandList>
              <CommandEmpty>Ningún cliente coincide.</CommandEmpty>
              <CommandGroup>
                {clientes.map((c) => (
                  <CommandItem
                    key={c.id}
                    // Por lo que se busca: el id al final para que dos con el
                    // mismo nombre no se confundan.
                    value={[c.nombre, c.email, c.telefono, c.nif, c.id].filter(Boolean).join(" ")}
                    onSelect={() => {
                      onElegir(c);
                      setAbierto(false);
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", c.id === valor ? "opacity-100" : "opacity-0")}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                    {c.email && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">{c.email}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {/* Fuera de la lista: siempre a la vista, y con algo escrito Intro
                elige el primer cliente que coincide, no el alta. */}
            <div className="border-t p-1">
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setAbierto(false);
                  setAltaAbierta(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Nuevo cliente…
              </button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

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
    onError: (e: Error) => avisarError(e, "No se ha podido crear el cliente"),
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
