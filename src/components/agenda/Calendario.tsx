// El calendario de la Agenda. Día es una lista; Semana y Mes, casillas; Año,
// doce meses pequeños (decisión de Javier). Las reglas de qué días y qué
// tareas salen están en src/dominio/agenda-calendario.ts. Las tareas llegan ya
// filtradas por Para y De; las canceladas no salen (quedan en la lista).
//
// En el móvil, las pastillas de Semana y Mes son barras de color y tocar un
// día abre su lista; en el ordenador, pulsar el hueco de un día crea una tarea
// en ese día.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Link2, Plus } from "lucide-react";
import {
  esNueva,
  horaDeMadrid,
  PRIORIDADES,
  type CategoriaAgenda,
  type Tarea,
} from "@/dominio/agenda";
import {
  casillasDelMes,
  esVista,
  moverReferencia,
  nombreDelMes,
  prioridadMasAlta,
  rangoDeVista,
  semanaDe,
  tareasPorDia,
  tituloDeVista,
  VISTAS,
  type VistaCalendario,
} from "@/dominio/agenda-calendario";
import type { PersonaAgenda } from "@/lib/agenda.functions";
import { diaLargo } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Avatar, EtiquetaPrioridad, EtiquetaRealizada } from "./piezas";
import { CLASES_PRIORIDAD, CLASES_REALIZADA, iconoDeCategoria, prioridadDe } from "./estilos";

const DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const CLAVE_VISTA = "agenda:vista";

/** El mismo corte que las clases `sm:`/`max-sm:` de las casillas. */
const CORTE_MOVIL = 640;

function vistaGuardada(): VistaCalendario {
  try {
    const v = localStorage.getItem(CLAVE_VISTA);
    if (esVista(v)) return v;
  } catch {
    // Sin almacenamiento, la de por defecto.
  }
  return window.innerWidth < CORTE_MOVIL ? "dia" : "mes";
}

