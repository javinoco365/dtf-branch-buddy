import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Calendar as CalendarIcon, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Proyecto = {
  id: string;
  tienda_id: string | null;
  nombre: string;
  descripcion: string | null;
  cliente_nombre: string | null;
  fecha_prevista: string | null;
  estado: "planificado" | "en_curso" | "completado" | "cancelado";
  prioridad: "baja" | "media" | "alta";
  notas: string | null;
  tiendas?: { nombre: string; color: string | null } | null;
};

const ESTADOS: { value: Proyecto["estado"]; label: string }[] = [
  { value: "planificado", label: "Planificado" },
  { value: "en_curso", label: "En curso" },
  { value: "completado", label: "Completado" },
  { value: "cancelado", label: "Cancelado" },
];

const PRIORIDADES: { value: Proyecto["prioridad"]; label: string }[] = [
  { value: "baja", label: "Baja" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" },
];

const estadoColor: Record<Proyecto["estado"], string> = {
  planificado: "bg-muted text-muted-foreground",
  en_curso: "bg-primary/15 text-primary",
  completado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelado: "bg-destructive/15 text-destructive",
};

const prioridadColor: Record<Proyecto["prioridad"], string> = {
  baja: "bg-muted text-muted-foreground",
  media: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  alta: "bg-destructive/15 text-destructive",
};

function empty(tiendaId: string | null): Partial<Proyecto> {
  return {
    tienda_id: tiendaId,
    nombre: "",
    descripcion: "",
    cliente_nombre: "",
    fecha_prevista: "",
    estado: "planificado",
    prioridad: "media",
    notas: "",
  };
}

export function ProyectosBoard({
  tiendaId,
  showTienda = false,
}: {
  tiendaId?: string;
  showTienda?: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Proyecto> | null>(null);
  const queryKey = ["proyectos", tiendaId ?? "global"];

  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas-min"],
    enabled: !tiendaId,
    queryFn: async () => {
      const { data } = await supabase.from("tiendas").select("id, nombre").order("nombre");
      return data ?? [];
    },
  });

  const { data: proyectos = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from("proyectos")
        .select("*, tiendas(nombre, color)")
        .order("fecha_prevista", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (tiendaId) q = q.eq("tienda_id", tiendaId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Proyecto[];
    },
  });

  const grouped = useMemo(() => {
    const g: Record<Proyecto["estado"], Proyecto[]> = {
      planificado: [],
      en_curso: [],
      completado: [],
      cancelado: [],
    };
    for (const p of proyectos) g[p.estado].push(p);
    return g;
  }, [proyectos]);

  const save = useMutation({
    mutationFn: async (p: Partial<Proyecto>) => {
      if (!p.nombre?.trim()) throw new Error("El nombre es obligatorio");
      const payload = {
        tienda_id: p.tienda_id || null,
        nombre: p.nombre.trim(),
        descripcion: p.descripcion || null,
        cliente_nombre: p.cliente_nombre || null,
        fecha_prevista: p.fecha_prevista || null,
        estado: p.estado ?? "planificado",
        prioridad: p.prioridad ?? "media",
        notas: p.notas || null,
      };
      if (p.id) {
        const { error } = await supabase.from("proyectos").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("proyectos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Proyecto guardado");
      qc.invalidateQueries({ queryKey });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proyectos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proyecto eliminado");
      qc.invalidateQueries({ queryKey });
      setEditing(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Próximos Proyectos</h1>
          <p className="text-sm text-muted-foreground">
            Planificación de pedidos y trabajos futuros.
          </p>
        </div>
        <Button onClick={() => setEditing(empty(tiendaId ?? null))}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo proyecto
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {ESTADOS.map((e) => (
          <Column
            key={e.value}
            label={e.label}
            estado={e.value}
            proyectos={grouped[e.value]}
            onEdit={setEditing}
            showTienda={showTienda}
          />
        ))}
      </div>

      {editing && (
        <ProyectoForm
          proyecto={editing}
          tiendas={tiendas as { id: string; nombre: string }[]}
          lockTienda={!!tiendaId}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing)}
          onDelete={editing.id ? () => remove.mutate(editing.id!) : undefined}
          saving={save.isPending}
        />
      )}
    </div>
  );
}

function Column({
  label,
  estado,
  proyectos,
  onEdit,
  showTienda,
}: {
  label: string;
  estado: Proyecto["estado"];
  proyectos: Proyecto[];
  onEdit: (p: Proyecto) => void;
  showTienda: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        <Badge variant="outline" className={estadoColor[estado]}>
          {proyectos.length}
        </Badge>
      </div>
      <div className="space-y-2 min-h-[60px]">
        {proyectos.map((p) => (
          <ProyectoCard key={p.id} proyecto={p} onEdit={() => onEdit(p)} showTienda={showTienda} />
        ))}
        {proyectos.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6 border border-dashed rounded-lg">
            Sin proyectos
          </div>
        )}
      </div>
    </div>
  );
}

function ProyectoCard({
  proyecto,
  onEdit,
  showTienda,
}: {
  proyecto: Proyecto;
  onEdit: () => void;
  showTienda: boolean;
}) {
  const vencido =
    proyecto.fecha_prevista &&
    proyecto.estado !== "completado" &&
    proyecto.estado !== "cancelado" &&
    new Date(proyecto.fecha_prevista) < new Date(new Date().toDateString());

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onEdit}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-sm leading-tight">{proyecto.nombre}</div>
          <Badge variant="outline" className={prioridadColor[proyecto.prioridad]}>
            {proyecto.prioridad}
          </Badge>
        </div>
        {proyecto.cliente_nombre && (
          <div className="text-xs text-muted-foreground">{proyecto.cliente_nombre}</div>
        )}
        {proyecto.descripcion && (
          <p className="text-xs text-muted-foreground line-clamp-2">{proyecto.descripcion}</p>
        )}
        <div className="flex items-center justify-between text-xs">
          {proyecto.fecha_prevista ? (
            <span
              className={`flex items-center gap-1 ${vencido ? "text-destructive font-medium" : "text-muted-foreground"}`}
            >
              {vencido ? <AlertTriangle className="h-3 w-3" /> : <CalendarIcon className="h-3 w-3" />}
              {new Date(proyecto.fecha_prevista).toLocaleDateString("es-ES")}
            </span>
          ) : (
            <span className="text-muted-foreground">Sin fecha</span>
          )}
          {showTienda && proyecto.tiendas && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: proyecto.tiendas.color ?? "var(--muted-foreground)" }}
              />
              {proyecto.tiendas.nombre}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProyectoForm({
  proyecto,
  tiendas,
  lockTienda,
  onChange,
  onClose,
  onSave,
  onDelete,
  saving,
}: {
  proyecto: Partial<Proyecto>;
  tiendas: { id: string; nombre: string }[];
  lockTienda: boolean;
  onChange: (p: Partial<Proyecto>) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof Proyecto>(k: K, v: Proyecto[K]) =>
    onChange({ ...proyecto, [k]: v });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{proyecto.id ? "Editar proyecto" : "Nuevo proyecto"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Nombre *</Label>
            <Input value={proyecto.nombre ?? ""} onChange={(e) => set("nombre", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Descripción</Label>
            <Textarea
              rows={2}
              value={proyecto.descripcion ?? ""}
              onChange={(e) => set("descripcion", e.target.value)}
            />
          </div>
          <div>
            <Label>Cliente</Label>
            <Input
              value={proyecto.cliente_nombre ?? ""}
              onChange={(e) => set("cliente_nombre", e.target.value)}
            />
          </div>
          <div>
            <Label>Fecha prevista</Label>
            <Input
              type="date"
              value={proyecto.fecha_prevista ?? ""}
              onChange={(e) => set("fecha_prevista", e.target.value)}
            />
          </div>
          <div>
            <Label>Estado</Label>
            <Select
              value={proyecto.estado ?? "planificado"}
              onValueChange={(v) => set("estado", v as Proyecto["estado"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ESTADOS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Prioridad</Label>
            <Select
              value={proyecto.prioridad ?? "media"}
              onValueChange={(v) => set("prioridad", v as Proyecto["prioridad"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORIDADES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!lockTienda && (
            <div className="col-span-2">
              <Label>Tienda</Label>
              <Select
                value={proyecto.tienda_id ?? "global"}
                onValueChange={(v) => set("tienda_id", v === "global" ? null : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Sin tienda (global)</SelectItem>
                  {tiendas.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2">
            <Label>Notas</Label>
            <Textarea
              rows={3}
              value={proyecto.notas ?? ""}
              onChange={(e) => set("notas", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {onDelete ? (
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-1" />
              Eliminar
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// avoid unused-warning when component used without Pencil
export const _PencilUsed = Pencil;