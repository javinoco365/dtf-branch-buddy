// La lista de tareas de la Agenda: pestañas de estado, filtros propios de la
// lista y las filas. «Para» y «De» vienen de arriba (FiltroPersonas) y mandan
// también en el calendario; estos filtros, solo aquí.
import { useMemo } from "react";
import { ArrowDown, ArrowUp, Check, Clock, Link2, Search, X } from "lucide-react";
import {
  diaDeTarea,
  diasVencida,
  esNueva,
  ETIQUETA_ESTADO,
  hayFiltrosLista,
  horaDeMadrid,
  ordenarTareas,
  pasaFiltrosSinEstado,
  pasaPersona,
  PRIORIDADES,
  FILTROS_LISTA_INICIALES,
  type CategoriaAgenda,
  type EstadoTarea,
  type FiltroPersona,
  type FiltrosLista,
  type Orden,
  type Periodo,
  type Tarea,
} from "@/dominio/agenda";
import type { PersonaAgenda } from "@/lib/agenda.functions";
import { diaRelativo } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Avatar, EtiquetaPrioridad } from "./piezas";
import { CLASES_PRIORIDAD, CLASES_REALIZADA, iconoDeCategoria, prioridadDe } from "./estilos";

const PESTANAS: { id: EstadoTarea | "todas"; nombre: string }[] = [
  { id: "pendiente", nombre: "Pendientes" },
  { id: "hecha", nombre: "Realizadas" },
  { id: "cancelada", nombre: "Canceladas" },
  { id: "todas", nombre: "Todas" },
];

const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: "todas", nombre: "Cualquier fecha" },
  { id: "vencidas", nombre: "Vencidas" },
  { id: "hoy", nombre: "Hoy" },
  { id: "semana", nombre: "Esta semana" },
  { id: "mes", nombre: "Este mes" },
  { id: "rango", nombre: "Entre fechas…" },
];

