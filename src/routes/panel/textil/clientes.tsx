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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { listTextilClientes, upsertTextilCliente, deleteTextilCliente } from "@/lib/textil.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/panel/textil/clientes")({
  head: () => ({ meta: [{ title: "Clientes textil · CRM DTF" }] }),
  component: ClientesPage,
});

function ClientesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTextilClientes);
  const upsertFn = useServerFn(upsertTextilCliente);
  const delFn = useServerFn(deleteTextilCliente);
  const { data = [] } = useQuery({ queryKey: ["textil-clientes"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const save = useMutation({
    mutationFn: (d: any) => upsertFn({ data: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["textil-clientes"] }); toast.success("Guardado"); setOpen(false); setEditing(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["textil-clientes"] }); toast.success("Eliminado"); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes textil</h1>
          <p className="text-sm text-muted-foreground">Base de clientes propia del módulo textil.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo cliente
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nombre</TableHead><TableHead>Email</TableHead><TableHead>Teléfono</TableHead><TableHead>NIF</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sin clientes.</TableCell></TableRow>}
              {data.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell>{c.email ?? "—"}</TableCell>
                  <TableCell>{c.telefono ?? "—"}</TableCell>
                  <TableCell>{c.nif ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("¿Eliminar?")) del.mutate(c.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ClienteDialog open={open} onOpenChange={setOpen} cliente={editing} onSave={(v: any) => save.mutate(v)} loading={save.isPending} />
    </div>
  );
}

function ClienteDialog({ open, onOpenChange, cliente, onSave, loading }: any) {
  const [f, setF] = useState<any>(cliente ?? { nombre: "" });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setF(cliente ?? { nombre: "" }); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{cliente ? "Editar cliente" : "Nuevo cliente"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Nombre *</Label><Input value={f.nombre ?? ""} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div><Label>Email</Label><Input value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Teléfono</Label><Input value={f.telefono ?? ""} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
          <div className="col-span-2"><Label>Dirección</Label><Input value={f.direccion ?? ""} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
          <div><Label>NIF</Label><Input value={f.nif ?? ""} onChange={(e) => setF({ ...f, nif: e.target.value })} /></div>
          <div className="col-span-2"><Label>Notas</Label><Textarea value={f.notas ?? ""} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={loading || !f.nombre} onClick={() => onSave({
            id: cliente?.id,
            nombre: f.nombre,
            email: f.email || null,
            telefono: f.telefono || null,
            direccion: f.direccion || null,
            nif: f.nif || null,
            notas: f.notas || null,
          })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}