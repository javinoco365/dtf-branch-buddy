import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarDays, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  FILTRO_PERSONA_INICIAL,
  FILTROS_LISTA_INICIALES,
  motivoSinCrear,
  pasaPersona,
  resumenDe,
  type EstadoTarea,
  type FiltroPersona,
  type FiltrosLista,
  type Orden,
  type Tarea,
} from "@/dominio/agenda";
import { cambiarEstadoTarea, pasarTarea } from "@/lib/agenda.functions";
import { avisarError, mensajeDeError } from "@/lib/errores";
import { useAgenda, useHoyEnMadrid } from "@/hooks/use-agenda";
import { useQuienSoy } from "@/hooks/use-quien-soy";
import { usePermisos } from "@/hooks/use-permisos";
import { Button } from "@/components/ui/button";
import { EstadoVacio } from "@/components/EstadoVacio";
import { FiltroPersonas } from "@/components/agenda/FiltroPersonas";
import { ListaTareas } from "@/components/agenda/ListaTareas";
import { Calendario } from "@/components/agenda/Calendario";
import { PanelTarea, type QuePanel } from "@/components/agenda/PanelTarea";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";

export const Route = createFileRoute("/panel/agenda")({
  head: () => ({ meta: [{ title: "Agenda · DTF Culture" }] }),
  component: Agenda,
});

/** Lo que dura el aviso con «Deshacer»: hay que dar tiempo a leerlo. */
const DURACION_DESHACER = 7000;

const TEXTO_ESTADO: Record<EstadoTarea, string> = {
  hecha: "Realizada. La tienes en la pestaña «Realizadas».",
  cancelada: "Tarea cancelada. La tienes en la pestaña «Canceladas».",
  pendiente: "Vuelve a estar pendiente",
};

/** Si no hay otro sitio lógico, el foco va al título de la lista de tareas. */
function focoDeRespaldo() {
  document.getElementById("titulo-lista-tareas")?.focus();
}

function filtroInicial(yo: string | null): FiltroPersona {
  // Por defecto cada uno ve lo suyo. Sin persona (cuenta sin socios), todo.
  return yo ? FILTRO_PERSONA_INICIAL : { para: "todos", de: "todos" };
}