export function ListaTareas({
  tareas,
  categorias,
  personas,
  yo,
  hoy,
  filtroPersona,
  filtros,
  onFiltros,
  orden,
  onOrden,
  onAbrir,
  onCambiarHecha,
  cambiando,
  puedeEscribir,
  puedeCrear,
}: {
  tareas: Tarea[];
  categorias: CategoriaAgenda[];
  personas: PersonaAgenda[];
  yo: string | null;
  hoy: string;
  filtroPersona: FiltroPersona;
  filtros: FiltrosLista;
  onFiltros: (f: FiltrosLista) => void;
  orden: Orden;
  onOrden: (o: Orden) => void;
  onAbrir: (id: string) => void;
  onCambiarHecha: (t: Tarea) => void;
  /** Se está guardando un cambio de estado: los círculos esperan. */
  cambiando: boolean;
  /** Puede marcar realizadas (nivel y persona). */
  puedeEscribir: boolean;
  /** Puede crear tareas (nivel y persona). */
  puedeCrear: boolean;
}) {
  const ctx = useMemo(() => ({ yo, hoy }), [yo, hoy]);
  const base = useMemo(
    () =>
      tareas.filter(
        (t) => pasaPersona(t, filtroPersona, yo) && pasaFiltrosSinEstado(t, filtros, ctx),
      ),
    [tareas, filtroPersona, yo, filtros, ctx],
  );
  const filas = useMemo(
    () =>
      ordenarTareas(
        base.filter((t) => filtros.estado === "todas" || t.estado === filtros.estado),
        orden,
        filtros.estado,
      ),
    [base, filtros.estado, orden],
  );
  const cuantas = (e: EstadoTarea | "todas") =>
    e === "todas" ? base.length : base.filter((t) => t.estado === e).length;
  const nombre = (id: string) => personas.find((p) => p.id === id)?.nombre ?? "—";
  const categoria = (id: string) => categorias.find((c) => c.id === id);
  const set = (cambio: Partial<FiltrosLista>) => onFiltros({ ...filtros, ...cambio });
  const ordenarPor = (campo: Orden["campo"]) =>
    onOrden({ campo, dir: orden.campo === campo ? (orden.dir === 1 ? -1 : 1) : 1 });
  const Flecha = ({ campo }: { campo: Orden["campo"] }) =>
    orden.campo === campo && orden.dir === -1 ? (
      <ArrowUp className="h-3 w-3" aria-hidden="true" />
    ) : (
      <ArrowDown
        className={cn("h-3 w-3", orden.campo !== campo && "opacity-30")}
        aria-hidden="true"
      />
    );
  const ariaSort = (campo: Orden["campo"]) =>
    orden.campo === campo ? (orden.dir === 1 ? "ascending" : "descending") : "none";
  const totalPersona = tareas.filter((t) => pasaPersona(t, filtroPersona, yo)).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4">
        <h2
          id="titulo-lista-tareas"
          tabIndex={-1}
          className="text-lg font-semibold focus-visible:outline-none"
        >
          Tareas
        </h2>
        <div
          role="group"
          aria-label="Estado"
          className="grid grid-cols-2 gap-0.5 rounded-lg bg-muted p-1 max-sm:w-full sm:inline-flex sm:flex-wrap"
        >
          {PESTANAS.map((p) => {
            const activo = filtros.estado === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={activo}
                onClick={() => set({ estado: p.id })}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm transition-colors md:min-h-9",
                  activo
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "text-secondary-foreground hover:text-foreground",
                )}
              >
                {p.id === "hecha" && (
                  <Check className={cn("h-3.5 w-3.5", CLASES_REALIZADA.texto)} aria-hidden="true" />
                )}
                {p.nombre}
                <span
                  className={cn(
                    "rounded-md px-1.5 text-[11px] font-semibold tabular-nums",
                    p.id === "hecha"
                      ? cn(CLASES_REALIZADA.suave, CLASES_REALIZADA.texto)
                      : "bg-border/60",
                  )}
                >
                  {cuantas(p.id)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={filtros.texto}
            onChange={(e) => set({ texto: e.target.value })}
            placeholder="Buscar por título, pedido o cliente"
            aria-label="Buscar tareas"
            className="h-11 pl-8 md:h-9"
          />
        </div>
        <div role="group" aria-label="Prioridad" className="flex flex-wrap gap-1">
          {PRIORIDADES.map((p) => {
            const activo = filtros.prioridades.includes(p.id);
            const c = CLASES_PRIORIDAD[p.id];
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={activo}
                onClick={() =>
                  set({
                    prioridades: activo
                      ? filtros.prioridades.filter((x) => x !== p.id)
                      : [...filtros.prioridades, p.id],
                  })
                }
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors md:min-h-9",
                  activo
                    ? cn(c.suave, c.texto, c.anillo, "font-semibold ring-1 ring-inset")
                    : "hover:bg-accent",
                )}
              >
                <span aria-hidden="true" className={cn("h-2 w-2 rounded-[3px]", c.punto)} />
                {p.nombre}
              </button>
            );
          })}
        </div>
        <Select
          value={filtros.categoriaId ?? "todas"}
          onValueChange={(v) => set({ categoriaId: v === "todas" ? null : v })}
        >
          <SelectTrigger className="h-11 w-[180px] md:h-9" aria-label="Categoría">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {categorias
              .filter((c) => c.activa || tareas.some((t) => t.categoriaId === c.id))
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={filtros.periodo} onValueChange={(v) => set({ periodo: v as Periodo })}>
          <SelectTrigger className="h-11 w-[160px] md:h-9" aria-label="Fechas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODOS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtros.periodo === "rango" && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <label className="flex items-center gap-1.5">
              Desde
              <Input
                type="date"
                value={filtros.desde}
                onChange={(e) => set({ desde: e.target.value })}
                className="h-9 w-auto"
              />
            </label>
            <label className="flex items-center gap-1.5">
              hasta
              <Input
                type="date"
                value={filtros.hasta}
                onChange={(e) => set({ hasta: e.target.value })}
                className="h-9 w-auto"
              />
            </label>
          </div>
        )}
        {filtros.soloNuevas && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => set({ soloNuevas: false })}
            aria-label="Quitar filtro: solo nuevas"
          >
            Solo nuevas <X className="h-3.5 w-3.5" />
          </Button>
        )}
        {hayFiltrosLista(filtros) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFiltros({ ...FILTROS_LISTA_INICIALES, estado: filtros.estado })}
          >
            <X className="h-3.5 w-3.5" /> Quitar filtros
          </Button>
        )}
        <p className="basis-full text-xs text-muted-foreground">
          Al marcar una tarea como realizada sale de «Pendientes» y pasa a «Realizadas». Estos
          filtros solo cambian la lista.
        </p>
      </div>

      {filas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="font-medium">
            {totalPersona === 0
              ? "Aún no hay tareas aquí"
              : hayFiltrosLista(filtros)
                ? "Ninguna tarea con estos filtros"
                : {
                    pendiente: "Nada pendiente",
                    hecha: "Aún no hay tareas realizadas",
                    cancelada: "No hay tareas canceladas",
                    todas: "Aún no hay tareas",
                  }[filtros.estado]}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground empty:hidden">
            {totalPersona === 0
              ? puedeCrear
                ? "Crea la primera con «Nueva tarea»."
                : "Cuando alguien cree una, aparecerá aquí."
              : hayFiltrosLista(filtros)
                ? "Prueba a quitar algún filtro."
                : filtros.estado === "hecha"
                  ? "Cuando marques una como realizada, aparecerá aquí."
                  : filtros.estado === "pendiente"
                    ? "Todo al día."
                    : ""}
          </p>
          {hayFiltrosLista(filtros) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onFiltros({ ...FILTROS_LISTA_INICIALES, estado: filtros.estado })}
            >
              Quitar filtros
            </Button>
          )}
        </div>
      ) : (
        <div role="table" aria-label="Tareas" data-zona-tareas="">
          <div
            role="row"
            className="hidden grid-cols-[40px_96px_minmax(0,1fr)_160px_140px] items-center gap-x-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid"
          >
            <span role="columnheader">
              <span className="sr-only">Realizada</span>
            </span>
            <span role="columnheader" aria-sort={ariaSort("prioridad")}>
              <button
                type="button"
                onClick={() => ordenarPor("prioridad")}
                className="inline-flex items-center gap-1 uppercase hover:text-foreground"
              >
                Prioridad <Flecha campo="prioridad" />
              </button>
            </span>
            <span role="columnheader">Tarea</span>
            <span role="columnheader">Para</span>
            <span role="columnheader" aria-sort={ariaSort("fecha")}>
              <button
                type="button"
                onClick={() => ordenarPor("fecha")}
                className="inline-flex items-center gap-1 uppercase hover:text-foreground"
              >
                Fecha <Flecha campo="fecha" />
              </button>
            </span>
          </div>
          {filas.map((t) => {
            const cat = categoria(t.categoriaId);
            const Icono = iconoDeCategoria(cat);
            const vencida = diasVencida(t, hoy);
            const dia = diaRelativo(diaDeTarea(t), hoy);
            const hecha = t.estado === "hecha";
            const p = prioridadDe(t.prioridad);
            return (
              <div
                key={t.id}
                role="row"
                data-tarea-id={t.id}
                className={cn(
                  "grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0 hover:bg-accent/50 md:grid-cols-[40px_96px_minmax(0,1fr)_160px_140px] xl:grid-cols-[44px_112px_minmax(0,1fr)_200px_170px] md:items-center md:py-2.5",
                  hecha && "bg-status-completado/5",
                )}
              >
                <div role="cell" className="row-span-3 md:row-span-1">
                  <button
                    type="button"
                    disabled={!puedeEscribir || t.estado === "cancelada" || cambiando}
                    onClick={() => onCambiarHecha(t)}
                    aria-label={`${hecha ? "Volver a pendiente" : "Marcar como realizada"}: ${t.titulo}`}
                    className={cn(
                      "relative grid h-8 w-8 place-items-center rounded-full border-2 transition-colors after:absolute after:-inset-2 after:content-[''] disabled:cursor-not-allowed disabled:opacity-40 md:h-7 md:w-7",
                      hecha ? CLASES_REALIZADA.circulo : CLASES_REALIZADA.circuloVacio,
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </button>
                </div>
                <div role="cell" className="hidden md:block">
                  <EtiquetaPrioridad prioridad={t.prioridad} />
                </div>
                <div role="cell" className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-2 md:items-center">
                    <button
                      type="button"
                      data-foco-tarea=""
                      onClick={() => onAbrir(t.id)}
                      className={cn(
                        "min-w-0 break-words text-left font-semibold hover:underline md:truncate",
                        hecha && cn(CLASES_REALIZADA.texto, "line-through"),
                        t.estado === "cancelada" && "text-muted-foreground line-through",
                      )}
                    >
                      {t.titulo}
                    </button>
                    {esNueva(t, yo) && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-status-procesando">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-status-procesando"
                        />
                        Nueva
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-semibold md:hidden",
                        CLASES_PRIORIDAD[t.prioridad].texto,
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("h-2 w-2 rounded-[3px]", CLASES_PRIORIDAD[t.prioridad].punto)}
                      />
                      {p.marca && <span aria-hidden="true">{p.marca}</span>}
                      {p.nombre}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icono className="h-3.5 w-3.5" aria-hidden="true" />
                      {cat?.nombre ?? "Sin categoría"}
                    </span>
                    {t.enlaceTexto && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{t.enlaceTexto}</span>
                      </span>
                    )}
                    {t.estado !== "pendiente" && filtros.estado === "todas" && (
                      <span className="font-semibold">{ETIQUETA_ESTADO[t.estado]}</span>
                    )}
                  </div>
                </div>
                <div role="cell" className="flex min-w-0 items-center gap-2 text-sm">
                  <Avatar nombre={nombre(t.paraSocioId)} yo={t.paraSocioId === yo} />
                  <span className="min-w-0 truncate">
                    {nombre(t.paraSocioId)}
                    {t.paraSocioId === yo && " (tú)"}
                    <span className="block text-xs text-muted-foreground">
                      de {t.deSocioId === yo ? "ti" : nombre(t.deSocioId)}
                    </span>
                  </span>
                </div>
                <div role="cell" className="text-sm tabular-nums">
                  {dia} · {t.todoElDia ? "todo el día" : horaDeMadrid(t.inicio)}
                  {vencida > 0 && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      Vencida hace {vencida} {vencida === 1 ? "día" : "días"}
                    </span>
                  )}
                  {hecha && t.hechaEn && (
                    <span
                      className={cn(
                        "flex items-center gap-1 text-xs font-semibold",
                        CLASES_REALIZADA.texto,
                      )}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Realizada {diaRelativo(diaDeTarea({ inicio: t.hechaEn }), hoy).toLowerCase()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
