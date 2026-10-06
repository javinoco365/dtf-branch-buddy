import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Search, Pencil, Ruler, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { eur } from "@/lib/format";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { tabla } from "@/lib/rpc";
import { useFiltrosUrl, useTextoDiferido } from "@/lib/filtros-url";

export type Producto = {
  id: string;
  /** NULL: producto genérico, disponible en todas las tiendas. */
  tienda_id: string | null;
  woo_product_id: number | null;
  sku: string | null;
  nombre: string;
  descripcion: string | null;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
  activo: boolean;
};

const UNIDADES = [
  { value: "m", label: "Metro lineal (DTF)" },
  { value: "m2", label: "Metro cuadrado" },
  { value: "ud", label: "Unidad" },
  { value: "kg", label: "Kilogramo" },
  { value: "l", label: "Litro" },
];

const empty = (tiendaId: string | null): Partial<Producto> => ({
  tienda_id: tiendaId,
  sku: "",
  nombre: "",
  descripcion: "",
  unidad: "m",
  precio_unitario: 0,
  iva_rate: 21,
  activo: true,
});

type Ambito = "todos" | "tienda" | "generales";

/**
 * El catálogo de productos.
 *
 * En una tienda (`tiendaId`) enseña los suyos y los genéricos, que son de la
 * empresa y salen en todas; un producto nuevo se puede crear para esta tienda
 * o para todas. Sin tienda, es la pantalla de los genéricos.
 *
 * Los que vienen de WooCommerce son siempre de su tienda: no pueden pasar a
 * genéricos, porque la sincronización los identifica por tienda.
 */
