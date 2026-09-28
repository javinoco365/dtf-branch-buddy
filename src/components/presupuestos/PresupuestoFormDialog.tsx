import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { tabla } from "@/lib/rpc";
import { eur } from "@/lib/format";
import { guardarPresupuesto, type Presupuesto } from "@/lib/presupuestos.functions";
import {
  SelectorClienteTextil,
  type ClienteTextil,
} from "@/components/textil/SelectorClienteTextil";
import { IVA_GENERAL } from "@/dominio/importes";
import { totalesPresupuesto, type LineaPresupuesto } from "@/dominio/presupuestos";

const LIBRE = "__libre__";

type ProductoCatalogo = {
  id: string;
  tienda_id: string | null;
  nombre: string;
  descripcion: string | null;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
};

/** La línea como la edita el formulario: los números, como texto. */
type LineaForm = {
  producto_id: string | null;
  descripcion: string;
  cantidad: string;
  unidad: string;
  precio_unitario: string;
};

const LINEA_VACIA: LineaForm = {
  producto_id: null,
  descripcion: "",
  cantidad: "1",
  unidad: "ud",
  precio_unitario: "0",
};

const aNumero = (t: string) => Number(String(t).trim().replace(",", ".")) || 0;
const aTexto = (n: number) => String(n).replace(".", ",");

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Alta y edición de un presupuesto de tienda.
 *
 * Cada línea sale de un producto del catálogo (los de la tienda y los
 * generales), que rellena descripción, unidad y precio, o es una línea libre.
 * Lo que se guarda es lo que se ve: los importes los calcula el mismo módulo
 * de dominio aquí y en el servidor.
 */
