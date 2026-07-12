import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import {
  listPresupuestos, upsertPresupuesto, deletePresupuesto, updatePresupuestoEstado,
  convertirPresupuestoEnFactura, listMarcas, listTextilClientes, getEmpresaGlobal, listStock,
} from "@/lib/textil.functions";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { LineasEditor, type Linea } from "@/components/textil/LineasEditor";

export const Route = createFileRoute("/panel/textil/presupuestos")({
  head: () => ({ meta: [{ title: "Presupuestos textil · CRM DTF" }] }),
  component: PresupuestosPage,
});

const ESTADOS = ["borrador", "enviado", "aceptado", "rechazado", "facturado"] as const;
const ESTADO_COLOR: Record<string, string> = {
  borrador: "bg-muted text-muted-foreground",
  enviado: "bg-blue-500/10 text-blue-700",
  aceptado: "bg-green-500/10 text-green-700",
  rechazado: "bg-red-500/10 text-red-700",
  facturado: "bg-primary/10 text-primary",
};

function PresupuestosPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPresupuestos);
  const upsertFn = useServerFn(upsertPresupuesto);
  const delFn = useServerFn(deletePresupuesto);
  const estFn = useServerFn(updatePresupuestoEstado);
  const convFn = useServerFn(convertirPresupuestoEnFactura);
  const marcasFn = useServerFn(listMarcas);
  const cliFn = useServerFn(listTextilClientes);
  const empFn = useServerFn(getEmpresaGlobal);
  const stockFn = useServerFn(listStock);

  const { data = [] } = useQuery({ queryKey: ["textil-presupuestos"], queryFn: () => listFn() });
  const { data: marcas = [] } = useQuery({ queryKey: ["textil-marcas"], queryFn: () => marcasFn() });
  const { data: clientes = [] } = useQuery({ queryKey: ["textil-clientes"], queryFn: () => cliFn() });
  const { data: empresa } = useQuery({ queryKey: ["empresa-global"], queryFn: () => empFn() });
  const { data: stock = [] } = useQuery({ queryKey: ["textil-stock"], queryFn: () => stockFn() });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["textil-presupuestos"] });
    qc.invalidateQueries({ queryKey: ["textil-facturas"] });
  };

  const save = useMutation({
    mutationFn: (d: any) => upsertFn({ data: d }),
    onSuccess: () => { invalidate(); toast.success("Guardado"); setOpen(false); setEditing(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Eliminado"); },
  });
  const setEst = useMutation({
    mutationFn: ({ id, estado }: any) => estFn({ data: { id, estado } }),
    onSuccess: () => invalidate(),
  });
  const conv = useMutation({
    mutationFn: (id: string) => convFn({ data: { id } }),
    onSuccess: (r: any) => { invalidate(); toast.success(`Factura ${r.numero} creada`); },
    onError: (e: any) => toast.error(e.message),
  });

  const defaultMarcaId = (empresa as any)?.textil_marca_predeterminada_id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Presupuestos</h1>
          <p className="text-sm text-muted-foreground">Crea presupuestos y conviértelos en facturas con un clic.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo presupuesto
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nº</TableHead><TableHead>Fecha</TableHead><TableHead>Cliente</TableHead>
              <TableHead>Marca</TableHead><TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin presupuestos.</TableCell></TableRow>}
              {data.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                  <TableCell>{fechaCorta(p.fecha)}</TableCell>
                  <TableCell>{p.cliente_nombre ?? "—"}</TableCell>
                  <TableCell>
                    {p.marca ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="h-2 w-2 rounded-full" style={{ background: p.marca.color ?? "#3b82f6" }} />
                        {p.marca.nombre}
                      </span>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell>
                    <Select value={p.estado} onValueChange={(v) => setEst.mutate({ id: p.id, estado: v })} disabled={p.estado === "facturado"}>
                      <SelectTrigger className={`h-7 w-32 text-xs ${ESTADO_COLOR[p.estado] ?? ""}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ESTADOS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right font-medium">{eur(Number(p.total))}</TableCell>
                  <TableCell className="text-right">
                    {p.estado !== "facturado" && (
                      <Button variant="ghost" size="icon" title="Convertir en factura" onClick={() => { if (confirm("¿Convertir este presupuesto en factura?")) conv.mutate(p.id); }}>
                        <FileText className="h-4 w-4 text-primary" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("¿Eliminar?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <PresupuestoDialog
          open={open}
          onOpenChange={setOpen}
          presupuesto={editing}
          clientes={clientes}
          marcas={marcas}
          stock={stock}
          defaultMarcaId={defaultMarcaId}
          onSave={(v: any) => save.mutate(v)}
          loading={save.isPending}
        />
      )}
    </div>
  );
}

function PresupuestoDialog({ open, onOpenChange, presupuesto, clientes, marcas, stock, defaultMarcaId, onSave, loading }: any) {
  const initial = presupuesto ?? {
    fecha: new Date().toISOString().slice(0, 10),
    validez_dias: 30,
    marca_id: defaultMarcaId,
    items: [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_pct: 21 }],
  };
  const [f, setF] = useState<any>({
    ...initial,
    items: (initial.items ?? []).map((it: any) => ({
      descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), iva_pct: Number(it.iva_pct), stock_id: it.stock_id ?? null,
    })),
  });

  const setCliente = (id: string) => {
    const c = clientes.find((x: any) => x.id === id);
    setF({ ...f, cliente_id: id, cliente_nombre: c?.nombre, cliente_email: c?.email, cliente_nif: c?.nif, cliente_direccion: c?.direccion });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{presupuesto ? `Editar ${presupuesto.numero}` : "Nuevo presupuesto"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Cliente</Label>
              <Select value={f.cliente_id ?? ""} onValueChange={setCliente}>
                <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {clientes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Marca comercial</Label>
              <Select value={f.marca_id ?? "__none__"} onValueChange={(v) => setF({ ...f, marca_id: v === "__none__" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguna</SelectItem>
                  {marcas.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha</Label>
              <Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
            </div>
            <div>
              <Label>Nombre cliente</Label>
              <Input value={f.cliente_nombre ?? ""} onChange={(e) => setF({ ...f, cliente_nombre: e.target.value })} />
            </div>
            <div>
              <Label>NIF</Label>
              <Input value={f.cliente_nif ?? ""} onChange={(e) => setF({ ...f, cliente_nif: e.target.value })} />
            </div>
            <div>
              <Label>Validez (días)</Label>
              <Input type="number" value={f.validez_dias} onChange={(e) => setF({ ...f, validez_dias: Number(e.target.value) })} />
            </div>
          </div>
          <LineasEditor stock={stock} items={f.items} onChange={(items: Linea[]) => setF({ ...f, items })} />
          <div>
            <Label>Notas</Label>
            <Textarea value={f.notas ?? ""} onChange={(e) => setF({ ...f, notas: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={loading || f.items.length === 0} onClick={() => onSave({
            id: presupuesto?.id,
            cliente_id: f.cliente_id || null,
            cliente_nombre: f.cliente_nombre || null,
            cliente_email: f.cliente_email || null,
            cliente_nif: f.cliente_nif || null,
            cliente_direccion: f.cliente_direccion || null,
            marca_id: f.marca_id || null,
            fecha: f.fecha,
            validez_dias: Number(f.validez_dias) || 30,
            notas: f.notas || null,
            items: f.items,
          })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { PresupuestoDialog as _unused };
// keep Badge import used
void Badge;