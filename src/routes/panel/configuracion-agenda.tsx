import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { nombreCategoriaRepetido, type CategoriaAgenda } from "@/dominio/agenda";
import {
  crearCategoriaAgenda,
  editarCategoriaAgenda,
  ordenarCategoriasAgenda,
} from "@/lib/agenda.functions";
import { avisarError, mensajeDeError } from "@/lib/errores";
import { useAgenda } from "@/hooks/use-agenda";
import { usePermisos } from "@/hooks/use-permisos";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EstadoVacio } from "@/components/EstadoVacio";
import { iconoDeCategoria } from "@/components/agenda/estilos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/panel/configuracion-agenda")({
  head: () => ({ meta: [{ title: "Agenda · Ajustes · DTF Culture" }] }),
  component: ConfiguracionAgenda,
});

const TEXTO_ENLACE = { pedido: "Pide un pedido", cliente: "Pide un cliente" } as const;

function ConfiguracionAgenda() {
  const { data, isLoading, error } = useAgenda();
  const { escribir } = usePermisos();
  const categorias = data?.categorias ?? [];
  const usos = (id: string) => (data?.tareas ?? []).filter((t) => t.categoriaId === id).length;

  const ordenar = useServerFn(ordenarCategoriasAgenda);
  const mover = useMutation({
    mutationFn: (ids: string[]) => ordenar({ data: { ids } }),
    onError: (e: Error) => avisarError(e, "No se ha podido cambiar el orden"),
  });
  const moverA = (i: number, j: number) => {
    const ids = categorias.map((c) => c.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    mover.mutate(ids);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Link
        to="/panel/configuracion"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Ajustes
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{mensajeDeError(error)}</p>
      ) : data?.falta_migracion ? (
        <EstadoVacio
          icono={CalendarDays}
          titulo="La Agenda todavía no está en la base"
          descripcion="Falta aplicar la migración 20261116100000_agenda."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" /> Categorías de tareas
            </CardTitle>
            <CardDescription>
              Salen al crear una tarea, en este orden. Una categoría no se borra: se desactiva y
              deja de salir en el formulario, y sus tareas se conservan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 px-0 sm:px-6">
            {categorias.length === 0 && (
              <p className="px-4 pb-2 text-sm text-muted-foreground sm:px-0">
                Todavía no hay categorías. Añade la primera aquí debajo.
              </p>
            )}
            <ul
              className={cn(
                "divide-y border-y sm:rounded-md sm:border",
                categorias.length === 0 && "hidden",
              )}
            >
              {categorias.map((c, i) => (
                <Fila
                  key={c.id}
                  categoria={c}
                  categorias={categorias}
                  usos={usos(c.id)}
                  puedeEscribir={escribir}
                  primera={i === 0}
                  ultima={i === categorias.length - 1}
                  ocupado={mover.isPending}
                  onSubir={() => moverA(i, i - 1)}
                  onBajar={() => moverA(i, i + 1)}
                />
              ))}
            </ul>
            {escribir && <Nueva categorias={categorias} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Fila({
  categoria: c,
  categorias,
  usos,
  puedeEscribir,
  primera,
  ultima,
  ocupado,
  onSubir,
  onBajar,
}: {
  categoria: CategoriaAgenda;
  categorias: CategoriaAgenda[];
  usos: number;
  puedeEscribir: boolean;
  primera: boolean;
  ultima: boolean;
  ocupado: boolean;
  onSubir: () => void;
  onBajar: () => void;
}) {
  const editar = useServerFn(editarCategoriaAgenda);
  const [nombre, setNombre] = useState(c.nombre);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const Icono = iconoDeCategoria(c);

  const guardar = useMutation({
    mutationFn: (v: { nombre?: string; activa?: boolean }) => editar({ data: { id: c.id, ...v } }),
    onSuccess: (_r, v) => {
      if (v.nombre) toast.success("Categoría renombrada");
      else if (v.activa !== undefined)
        toast.success(
          v.activa
            ? `«${c.nombre}» vuelve a salir al crear tareas`
            : `«${c.nombre}» ya no sale al crear tareas. Sus tareas se conservan.`,
        );
    },
    onError: (e: Error) => {
      setNombre(c.nombre);
      avisarError(e, "No se ha podido guardar");
    },
  });

  function renombrar() {
    const n = nombre.trim();
    if (n === c.nombre) return setAviso(null);
    if (!n) return setAviso("El nombre no puede quedar vacío.");
    if (n.length > 40) return setAviso("Como mucho 40 caracteres.");
    if (nombreCategoriaRepetido(n, categorias, c.id)) {
      return setAviso(`Ya hay una categoría «${n}». Elige otro nombre.`);
    }
    setAviso(null);
    guardar.mutate({ nombre: n });
  }

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[auto_auto_minmax(0,1fr)_170px_auto]">
      <div className="row-span-2 flex flex-col gap-0.5 sm:row-span-1 sm:flex-row">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-8 sm:w-8"
          disabled={!puedeEscribir || primera || ocupado}
          onClick={onSubir}
          aria-label={`Subir ${c.nombre}`}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-8 sm:w-8"
          disabled={!puedeEscribir || ultima || ocupado}
          onClick={onBajar}
          aria-label={`Bajar ${c.nombre}`}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>
      <Icono className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
      <div className="min-w-0">
        <div className="relative">
          <Label htmlFor={`cat-${c.id}`} className="sr-only">
            Nombre de la categoría
          </Label>
          <Input
            id={`cat-${c.id}`}
            value={nombre}
            disabled={!puedeEscribir}
            maxLength={40}
            onChange={(e) => setNombre(e.target.value)}
            onBlur={renombrar}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setNombre(c.nombre);
                setAviso(null);
              }
            }}
            aria-invalid={!!aviso}
            aria-describedby={aviso ? `cat-err-${c.id}` : undefined}
            className={cn(
              "h-9 pr-8 font-medium",
              !c.activa && "text-muted-foreground line-through",
            )}
          />
          <Pencil
            className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        {aviso && (
          <p id={`cat-err-${c.id}`} className="mt-1 text-sm text-destructive">
            {aviso}
          </p>
        )}
      </div>
      <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto">
        {c.enlace ? (
          <b className="font-semibold text-secondary-foreground">{TEXTO_ENLACE[c.enlace]}</b>
        ) : (
          "Sin enlace"
        )}
        {" · "}
        {usos === 0 ? "sin tareas" : `${usos} ${usos === 1 ? "tarea" : "tareas"}`}
      </span>
      <label className="col-start-3 row-start-1 flex items-center gap-2 text-sm sm:col-start-auto sm:row-start-auto">
        <Switch
          checked={c.activa}
          disabled={!puedeEscribir || guardar.isPending}
          onCheckedChange={(v) =>
            !v && c.enlace ? setConfirmar(true) : guardar.mutate({ activa: v })
          }
          aria-label={c.activa ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`}
        />
        <span className="hidden sm:inline">
          {c.activa ? "Activa" : <Badge variant="outline">Desactivada</Badge>}
        </span>
      </label>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar «{c.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Es la que enlaza tareas con {c.enlace === "pedido" ? "pedidos" : "clientes"}. Sin ella
              no se podrán crear tareas de {c.enlace === "pedido" ? "un pedido" : "un cliente"}. Las
              que ya hay se conservan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction onClick={() => guardar.mutate({ activa: false })}>
              Sí, desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function Nueva({ categorias }: { categorias: CategoriaAgenda[] }) {
  const crear = useServerFn(crearCategoriaAgenda);
  const [nombre, setNombre] = useState("");
  const [enlace, setEnlace] = useState<"nada" | "pedido" | "cliente">("nada");
  const [aviso, setAviso] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      crear({ data: { nombre: nombre.trim(), enlace: enlace === "nada" ? null : enlace } }),
    onSuccess: () => {
      toast.success(`Categoría «${nombre.trim()}» añadida`);
      setNombre("");
      setEnlace("nada");
    },
    onError: (e: Error) => avisarError(e, "No se ha podido añadir la categoría"),
  });

  function anadir(e: React.FormEvent) {
    e.preventDefault();
    const n = nombre.trim();
    if (!n) return setAviso("Escribe el nombre.");
    if (nombreCategoriaRepetido(n, categorias)) return setAviso(`Ya hay una categoría «${n}».`);
    setAviso(null);
    m.mutate();
  }

  return (
    <form onSubmit={anadir} className="space-y-1 px-4 pt-4 sm:px-0">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="cat-nueva" className="text-xs">
            Categoría nueva
          </Label>
          <Input
            id="cat-nueva"
            value={nombre}
            maxLength={40}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Por ejemplo, Proveedores"
            aria-invalid={!!aviso}
            aria-describedby={aviso ? "cat-nueva-err" : undefined}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cat-enlace" className="text-xs">
            Pide
          </Label>
          <Select value={enlace} onValueChange={(v) => setEnlace(v as typeof enlace)}>
            <SelectTrigger id="cat-enlace" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nada">Nada</SelectItem>
              <SelectItem value="pedido">Un pedido</SelectItem>
              <SelectItem value="cliente">Un cliente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={m.isPending}>
          <Plus className="h-4 w-4" /> Añadir
        </Button>
      </div>
      {aviso && (
        <p id="cat-nueva-err" role="alert" className="text-sm text-destructive">
          {aviso}
        </p>
      )}
    </form>
  );
}
