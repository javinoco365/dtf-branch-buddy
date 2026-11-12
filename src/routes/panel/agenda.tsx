import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  FILTRO_PERSONA_INICIAL,
  FILTROS_LISTA_INICIALES,
  resumenDe,
  type FiltroPersona,
  type FiltrosLista,
  type Orden,
  type Tarea,
} from "@/dominio/agenda";
import { cambiarEstadoTarea } from "@/lib/agenda.functions";
import { avisarError, mensajeDeError } from "@/lib/errores";
import { hoyEnMadrid, useAgenda } from "@/hooks/use-agenda";
import { useQuienSoy } from "@/hooks/use-quien-soy";
import { usePermisos } from "@/hooks/use-permisos";
import { Button } from "@/components/ui/button";
import { EstadoVacio } from "@/components/EstadoVacio";
import { FiltroPersonas } from "@/components/agenda/FiltroPersonas";
import { ListaTareas } from "@/components/agenda/ListaTareas";
import { PanelTarea, type QuePanel } from "@/components/agenda/PanelTarea";

export const Route = createFileRoute("/panel/agenda")({
  head: () => ({ meta: [{ title: "Agenda · DTF Culture" }] }),
  component: Agenda,
});

function Agenda() {
  const { data, isLoading, error } = useAgenda();
  const { persona } = useQuienSoy();
  const { escribir } = usePermisos();
  const yo = persona?.id ?? null;
  const hoy = hoyEnMadrid();

  // Por defecto cada uno ve lo suyo. Sin persona (cuenta sin socios), todo.
  const [filtroPersona, setFiltroPersona] = useState<FiltroPersona>(
    yo ? FILTRO_PERSONA_INICIAL : { para: "todos", de: "todos" },
  );
  useEffect(() => {
    setFiltroPersona(yo ? FILTRO_PERSONA_INICIAL : { para: "todos", de: "todos" });
  }, [yo]);
  const [filtros, setFiltros] = useState<FiltrosLista>(FILTROS_LISTA_INICIALES);
  const [orden, setOrden] = useState<Orden>({ campo: "fecha", dir: 1 });
  const [panel, setPanel] = useState<QuePanel>(null);

  const tareas = useMemo(() => data?.tareas ?? [], [data]);
  const resumen = useMemo(() => resumenDe(tareas, yo, hoy), [tareas, yo, hoy]);
  const cuantas = useMemo(
    () => ({
      mias: tareas.filter((t) => t.estado === "pendiente" && t.paraSocioId === yo).length,
      enviadas: tareas.filter(
        (t) => t.estado === "pendiente" && t.deSocioId === yo && t.paraSocioId !== yo,
      ).length,
    }),
    [tareas, yo],
  );

  const estado = useServerFn(cambiarEstadoTarea);
  const marcar = useMutation({
    mutationFn: (v: { tarea: Tarea; nuevo: Tarea["estado"]; antes: Tarea["estado"] }) =>
      estado({ data: { id: v.tarea.id, socio: yo!, estado: v.nuevo } }),
    onSuccess: (_r, v) => {
      toast.success(
        v.nuevo === "hecha"
          ? "Realizada. La tienes en la pestaña «Realizadas»."
          : `«${v.tarea.titulo}» vuelve a Pendientes`,
        {
          action: {
            label: "Deshacer",
            onClick: () => marcar.mutate({ tarea: v.tarea, nuevo: v.antes, antes: v.nuevo }),
          },
        },
      );
    },
    onError: (e: Error) => avisarError(e, "No se ha podido cambiar la tarea"),
  });

  function cambiarHecha(t: Tarea) {
    if (!yo) {
      toast.error("Tu cuenta no tiene una persona asignada: pídeselo a un administrador.");
      return;
    }
    marcar.mutate({
      tarea: t,
      nuevo: t.estado === "hecha" ? "pendiente" : "hecha",
      antes: t.estado,
    });
  }

  function verEnLista(cambio: Partial<FiltrosLista>) {
    setFiltroPersona(FILTRO_PERSONA_INICIAL);
    setFiltros({ ...FILTROS_LISTA_INICIALES, ...cambio });
    document.getElementById("lista-tareas")?.scrollIntoView({ block: "start" });
  }

  // «N» abre una tarea nueva, si no se está escribiendo en otro sitio.
  useEffect(() => {
    if (!escribir) return;
    const alPulsar = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        (e.key === "n" || e.key === "N") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !panel &&
        !el?.closest("input, textarea, select, [contenteditable], [role=dialog]")
      ) {
        e.preventDefault();
        setPanel({ modo: "nueva" });
      }
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [escribir, panel]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando la Agenda…</p>;
  if (error) return <p className="text-sm text-destructive">{mensajeDeError(error)}</p>;
  if (data?.falta_migracion) {
    return (
      <EstadoVacio
        icono={CalendarDays}
        titulo="La Agenda todavía no está en la base"
        descripcion="Falta aplicar la migración 20261116100000_agenda. Cuando esté, aquí saldrán las tareas."
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
          {persona ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                {persona.nombre.split(" ")[0]}, hoy tienes{" "}
                <button
                  type="button"
                  className="font-semibold text-foreground underline underline-offset-2"
                  onClick={() => verEnLista({ periodo: "hoy" })}
                >
                  {resumen.hoy} {resumen.hoy === 1 ? "tarea pendiente" : "tareas pendientes"}
                </button>
              </span>
              {resumen.vencidas > 0 && (
                <span className="inline-flex items-center gap-1 text-prioridad-urgente">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => verEnLista({ periodo: "vencidas" })}
                  >
                    {resumen.vencidas} {resumen.vencidas === 1 ? "vencida" : "vencidas"}
                  </button>{" "}
                  de días anteriores
                </span>
              )}
              {resumen.nuevas > 0 && (
                <span className="text-status-procesando">
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => verEnLista({ soloNuevas: true })}
                  >
                    {resumen.nuevas} {resumen.nuevas === 1 ? "nueva" : "nuevas"}
                  </button>{" "}
                  que te han mandado
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu cuenta no tiene una persona asignada: ves todas las tareas. Un administrador lo
              elige en Ajustes › Usuarios.
            </p>
          )}
        </div>
        {escribir && (
          <Button onClick={() => setPanel({ modo: "nueva" })} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" /> Nueva tarea
            <kbd className="ml-1 hidden rounded border border-current px-1 text-[10px] font-semibold opacity-70 sm:inline">
              N
            </kbd>
          </Button>
        )}
      </div>

      <FiltroPersonas
        valor={filtroPersona}
        onCambio={setFiltroPersona}
        personas={data?.personas ?? []}
        yo={yo}
        cuantas={cuantas}
      />

      <div id="lista-tareas" className="scroll-mt-20">
        <ListaTareas
          tareas={tareas}
          categorias={data?.categorias ?? []}
          personas={data?.personas ?? []}
          yo={yo}
          hoy={hoy}
          filtroPersona={filtroPersona}
          filtros={filtros}
          onFiltros={setFiltros}
          orden={orden}
          onOrden={setOrden}
          onAbrir={(id) => setPanel({ modo: "ver", id })}
          onCambiarHecha={cambiarHecha}
          puedeEscribir={escribir}
        />
      </div>

      <PanelTarea
        que={panel}
        datos={{
          tareas,
          categorias: data?.categorias ?? [],
          personas: data?.personas ?? [],
        }}
        yo={yo}
        hoy={hoy}
        puedeEscribir={escribir}
        onCerrar={() => setPanel(null)}
      />
    </div>
  );
}
