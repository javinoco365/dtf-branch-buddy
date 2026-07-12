import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Star } from "lucide-react";
import {
  listMarcas, upsertMarca, deleteMarca, setMarcaPredeterminada, getEmpresaGlobal,
} from "@/lib/textil.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/panel/textil/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes textil · CRM DTF" }] }),
  component: AjustesPage,
});

function AjustesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMarcas);
  const upsertFn = useServerFn(upsertMarca);
  const delFn = useServerFn(deleteMarca);
  const setDefFn = useServerFn(setMarcaPredeterminada);
  const empFn = useServerFn(getEmpresaGlobal);
  const { data: marcas = [] } = useQuery({ queryKey: ["textil-marcas"], queryFn: () => listFn() });
  const { data: empresa } = useQuery({ queryKey: ["empresa-global"], queryFn: () => empFn() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const save = useMutation({
    mutationFn: (d: any) => upsertFn({ data: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["textil-marcas"] }); toast.success("Guardado"); setOpen(false); setEditing(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["textil-marcas"] }); toast.success("Eliminada"); },
  });
  const setDef = useMutation({
    mutationFn: (id: string | null) => setDefFn({ data: { marca_id: id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["empresa-global"] }); toast.success("Marca por defecto actualizada"); },
  });

  const defaultId = (empresa as any)?.textil_marca_predeterminada_id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ajustes de Textil</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona las marcas comerciales que puedes usar en presupuestos y facturas. Los datos fiscales (SL) siguen siendo únicos.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Marca predeterminada</div>
              <div className="text-xs text-muted-foreground">Se sugerirá al crear nuevos presupuestos/facturas.</div>
            </div>
            <div className="w-64">
              <Select value={defaultId ?? "__none__"} onValueChange={(v) => setDef.mutate(v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Ninguna" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguna</SelectItem>
                  {marcas.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Marcas comerciales</h2>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nueva marca
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {marcas.length === 0 && <div className="text-muted-foreground text-sm">No hay marcas creadas.</div>}
        {marcas.map((m: any) => (
          <Card key={m.id} className={defaultId === m.id ? "border-primary" : ""}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full" style={{ background: m.color ?? "#3b82f6" }} />
                  <div className="font-semibold">{m.nombre}</div>
                  {defaultId === m.id && <Badge variant="secondary"><Star className="h-3 w-3 mr-1" />Por defecto</Badge>}
                  {!m.activa && <Badge variant="outline">Inactiva</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(m); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`¿Eliminar ${m.nombre}?`)) del.mutate(m.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
              {m.direccion && <div className="text-xs text-muted-foreground">{m.direccion}</div>}
              {(m.email || m.telefono) && <div className="text-xs text-muted-foreground">{[m.email, m.telefono].filter(Boolean).join(" · ")}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <MarcaDialog open={open} onOpenChange={setOpen} marca={editing} onSave={(v: any) => save.mutate(v)} loading={save.isPending} />
    </div>
  );
}

function MarcaDialog({ open, onOpenChange, marca, onSave, loading }: any) {
  const [f, setF] = useState<any>(marca ?? { nombre: "", color: "#3b82f6", activa: true });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setF(marca ?? { nombre: "", color: "#3b82f6", activa: true }); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{marca ? "Editar marca" : "Nueva marca comercial"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Nombre *</Label><Input value={f.nombre ?? ""} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div><Label>Color</Label><Input type="color" value={f.color ?? "#3b82f6"} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
          <div><Label>Logo (URL)</Label><Input value={f.logo_url ?? ""} onChange={(e) => setF({ ...f, logo_url: e.target.value })} /></div>
          <div className="col-span-2"><Label>Dirección</Label><Input value={f.direccion ?? ""} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
          <div><Label>Email</Label><Input value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Teléfono</Label><Input value={f.telefono ?? ""} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
          <div className="col-span-2"><Label>Notas</Label><Textarea value={f.notas ?? ""} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
          <div className="col-span-2 flex items-center gap-2"><Switch checked={f.activa !== false} onCheckedChange={(v) => setF({ ...f, activa: v })} /><Label>Activa</Label></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={loading || !f.nombre} onClick={() => onSave({
            id: marca?.id,
            nombre: f.nombre,
            color: f.color || null,
            logo_url: f.logo_url || null,
            direccion: f.direccion || null,
            email: f.email || null,
            telefono: f.telefono || null,
            notas: f.notas || null,
            activa: f.activa !== false,
          })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}