export function PresupuestoFormDialog({
  open,
  onOpenChange,
  tiendaId,
  presupuesto,
  onGuardado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tiendaId: string;
  presupuesto?: Presupuesto;
  onGuardado: () => void;
}) {
  const guardar = useServerFn(guardarPresupuesto);

  const [clienteId, setClienteId] = useState<string | null>(null);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [validez, setValidez] = useState("30");
  const [envio, setEnvio] = useState("0");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([LINEA_VACIA]);
  // Un presupuesto sin IVA (exportación, inversión del sujeto pasivo): todas
  // las líneas al 0 %. Como en los pedidos, un interruptor para el documento.
  const [aplicaIva, setAplicaIva] = useState(true);

  const { data: clientes = [] } = useQuery({
    queryKey: ["presupuesto-clientes"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await tabla(supabase, "clientes")
        .select("id, nombre, email, telefono, direccion, nif")
        .order("nombre");
      if (error) throw error;
      return (data ?? []) as ClienteTextil[];
    },
  });

  const { data: productos = [] } = useQuery({
    queryKey: ["productos", tiendaId, "catalogo-activo"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await tabla(supabase, "productos")
        .select("id, tienda_id, nombre, descripcion, unidad, precio_unitario, iva_rate")
        .eq("activo", true)
        .or(`tienda_id.eq.${tiendaId},tienda_id.is.null`)
        .order("nombre");
      if (error) throw error;
      return (data ?? []) as ProductoCatalogo[];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (presupuesto) {
      setClienteId(presupuesto.cliente_id);
      setClienteNombre(presupuesto.cliente_nombre ?? "");
      setClienteEmail(presupuesto.cliente_email ?? "");
      setClienteTelefono(presupuesto.cliente_telefono ?? "");
      setFecha(presupuesto.fecha);
      setValidez(String(presupuesto.validez_dias));
      setEnvio(aTexto(Number(presupuesto.envio)));
      setNotas(presupuesto.notas ?? "");
      setLineas(
        presupuesto.items.length
          ? presupuesto.items.map((l) => ({
              producto_id: l.producto_id,
              descripcion: l.descripcion,
              cantidad: aTexto(Number(l.cantidad)),
              unidad: l.unidad,
              precio_unitario: aTexto(Number(l.precio_unitario)),
            }))
          : [LINEA_VACIA],
      );
      setAplicaIva(presupuesto.items.some((l) => Number(l.iva_rate) > 0));
    } else {
      setClienteId(null);
      setClienteNombre("");
      setClienteEmail("");
      setClienteTelefono("");
      setFecha(hoy());
      setValidez("30");
      setEnvio("0");
      setNotas("");
      setLineas([LINEA_VACIA]);
      setAplicaIva(true);
    }
  }, [open, presupuesto]);

  const lineasCalculables: LineaPresupuesto[] = useMemo(
    () =>
      lineas.map((l) => ({
        producto_id: l.producto_id,
        descripcion: l.descripcion.trim(),
        cantidad: aNumero(l.cantidad),
        unidad: l.unidad,
        precio_unitario: aNumero(l.precio_unitario),
        iva_rate: aplicaIva ? IVA_GENERAL : 0,
      })),
    [lineas, aplicaIva],
  );
  const totales = totalesPresupuesto(lineasCalculables, aNumero(envio));

  function cambiarLinea(i: number, cambio: Partial<LineaForm>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)));
  }

  function elegirProducto(i: number, valor: string) {
    if (valor === LIBRE) {
      cambiarLinea(i, { producto_id: null });
      return;
    }
    const p = productos.find((x) => x.id === valor);
    if (!p) return;
    cambiarLinea(i, {
      producto_id: p.id,
      descripcion: p.nombre,
      unidad: p.unidad,
      precio_unitario: aTexto(Number(p.precio_unitario)),
    });
  }

  const alta = useMutation({
    mutationFn: async () => {
      const validas = lineasCalculables.filter((l) => l.descripcion || l.precio_unitario > 0);
      if (validas.length === 0) throw new Error("Añade al menos una línea");
      if (validas.some((l) => !l.descripcion)) {
        throw new Error("Cada línea necesita una descripción");
      }
      if (validas.some((l) => l.cantidad <= 0)) {
        throw new Error("La cantidad de cada línea tiene que ser mayor que cero");
      }
      return guardar({
        data: {
          id: presupuesto?.id,
          tienda_id: tiendaId,
          cliente_id: clienteId,
          cliente_nombre: clienteNombre.trim(),
          cliente_email: clienteEmail.trim() || null,
          cliente_telefono: clienteTelefono.trim() || null,
          fecha,
          validez_dias: Math.round(aNumero(validez)),
          envio: aNumero(envio),
          notas: notas.trim() || null,
          lineas: validas,
        },
      });
    },
    onSuccess: () => {
      toast.success(presupuesto ? "Presupuesto actualizado" : "Presupuesto creado");
      onGuardado();
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido guardar"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {presupuesto ? `Presupuesto ${presupuesto.numero}` : "Nuevo presupuesto"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-1">
              <Label>Cliente</Label>
              <SelectorClienteTextil
                clientes={clientes}
                valor={clienteId}
                tiendaId={tiendaId}
                claveLista={["presupuesto-clientes"]}
                onElegir={(c) => {
                  setClienteId(c.id);
                  setClienteNombre(c.nombre);
                  setClienteEmail(c.email ?? "");
                  setClienteTelefono(c.telefono ?? "");
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} />
            </div>
            {!clienteId && (
              <div className="space-y-1 md:col-span-3">
                <Label>O escribe el nombre, sin ficha</Label>
                <Input
                  value={clienteNombre}
                  onChange={(e) => setClienteNombre(e.target.value)}
                  placeholder="Nombre del cliente"
                />
              </div>
            )}
          </div>

          <div className="grid gap-3 grid-cols-3">
            <div className="space-y-1">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Validez (días)</Label>
              <Input
                inputMode="numeric"
                value={validez}
                onChange={(e) => setValidez(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Envío sin IVA (€)</Label>
              <Input inputMode="decimal" value={envio} onChange={(e) => setEnvio(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Líneas
              </Label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={aplicaIva} onCheckedChange={(v) => setAplicaIva(v === true)} />
                Con IVA ({IVA_GENERAL} %)
              </label>
            </div>
            <div className="rounded-md border divide-y">
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 p-2 items-end">
                  <div className="col-span-12 md:col-span-3 space-y-1">
                    <Label className="text-xs">Producto</Label>
                    <Select
                      value={l.producto_id ?? LIBRE}
                      onValueChange={(v) => elegirProducto(i, v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={LIBRE}>Línea libre</SelectItem>
                        {productos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nombre}
                            <span className="text-muted-foreground text-xs ml-2">
                              {eur(Number(p.precio_unitario))}/{p.unidad}
                              {p.tienda_id === null ? " · general" : ""}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-12 md:col-span-4 space-y-1">
                    <Label className="text-xs">Descripción</Label>
                    <Input
                      value={l.descripcion}
                      onChange={(e) => cambiarLinea(i, { descripcion: e.target.value })}
                    />
                  </div>
                  <div className="col-span-3 md:col-span-1 space-y-1">
                    <Label className="text-xs">Cant.</Label>
                    <Input
                      inputMode="decimal"
                      value={l.cantidad}
                      onChange={(e) => cambiarLinea(i, { cantidad: e.target.value })}
                    />
                  </div>
                  <div className="col-span-3 md:col-span-1 space-y-1">
                    <Label className="text-xs">Unidad</Label>
                    <Input
                      value={l.unidad}
                      onChange={(e) => cambiarLinea(i, { unidad: e.target.value })}
                    />
                  </div>
                  <div className="col-span-3 md:col-span-1 space-y-1">
                    <Label className="text-xs">Precio</Label>
                    <Input
                      inputMode="decimal"
                      value={l.precio_unitario}
                      onChange={(e) => cambiarLinea(i, { precio_unitario: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1 text-right text-sm tabular-nums pb-2">
                    {eur(totales.lineas[i]?.subtotal ?? 0)}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar línea"
                      disabled={lineas.length === 1}
                      onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLineas((ls) => [...ls, LINEA_VACIA])}
            >
              <Plus className="h-4 w-4 mr-1" /> Añadir línea
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Notas</Label>
              <Textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
            <div className="rounded-md border p-3 text-sm space-y-1 self-start">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base imponible</span>
                <span className="tabular-nums">{eur(totales.subtotal)}</span>
              </div>
              {totales.envio > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>de ellos, envío</span>
                  <span className="tabular-nums">{eur(totales.envio)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">IVA</span>
                <span className="tabular-nums">{eur(totales.iva)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1">
                <span>Total</span>
                <span className="tabular-nums">{eur(totales.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => alta.mutate()} disabled={alta.isPending}>
            {alta.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