function Agenda() {
  const { data, isLoading, error, refetch } = useAgenda();
  const {
    persona,
    estado: estadoQuien,
    cargando: cargandoPersona,
    error: errorPersona,
    reintentar: reintentarPersona,
  } = useQuienSoy();
  const { escribir } = usePermisos();
  const yo = persona?.id ?? null;
  const hoy = useHoyEnMadrid();
  // Sin persona no hay quién firme la tarea: no se crea (decisión de Javier).
  const motivoNoCrear = motivoSinCrear(escribir, errorPersona ? "error" : estadoQuien.tipo);
  const puedeCrear = motivoNoCrear === null;

  const [filtroPersona, setFiltroPersona] = useState<FiltroPersona>(filtroInicial(yo));
  useEffect(() => {
    setFiltroPersona(filtroInicial(yo));
  }, [yo]);
  const [filtros, setFiltros] = useState<FiltrosLista>(FILTROS_LISTA_INICIALES);
  const [orden, setOrden] = useState<Orden>({ campo: "fecha", dir: 1 });
  const [panel, setPanel] = useState<QuePanel>(null);
  // Lo que se pulsó para abrir el panel: al cerrarlo, el foco vuelve ahí.
  const origen = useRef<HTMLElement | null>(null);
  const abrir = (p: QuePanel) => {
    origen.current = document.activeElement as HTMLElement | null;
    setPanel(p);
  };
  const devolverFoco = () => {
    const o = origen.current;
    origen.current = null;
    if (o && document.contains(o)) o.focus();
    else focoDeRespaldo();
  };

  // Tras marcar como realizada, pasar o cancelar, la fila puede desaparecer
  // (sale de «Pendientes») cuando llegan los datos nuevos, y con ella el foco.
  // Se apuntan antes las tareas de al lado: si el foco se pierde, va a la
  // siguiente (o a la anterior); si no queda ninguna, al título de la lista.
  const candidatosFoco = useRef<{ zona: ParentNode; ids: string[] } | null>(null);
  const prepararFoco = (id: string) => {
    // La zona (lista, día o casillas) de lo que se pulsó; con el panel abierto,
    // la de lo que lo abrió.
    const desde = (origen.current ?? document.activeElement) as HTMLElement | null;
    const zona: ParentNode = desde?.closest("[data-zona-tareas]") ?? document;
    const ids = [...zona.querySelectorAll<HTMLElement>("[data-tarea-id]")].map(
      (e) => e.dataset.tareaId!,
    );
    const i = ids.indexOf(id);
    candidatosFoco.current = {
      zona,
      ids: i < 0 ? [id] : [id, ...ids.slice(i + 1), ...ids.slice(0, i).reverse()],
    };
  };
  useEffect(() => {
    const c = candidatosFoco.current;
    if (!c) return;
    const activo = document.activeElement;
    if (activo && activo !== document.body && document.contains(activo)) return;
    candidatosFoco.current = null;
    const zona = c.zona instanceof Node && document.contains(c.zona) ? c.zona : document;
    for (const id of c.ids) {
      const fila = zona.querySelector<HTMLElement>(`[data-tarea-id="${CSS.escape(id)}"]`);
      const destino = fila?.matches("button")
        ? fila
        : fila?.querySelector<HTMLElement>("[data-foco-tarea]");
      if (destino) {
        destino.focus();
        return;
      }
    }
    focoDeRespaldo();
  }, [data]);

  const tareas = useMemo(() => data?.tareas ?? [], [data]);
  const resumen = useMemo(() => resumenDe(tareas, yo, hoy), [tareas, yo, hoy]);
  const tareasDePersona = useMemo(
    () => tareas.filter((t) => pasaPersona(t, filtroPersona, yo)),
    [tareas, filtroPersona, yo],
  );
  const cuantas = useMemo(
    () => ({
      mias: tareas.filter((t) => t.estado === "pendiente" && t.paraSocioId === yo).length,
      enviadas: tareas.filter(
        (t) => t.estado === "pendiente" && t.deSocioId === yo && t.paraSocioId !== yo,
      ).length,
    }),
    [tareas, yo],
  );
  const nombre = (id: string) => data?.personas.find((p) => p.id === id)?.nombre ?? "otra persona";

  // Las acciones con «Deshacer» viven aquí y no en el panel: el panel se cierra
  // al hacerlas, y su «Deshacer» no debe cerrar el de otra tarea abierta luego.
  const estado = useServerFn(cambiarEstadoTarea);
  const pasar = useServerFn(pasarTarea);
  const cambiar = useMutation({
    mutationFn: (v: { tarea: Tarea; nuevo: EstadoTarea }) =>
      estado({ data: { id: v.tarea.id, socio: yo!, estado: v.nuevo } }),
    onError: (e: Error) => avisarError(e, "No se ha podido cambiar la tarea"),
  });
  const pasarM = useMutation({
    mutationFn: (v: { tarea: Tarea; para: string }) =>
      pasar({ data: { id: v.tarea.id, socio: yo!, para: v.para } }),
    onError: (e: Error) => avisarError(e, "No se ha podido pasar la tarea"),
  });

  function cambiarEstado(tarea: Tarea, nuevo: EstadoTarea, alTerminar?: () => void) {
    if (!yo) {
      toast.error("Tu cuenta no tiene una persona asignada: pídeselo a un administrador.");
      return;
    }
    prepararFoco(tarea.id);
    const antes = tarea.estado;
    cambiar.mutate(
      { tarea, nuevo },
      {
        onSuccess: () => {
          alTerminar?.();
          toast.success(TEXTO_ESTADO[nuevo], {
            duration: DURACION_DESHACER,
            action: { label: "Deshacer", onClick: () => cambiar.mutate({ tarea, nuevo: antes }) },
          });
        },
      },
    );
  }

  function pasarA(tarea: Tarea, para: string, alTerminar?: () => void) {
    if (!yo) return;
    prepararFoco(tarea.id);
    const antes = tarea.paraSocioId;
    pasarM.mutate(
      { tarea, para },
      {
        onSuccess: () => {
          alTerminar?.();
          toast.success(`Tarea pasada a ${nombre(para)}. Le saldrá como nueva.`, {
            duration: DURACION_DESHACER,
            action: { label: "Deshacer", onClick: () => pasarM.mutate({ tarea, para: antes }) },
          });
        },
      },
    );
  }

  function verEnLista(cambio: Partial<FiltrosLista>) {
    setFiltroPersona(FILTRO_PERSONA_INICIAL);
    setFiltros({ ...FILTROS_LISTA_INICIALES, ...cambio });
    document.getElementById("lista-tareas")?.scrollIntoView({ block: "start" });
    document.getElementById("titulo-lista-tareas")?.focus({ preventScroll: true });
  }

  const listo = !isLoading && !cargandoPersona && !error && !data?.falta_migracion;

  // «N» abre una tarea nueva, si no se está escribiendo ni eligiendo en otro sitio.
  useEffect(() => {
    if (!puedeCrear || !listo) return;
    const alPulsar = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        (e.key === "n" || e.key === "N") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat &&
        !e.defaultPrevented &&
        !panel &&
        !el?.closest(
          "input, textarea, select, [contenteditable], [role=dialog], [role=combobox], [role=listbox], [role=option], [role=menu], [role=menuitem]",
        )
      ) {
        e.preventDefault();
        origen.current = document.activeElement as HTMLElement | null;
        setPanel({ modo: "nueva" });
      }
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [puedeCrear, panel, listo]);

  if (isLoading || cargandoPersona) {
    return <p className="text-sm text-muted-foreground">Cargando la Agenda…</p>;
  }
  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{mensajeDeError(error)}</p>
        <Button variant="outline" onClick={() => refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (data?.falta_migracion) {
    return (
      <EstadoVacio
        icono={CalendarDays}
        titulo="La Agenda todavía no está activada"
        descripcion="Esta parte aún no está activada. Avisa a Javier."
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-20 sm:pb-0">
      {errorPersona && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            No se ha podido saber quién eres ({mensajeDeError(errorPersona)}). Puedes ver las
            tareas, pero no crearlas ni cambiarlas hasta que se sepa.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={reintentarPersona}
            disabled={cargandoPersona}
          >
            {cargandoPersona ? "Reintentando…" : "Reintentar"}
          </Button>
        </div>
      )}
      <CabeceraPantalla
        className="sm:items-end"
        acciones={
          escribir &&
          (puedeCrear ? (
            <Button
              id="boton-nueva-tarea"
              onClick={() => abrir({ modo: "nueva" })}
              className="hidden h-10 sm:inline-flex"
            >
              <Plus className="h-4 w-4" /> Nueva tarea
              <kbd className="ml-1 hidden rounded border border-current px-1 text-[10px] font-semibold opacity-70 sm:inline">
                N
              </kbd>
            </Button>
          ) : (
            // Desactivado y con el motivo a la vista (un botón desactivado no
            // enseña su título al tocarlo en el móvil).
            <div className="flex w-full flex-col gap-1 sm:w-auto sm:max-w-xs sm:items-end">
              <Button
                disabled
                aria-describedby="motivo-sin-crear"
                className="h-11 w-full sm:h-10 sm:w-auto"
              >
                <Plus className="h-4 w-4" /> Nueva tarea
              </Button>
              <p id="motivo-sin-crear" className="text-xs text-muted-foreground sm:text-right">
                {motivoNoCrear}
              </p>
            </div>
          ))
        }
      >
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
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
                <button
                  type="button"
                  className="font-semibold text-foreground underline underline-offset-2"
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
          !errorPersona && (
            <p className="text-sm text-muted-foreground">
              Tu cuenta no tiene una persona asignada: ves todas las tareas.
            </p>
          )
        )}
      </CabeceraPantalla>

      <FiltroPersonas
        valor={filtroPersona}
        onCambio={setFiltroPersona}
        personas={data?.personas ?? []}
        yo={yo}
        cuantas={cuantas}
      />

      <Calendario
        tareas={tareasDePersona}
        categorias={data?.categorias ?? []}
        personas={data?.personas ?? []}
        yo={yo}
        hoy={hoy}
        verIniciales={filtroPersona.para !== "yo"}
        puedeEscribir={escribir && !!yo}
        puedeCrear={puedeCrear}
        cambiando={cambiar.isPending}
        onAbrir={(id) => abrir({ modo: "ver", id })}
        onNueva={(dia) => abrir({ modo: "nueva", dia })}
        onCambiarHecha={(t) => cambiarEstado(t, t.estado === "hecha" ? "pendiente" : "hecha")}
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
          onAbrir={(id) => abrir({ modo: "ver", id })}
          onCambiarHecha={(t) => cambiarEstado(t, t.estado === "hecha" ? "pendiente" : "hecha")}
          cambiando={cambiar.isPending}
          puedeEscribir={escribir && !!yo}
          puedeCrear={puedeCrear}
        />
      </div>

      {puedeCrear && (
        <Button
          onClick={() => abrir({ modo: "nueva" })}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 h-14 rounded-full px-5 text-base shadow-lg sm:hidden"
        >
          <Plus className="h-5 w-5" /> Nueva tarea
        </Button>
      )}

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
        acciones={{
          onCambiarEstado: cambiarEstado,
          onPasar: pasarA,
          ocupado: cambiar.isPending || pasarM.isPending,
        }}
        onCerrar={() => setPanel(null)}
        devolverFoco={devolverFoco}
      />
    </div>
  );
}