export function Calendario({
  tareas,
  categorias,
  personas,
  yo,
  hoy,
  verIniciales,
  puedeEscribir,
  cambiando,
  onAbrir,
  onNueva,
  onCambiarHecha,
}: {
  /** Ya filtradas por Para y De. */
  tareas: Tarea[];
  categorias: CategoriaAgenda[];
  personas: PersonaAgenda[];
  yo: string | null;
  hoy: string;
  /** Enseñar de quién es cada tarea (cuando no son todas mías). */
  verIniciales: boolean;
  puedeEscribir: boolean;
  cambiando: boolean;
  onAbrir: (id: string) => void;
  onNueva: (dia: string) => void;
  onCambiarHecha: (t: Tarea) => void;
}) {
  const movil = useIsMobile(CORTE_MOVIL) ?? false;
  const [vista, setVistaEstado] = useState<VistaCalendario>("mes");
  const [ref, setRef] = useState(hoy);
  // La vista se lee del dispositivo al montar (en el servidor no hay localStorage).
  useEffect(() => {
    setVistaEstado(vistaGuardada());
  }, []);
  const setVista = (v: VistaCalendario) => {
    setVistaEstado(v);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      // Sin almacenamiento, dura hasta recargar.
    }
  };
  const irADia = (dia: string) => {
    setRef(dia);
    setVista("dia");
  };

  const { desde, hasta } = rangoDeVista(ref, vista);
  const porDia = useMemo(() => tareasPorDia(tareas, desde, hasta), [tareas, desde, hasta]);
  const nombre = (id: string) => personas.find((p) => p.id === id)?.nombre ?? "—";
  const hayAlgo = porDia.size > 0;
  const textoVacio = { dia: "este día", semana: "esta semana", mes: "este mes", anio: "este año" }[
    vista
  ];

  return (
    <Card className="overflow-hidden" aria-label="Calendario">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setRef(hoy)}>
          Hoy
        </Button>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-9 sm:w-9"
            onClick={() => setRef(moverReferencia(ref, vista, -1))}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-9 sm:w-9"
            onClick={() => setRef(moverReferencia(ref, vista, 1))}
            aria-label="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div
          role="group"
          aria-label="Vista del calendario"
          className="inline-flex gap-0.5 rounded-lg bg-muted p-1"
        >
          {VISTAS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={vista === v.id}
              onClick={() => setVista(v.id)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-3 text-sm transition-colors sm:min-h-8",
                vista === v.id
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground",
              )}
            >
              {v.nombre}
            </button>
          ))}
        </div>
        <h2
          aria-live="polite"
          className="order-first basis-full text-base font-semibold sm:order-none sm:basis-auto sm:text-lg"
        >
          {tituloDeVista(ref, vista)}
        </h2>
        <Leyenda />
      </div>

      {vista === "dia" ? (
        <VistaDia
          tareas={porDia.get(ref) ?? []}
          dia={ref}
          categorias={categorias}
          yo={yo}
          nombre={nombre}
          puedeEscribir={puedeEscribir}
          cambiando={cambiando}
          onAbrir={onAbrir}
          onNueva={onNueva}
          onCambiarHecha={onCambiarHecha}
        />
      ) : vista === "anio" ? (
        <VistaAnio
          anio={ref.slice(0, 4)}
          hoy={hoy}
          porDia={porDia}
          onDia={irADia}
          onMes={(d) => {
            setRef(d);
            setVista("mes");
          }}
        />
      ) : (
        <>
          <Casillas
            dias={vista === "semana" ? semanaDe(ref) : casillasDelMes(ref)}
            mes={vista === "mes" ? ref.slice(0, 7) : null}
            semana={vista === "semana"}
            hoy={hoy}
            porDia={porDia}
            verIniciales={verIniciales}
            nombre={nombre}
            puedeEscribir={puedeEscribir && !movil}
            movil={movil}
            onAbrir={onAbrir}
            onNueva={onNueva}
            onDia={irADia}
          />
          {!hayAlgo && (
            <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
              Nada {textoVacio} con este filtro.
              {puedeEscribir && (
                <Button variant="outline" size="sm" onClick={() => onNueva(ref)}>
                  <Plus className="h-4 w-4" /> Nueva tarea
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Leyenda() {
  return (
    <div
      aria-label="Colores"
      className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground xl:ml-auto xl:basis-auto"
    >
      {PRIORIDADES.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("h-2.5 w-2.5 rounded-[3px]", CLASES_PRIORIDAD[p.id].punto)}
          />
          {p.marca && <b aria-hidden="true">{p.marca}</b>}
          {p.nombre}
        </span>
      ))}
      <span aria-hidden="true" className="h-3.5 w-px bg-border" />
      <span className="inline-flex items-center gap-1 font-semibold text-status-completado">
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Realizada
      </span>
    </div>
  );
}

/** Una tarea en una casilla: color de su prioridad (verde si está realizada). */
function Pastilla({
  t,
  semana,
  verIniciales,
  nombre,
  onAbrir,
}: {
  t: Tarea;
  semana: boolean;
  verIniciales: boolean;
  nombre: (id: string) => string;
  onAbrir: (id: string) => void;
}) {
  const hecha = t.estado === "hecha";
  const p = prioridadDe(t.prioridad);
  const c = hecha ? CLASES_REALIZADA : CLASES_PRIORIDAD[t.prioridad];
  const para = nombre(t.paraSocioId);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(t.id);
      }}
      title={`${t.titulo} · ${hecha ? "Realizada" : p.nombre} · para ${para}`}
      className={cn(
        "flex w-full min-w-0 items-start gap-1 rounded border-l-[3px] px-1.5 py-0.5 text-left text-xs hover:brightness-95",
        c.borde,
        c.suave,
        c.texto,
        "max-sm:h-1.5 max-sm:rounded-full max-sm:border-l-0 max-sm:p-0",
        c.barra,
      )}
    >
      <span className="contents max-sm:hidden">
        {hecha ? (
          <Check className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
        ) : (
          p.marca && (
            <b className="shrink-0" aria-hidden="true">
              {p.marca}
            </b>
          )
        )}
        {!t.todoElDia && (
          <span className="shrink-0 font-semibold tabular-nums">{horaDeMadrid(t.inicio)}</span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1",
            semana ? "line-clamp-3 break-words" : "truncate",
            hecha && "line-through",
          )}
        >
          {t.titulo}
        </span>
        {verIniciales && (
          <span className="shrink-0 text-[10px] font-bold opacity-80" aria-hidden="true">
            {iniciales(para)}
          </span>
        )}
      </span>
      <span className="sr-only">
        , {hecha ? "realizada" : `prioridad ${p.nombre}`}, para {para}
      </span>
    </button>
  );
}

function iniciales(nombre: string) {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? "")
    .join("");
}

