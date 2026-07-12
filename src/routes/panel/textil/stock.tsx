import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { listStock, upsertStockItem, deleteStockItem } from "@/lib/textil.functions";
import { toast } from "sonner";
import { fmtEUR } from "@/lib/format";

export const Route = createFileRoute("/panel/textil/stock")({
  head: () => ({ meta: [{ title: "Stock textil · CRM DTF" }] }),
  component: StockPage,
});

type Item = any;

function StockPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listStock);
  const upsertFn = useServerFn(upsertStockItem);
  const delFn = useServerFn(deleteStockItem);
  const { data = [], isLoading } = useQuery({ queryKey: ["textil-stock"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const upsert = useMutation({
    mutationFn: (d: any) => upsertFn({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      toast.success("Guardado");
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      toast.success("Eliminado");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stock textil</h1>
          <p className="text-sm text-muted-foreground">Inventario de camisetas, sudaderas y demás prendas.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo artículo
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Cat.</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Talla</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Mín.</TableHead>
                <TableHead className="text-right">Coste</TableHead>
                <TableHead className="text-right">PVP</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={10}>Cargando…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Sin artículos.</TableCell></TableRow>
              )}
              {data.map((it: any) => {
                const bajo = Number(it.cantidad) <= Number(it.cantidad_minima);
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.sku ?? "—"}</TableCell>
                    <TableCell className="font-medium">{it.nombre}</TableCell>
                    <TableCell>{it.categoria ?? "—"}</TableCell>
                    <TableCell>{it.color ?? "—"}</TableCell>
                    <TableCell>{it.talla ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {bajo ? <Badge variant="destructive">{it.cantidad}</Badge> : it.cantidad}
                    </TableCell>
                    <TableCell className="text-right">{it.cantidad_minima}</TableCell>
                    <TableCell className="text-right">{fmtEUR(Number(it.coste_unitario))}</TableCell>
                    <TableCell className="text-right">{fmtEUR(Number(it.precio_venta))}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(it); setOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("¿Eliminar?")) del.mutate(it.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <StockDialog
        open={open}
        onOpenChange={setOpen}
        item={editing}
        onSave={(v) => upsert.mutate(v)}
        loading={upsert.isPending}
      />
    </div>
  );
}

function StockDialog({ open, onOpenChange, item, onSave, loading }: any) {
  const [f, setF] = useState<any>(() => item ?? { nombre: "", cantidad: 0, cantidad_minima: 0, coste_unitario: 0, precio_venta: 0 });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setF(item ?? { nombre: "", cantidad: 0, cantidad_minima: 0, coste_unitario: 0, precio_venta: 0 }); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Editar artículo" : "Nuevo artículo"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>SKU</Label><Input value={f.sku ?? ""} onChange={(e) => setF({ ...f, sku: e.target.value })} /></div>
          <div><Label>Categoría</Label><Input value={f.categoria ?? ""} onChange={(e) => setF({ ...f, categoria: e.target.value })} /></div>
          <div className="col-span-2"><Label>Nombre *</Label><Input value={f.nombre ?? ""} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div><Label>Color</Label><Input value={f.color ?? ""} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
          <div><Label>Talla</Label><Input value={f.talla ?? ""} onChange={(e) => setF({ ...f, talla: e.target.value })} /></div>
          <div><Label>Cantidad</Label><Input type="number" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: Number(e.target.value) })} /></div>
          <div><Label>Cantidad mínima</Label><Input type="number" value={f.cantidad_minima} onChange={(e) => setF({ ...f, cantidad_minima: Number(e.target.value) })} /></div>
          <div><Label>Coste unitario</Label><Input type="number" step="0.01" value={f.coste_unitario} onChange={(e) => setF({ ...f, coste_unitario: Number(e.target.value) })} /></div>
          <div><Label>Precio venta</Label><Input type="number" step="0.01" value={f.precio_venta} onChange={(e) => setF({ ...f, precio_venta: Number(e.target.value) })} /></div>
          <div className="col-span-2"><Label>Notas</Label><Textarea value={f.notas ?? ""} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={loading || !f.nombre} onClick={() => onSave({
            id: item?.id,
            sku: f.sku || null,
            nombre: f.nombre,
            categoria: f.categoria || null,
            color: f.color || null,
            talla: f.talla || null,
            cantidad: Number(f.cantidad) || 0,
            cantidad_minima: Number(f.cantidad_minima) || 0,
            coste_unitario: Number(f.coste_unitario) || 0,
            precio_venta: Number(f.precio_venta) || 0,
            notas: f.notas || null,
          })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}