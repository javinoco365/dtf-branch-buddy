import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { Plus, Search, Pencil, Ruler, Package } from "lucide-react";
import { toast } from "sonner";
import { eur } from "@/lib/format";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/productos")({
  component: Productos,
});

type Producto = {
  id: string;
  tienda_id: string;
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

const empty = (tiendaId: string): Partial<Producto> => ({
  tienda_id: tiendaId,
  sku: "",
  nombre: "",
  descripcion: "",
  unidad: "m",
  precio_unitario: 0,
  iva_rate: 21,
  activo: true,
});

function Productos() {
  const { tiendaId } = Route.useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "dtf" | "otros" | "inactivos">("todos");
  const [editing, setEditing] = useState<Partial<Producto> | null>(null);

  const { data: productos = [] } = useQuery({
    queryKey: ["productos", tiendaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("productos")
        .select("*")
        .eq("tienda_id", tiendaId)
        .order("nombre");
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return productos.filter((p) => {
      if (filtro === "dtf" && p.unidad !== "m") return false;
      if (filtro === "otros" && p.unidad === "m") return false;
      if (filtro === "inactivos" ? p.activo : !p.activo) return false;
      if (!q) return true;
      return (
        p.nombre.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.descripcion ?? "").toLowerCase().includes(q)
      );
    });
  }, [productos, search, filtro]);

  const save = useMutation({
    mutationFn: async (p: Partial<Producto>) => {
      if (!p.nombre?.trim()) throw new Error("El nombre es obligatorio");
      const payload = {
        tienda_id: tiendaId,
        sku: p.sku || null,
        nombre: p.nombre.trim(),
        descripcion: p.descripcion || null,
        unidad: p.unidad || "m",
        precio_unitario: Number(p.precio_unitario) || 0,
        iva_rate: Number(p.iva_rate) || 21,
        activo: p.activo ?? true,
      };
      if (p.id) {
        const { error } = await supabase.from("productos").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("productos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Producto guardado");
      qc.invalidateQueries({ queryKey: ["productos", tiendaId] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.from("productos").update({ activo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["productos", tiendaId] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Productos DTF por metros y otros consumibles vendibles.
          </p>
        </div>
        <Button onClick={() => setEditing(empty(tiendaId))}>
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
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
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
                      <div className="font-medium">{p.nombre}</div>
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
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        <Pencil className="h-3.5 w-3.5" />
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

      {editing && (
        <ProductoForm
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
  producto,
  onChange,
  onClose,
  onSave,
  saving,
}: {
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