function Casillas({
  dias,
  mes,
  semana,
  hoy,
  porDia,
  verIniciales,
  nombre,
  puedeEscribir,
  movil,
  onAbrir,
  onNueva,
  onDia,
}: {
  dias: string[];
  /** 'yyyy-mm' del mes que se ve; los días de otros meses van apagados. */
  mes: string | null;
  semana: boolean;
  hoy: string;
  porDia: Map<string, Tarea[]>;
  verIniciales: boolean;
  nombre: (id: string) => string;
  /** Pulsar el hueco crea una tarea (solo en el ordenador). */
  puedeEscribir: boolean;
  movil: boolean;
  onAbrir: (id: string) => void;
  onNueva: (dia: string) => void;
  onDia: (dia: string) => void;
}) {
  const maximo = semana ? Infinity : 3;
  return (
    <div className="grid grid-cols-7">
      {DIAS_SEMANA.map((d) => (
        <div
          key={d}
          className="border-b px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-2.5 sm:text-left"
        >
          {d}
        </div>
      ))}
      {dias.map((dia, i) => {
        const ts = porDia.get(dia) ?? [];
        const fuera = mes !== null && dia.slice(0, 7) !== mes;
        const esHoy = dia === hoy;
        const pulsable = movil || puedeEscribir;
        return (
          <div
            key={dia}
            onClick={() => (movil ? onDia(dia) : puedeEscribir && onNueva(dia))}
            className={cn(
              "group relative flex min-w-0 flex-col gap-1 border-b p-1 sm:p-1.5",
              (i + 1) % 7 !== 0 && "border-r",
              semana ? "min-h-28 sm:min-h-72" : "min-h-16 sm:min-h-24",
              fuera && "bg-muted/40",
              esHoy && "bg-status-procesando/10",
              pulsable && "cursor-pointer hover:bg-accent/50",
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDia(dia);
              }}
              aria-label={`Ver el ${diaLargo(dia)}${ts.length ? `, ${ts.length} ${ts.length === 1 ? "tarea" : "tareas"}` : ""}`}
              className={cn(
                "grid h-7 w-7 place-items-center self-center rounded-full text-xs font-semibold tabular-nums hover:bg-border sm:self-start",
                fuera && "text-muted-foreground",
                esHoy && "bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {Number(dia.slice(8))}
            </button>
            {puedeEscribir && (
              <Plus
                aria-hidden="true"
                className="absolute right-1.5 top-2 h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100"
              />
            )}
            {ts.slice(0, maximo).map((t) => (
              <Pastilla
                key={t.id}
                t={t}
                semana={semana}
                verIniciales={verIniciales}
                nombre={nombre}
                onAbrir={onAbrir}
              />
            ))}
            {ts.length > maximo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDia(dia);
                }}
                className="text-left text-[11px] font-semibold text-status-procesando hover:underline sm:px-1.5 sm:text-xs"
              >
                +{ts.length - maximo} más
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VistaDia({
  tareas,
  dia,
  categorias,
  yo,
  nombre,
  puedeEscribir,
  cambiando,
  onAbrir,
  onNueva,
  onCambiarHecha,
}: {
  tareas: Tarea[];
  dia: string;
  categorias: CategoriaAgenda[];
  yo: string | null;
  nombre: (id: string) => string;
  puedeEscribir: boolean;
  cambiando: boolean;
  onAbrir: (id: string) => void;
  onNueva: (dia: string) => void;
  onCambiarHecha: (t: Tarea) => void;
}) {
  return (
    <div>
      {tareas.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="font-medium">Nada este día</p>
          <p className="text-sm text-muted-foreground">Con el filtro de arriba no hay tareas.</p>
        </div>
      ) : (
        <ul>
          {tareas.map((t) => {
            const hecha = t.estado === "hecha";
            const c = hecha ? CLASES_REALIZADA : CLASES_PRIORIDAD[t.prioridad];
            const p = prioridadDe(t.prioridad);
            const cat = categorias.find((x) => x.id === t.categoriaId);
            const Icono = iconoDeCategoria(cat);
            return (
              <li
                key={t.id}
                className={cn(
                  "grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-l-4 px-4 py-3 sm:grid-cols-[36px_110px_minmax(0,1fr)_200px] sm:items-center",
                  c.borde,
                )}
              >
                <button
                  type="button"
                  disabled={!puedeEscribir || cambiando}
                  onClick={() => onCambiarHecha(t)}
                  aria-label={`${hecha ? "Volver a pendiente" : "Marcar como realizada"}: ${t.titulo}`}
                  className={cn(
                    "relative row-span-3 grid h-8 w-8 place-items-center self-start rounded-full border-2 transition-colors after:absolute after:-inset-2 after:content-[''] disabled:cursor-not-allowed disabled:opacity-40 sm:row-span-1 sm:h-7 sm:w-7 sm:self-center",
                    hecha
                      ? "border-status-completado bg-status-completado text-white"
                      : "border-input text-transparent hover:border-status-completado hover:text-status-completado",
                  )}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </button>
                <span className={cn("text-sm font-semibold tabular-nums", c.texto)}>
                  {t.todoElDia
                    ? "Todo el día"
                    : `${horaDeMadrid(t.inicio)}–${t.fin ? horaDeMadrid(t.fin) : ""}`}
                </span>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onAbrir(t.id)}
                    className={cn(
                      "break-words text-left font-semibold hover:underline",
                      hecha && "text-status-completado line-through",
                    )}
                  >
                    {!hecha && p.marca && (
                      <b className={cn("mr-1", c.texto)} aria-hidden="true">
                        {p.marca}
                      </b>
                    )}
                    {t.titulo}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {hecha ? <EtiquetaRealizada /> : <EtiquetaPrioridad prioridad={t.prioridad} />}
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
                    {esNueva(t, yo) && (
                      <span className="font-bold text-status-procesando">Nueva</span>
                    )}
                  </div>
                </div>
                <div className="col-start-2 flex min-w-0 items-center gap-2 text-sm sm:col-start-auto">
                  <Avatar nombre={nombre(t.paraSocioId)} yo={t.paraSocioId === yo} />
                  <span className="min-w-0 truncate">
                    {nombre(t.paraSocioId)}
                    {t.paraSocioId === yo && " (tú)"}
                    <span className="block text-xs text-muted-foreground">
                      de {t.deSocioId === yo ? "ti" : nombre(t.deSocioId)}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {puedeEscribir && (
        <div className="px-4 py-3">
          <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => onNueva(dia)}>
            <Plus className="h-4 w-4" /> Nueva tarea para este día
          </Button>
        </div>
      )}
    </div>
  );
}

const FORMA: Record<string, string> = {
  urgente: "rotate-45 rounded-[1px]",
  alta: "[clip-path:polygon(50%_0,100%_100%,0_100%)] rounded-none",
  normal: "rounded-full",
  baja: "rounded-full",
};

function VistaAnio({
  anio,
  hoy,
  porDia,
  onDia,
  onMes,
}: {
  anio: string;
  hoy: string;
  porDia: Map<string, Tarea[]>;
  onDia: (dia: string) => void;
  onMes: (dia: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-6 gap-y-5 p-4">
        {Array.from({ length: 12 }, (_, m) => {
          const primero = `${anio}-${String(m + 1).padStart(2, "0")}-01`;
          const casillas = casillasDelMes(primero);
          return (
            <div key={m}>
              <h3 className="mb-1.5">
                <button
                  type="button"
                  onClick={() => onMes(primero)}
                  className="rounded px-1 text-sm font-semibold capitalize hover:bg-accent"
                >
                  {nombreDelMes(primero)}
                </button>
              </h3>
              <div className="grid grid-cols-7 gap-0.5">
                {DIAS_SEMANA.map((d) => (
                  <span
                    key={d}
                    aria-hidden="true"
                    className="text-center text-[10px] font-semibold uppercase text-muted-foreground"
                  >
                    {d[0]}
                  </span>
                ))}
                {casillas.map((dia) => {
                  if (dia.slice(0, 7) !== primero.slice(0, 7)) return <span key={dia} />;
                  const ts = porDia.get(dia) ?? [];
                  const marca = prioridadMasAlta(ts);
                  const pendientes = ts.filter((t) => t.estado === "pendiente").length;
                  return (
                    <button
                      key={dia}
                      type="button"
                      onClick={() => onDia(dia)}
                      aria-label={`${diaLargo(dia)}${pendientes ? `, ${pendientes} pendientes, la más importante ${prioridadDe(marca!).nombre}` : ""}`}
                      className={cn(
                        "relative aspect-square rounded-md text-[11px] tabular-nums hover:bg-accent",
                        dia === hoy &&
                          "bg-primary font-bold text-primary-foreground hover:bg-primary",
                      )}
                    >
                      {Number(dia.slice(8))}
                      {marca && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute bottom-0.5 left-1/2 -ml-[3.5px] h-[7px] w-[7px]",
                            CLASES_PRIORIDAD[marca].punto,
                            FORMA[marca],
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-4 text-xs text-muted-foreground">
        Solo cuentan las pendientes. La marca del día es la de su tarea más importante:
        {PRIORIDADES.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("inline-block h-2 w-2", CLASES_PRIORIDAD[p.id].punto, FORMA[p.id])}
            />
            {p.nombre}
          </span>
        ))}
      </p>
    </>
  );
}