export function PantallaProductos({ tiendaId }: { tiendaId?: string }) {
  const qc = useQueryClient();
  // Los filtros viven en la dirección.
  const { valores: filtros, cambiar } = useFiltrosUrl({ q: "", tipo: "todos", ambito: "todos" });
  const [search, setSearch] = useTextoDiferido(filtros.q, (q) => cambiar({ q }));
  const filtro = filtros.tipo as "todos" | "dtf" | "otros" | "inactivos";
  const setFiltro = (tipo: string) => cambiar({ tipo });
  const ambito = filtros.ambito as Ambito;
  const setAmbito = (a: Ambito) => cambiar({ ambito: a });
  const [editing, setEditing] = useState<Partial<Producto> | null>(null);
  const [borrando, setBorrando] = useState<Producto | null>(null);

  const { data: productos = [] } = useQuery({
    queryKey: ["productos", tiendaId ?? "generales"],
    queryFn: async () => {
      const base = tabla(supabase, "productos").select("*").order("nombre");
      const { data, error } = await (tiendaId
        ? base.or(`tienda_id.eq.${tiendaId},tienda_id.is.null`)
        : base.is("tienda_id", null));
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });

  const filtered = useMemo(() => {
    const q = filtros.q.toLowerCase().trim();
    return productos.filter((p) => {
      if (filtro === "dtf" && p.unidad !== "m") return false;
      if (filtro === "otros" && p.unidad === "m") return false;
      if (filtro === "inactivos" ? p.activo : !p.activo) return false;
      if (ambito === "tienda" && p.tienda_id === null) return false;
      if (ambito === "generales" && p.tienda_id !== null) return false;
      if (!q) return true;
      return (
        p.nombre.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.descripcion ?? "").toLowerCase().includes(q)
      );
    });
  }, [productos, filtros.q, filtro, ambito]);

  const save = useMutation({
    mutationFn: async (p: Partial<Producto>) => {
      if (!p.nombre?.trim()) throw new Error("El nombre es obligatorio");
      // Uno de WooCommerce no cambia de tienda; los demás van donde se diga.
      const payload = {
        tienda_id: p.woo_product_id ? p.tienda_id : (p.tienda_id ?? null),
        sku: p.sku || null,
        nombre: p.nombre.trim(),
        descripcion: p.descripcion || null,
        unidad: p.unidad || "m",
        precio_unitario: Number(p.precio_unitario) || 0,
        iva_rate: Number(p.iva_rate) || 21,
        activo: p.activo ?? true,
      };
      if (p.id) {
        const { error } = await tabla(supabase, "productos").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await tabla(supabase, "productos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Producto guardado");
      qc.invalidateQueries({ queryKey: ["productos"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from("productos").update({ activo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["productos"] }),
  });

  // Las líneas de pedido y factura llevan producto_id ON DELETE SET NULL, y su
  // descripción y su precio están copiados en la línea: borrar el producto del
  // catálogo no cambia ni un importe de lo ya vendido.
  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("productos").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Producto borrado");
      qc.invalidateQueries({ queryKey: ["productos"] });
      setBorrando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {tiendaId ? "Catálogo" : "Productos generales"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tiendaId
              ? "Los productos de esta tienda y los generales, que salen en todas."
              : "Productos de la empresa, disponibles en todas las tiendas para pedidos y presupuestos."}
          </p>
        </div>
        <Button onClick={() => setEditing(empty(tiendaId ?? null))}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo producto
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar nombre, SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Activos · Todos</SelectItem>
            <SelectItem value="dtf">Activos · DTF (€/m)</SelectItem>
            <SelectItem value="otros">Activos · Otros</SelectItem>
            <SelectItem value="inactivos">Inactivos</SelectItem>
          </SelectContent>
        </Select>
        {tiendaId && (
          <Select value={ambito} onValueChange={(v) => setAmbito(v as Ambito)}>
            <SelectTrigger className="w-[200px]" aria-label="Ámbito">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">De la tienda y generales</SelectItem>
              <SelectItem value="tienda">Solo de esta tienda</SelectItem>
              <SelectItem value="generales">Solo generales</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-center">Activo</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const isDtf = p.unidad === "m";
                const unidadLabel = UNIDADES.find((u) => u.value === p.unidad)?.label ?? p.unidad;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {p.nombre}
                        {tiendaId && p.tienda_id === null && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            General
                          </Badge>
                        )}
                      </div>
                      {p.descripcion && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {p.descripcion}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isDtf ? "default" : "secondary"} className="gap-1">
                        {isDtf ? <Ruler className="h-3 w-3" /> : <Package className="h-3 w-3" />}
                        {unidadLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {eur(p.precio_unitario)}
                      <span className="text-xs text-muted-foreground">/{p.unidad}</span>
                    </TableCell>
                    <TableCell className="text-right">{p.iva_rate}%</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={p.activo}
                        onCheckedChange={(v) => toggleActivo.mutate({ id: p.id, activo: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        onClick={() => setEditing(p)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Borrar"
                        onClick={() => setBorrando(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Sin productos
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`el producto ${borrando?.nombre ?? ""}`}
        consecuencias={[
          "Los pedidos y facturas que lo llevan no cambian: la descripción y el precio " +
            "están copiados en cada línea.",
          "Si solo quieres dejar de venderlo, desactívalo con el interruptor.",
        ]}
        cargando={borrar.isPending}
        onConfirmar={() => borrando && borrar.mutate(borrando.id)}
      />

      {editing && (
        <ProductoForm
          tiendaId={tiendaId}
          producto={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing)}
          saving={save.isPending}
        />
      )}
    </div>
  );
}

function ProductoForm({
  tiendaId,
  producto,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  tiendaId?: string;
  producto: Partial<Producto>;
  onChange: (p: Partial<Producto>) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof Producto>(k: K, v: Producto[K]) => onChange({ ...producto, [k]: v });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{producto.id ? "Editar producto" : "Nuevo producto"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>SKU</Label>
            <Input value={producto.sku ?? ""} onChange={(e) => set("sku", e.target.value)} />
          </div>
          <div>
            <Label>Unidad</Label>
            <Select value={producto.unidad ?? "m"} onValueChange={(v) => set("unidad", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIDADES.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tiendaId && (
            <div className="col-span-2">
              <Label>Disponible en</Label>
              <Select
                value={producto.tienda_id ? "tienda" : "todas"}
                onValueChange={(v) => set("tienda_id", v === "tienda" ? tiendaId : null)}
                disabled={!!producto.woo_product_id}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tienda">Solo esta tienda</SelectItem>
                  <SelectItem value="todas">Todas las tiendas (general)</SelectItem>
                </SelectContent>
              </Select>
              {producto.woo_product_id ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Viene de WooCommerce: se queda en su tienda.
                </p>
              ) : null}
            </div>
          )}
          <div className="col-span-2">
            <Label>Nombre *</Label>
            <Input value={producto.nombre ?? ""} onChange={(e) => set("nombre", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Descripción</Label>
            <Textarea
              rows={2}
              value={producto.descripcion ?? ""}
              onChange={(e) => set("descripcion", e.target.value)}
            />
          </div>
          <div>
            <Label>Precio por {producto.unidad ?? "m"} (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={producto.precio_unitario ?? 0}
              onChange={(e) => set("precio_unitario", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>IVA (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={producto.iva_rate ?? 21}
              onChange={(e) => set("iva_rate", Number(e.target.value))}
            />
          </div>
          <div className="col-span-2 flex items-center justify-between pt-2 border-t">
            <div>
              <Label>Activo</Label>
              <p className="text-xs text-muted-foreground">Disponible para pedidos y facturas</p>
            </div>
            <Switch checked={producto.activo ?? true} onCheckedChange={(v) => set("activo", v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
