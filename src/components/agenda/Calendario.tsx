// El calendario de la Agenda. Día es una lista; Semana y Mes, casillas; Año,
// doce meses pequeños (decisión de Javier). Las reglas de qué días y qué
// tareas salen están en src/dominio/agenda-calendario.ts. Las tareas llegan ya
// filtradas por Para y De; las canceladas no salen (quedan en la lista).
//
// En el móvil, las pastillas de Semana y Mes son barras de color y tocar un
// día (entero) abre su lista: las tareas se abren desde ahí. En el ordenador,
// cada día tiene su botón «+» para crear una tarea ese día (decisión de
// Javier: nada de crear al pulsar el hueco).
//
// Ir a un día (o a un mes desde el Año) no cambia la vista guardada: solo la
// cambian los botones Día / Semana / Mes / Año.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Link2, Plus } from "lucide-react";
import {
  esNueva,
  franjaDeTarea,
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
  referenciaDelMes,
  semanaDe,
  tareasPorDia,
  tituloDeVista,
  VISTAS,
  type VistaCalendario,
} from "@/dominio/agenda-calendario";
import type { PersonaAgenda } from "@/lib/agenda.functions";
import { diaLargo } from "@/lib/format";
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

function guardarVista(v: VistaCalendario) {
  try {
    localStorage.setItem(CLAVE_VISTA, v);
  } catch {
    // Sin almacenamiento, dura hasta recargar.
  }
}

/**
 * Si la pantalla es de móvil. Se mira ya en el primer pintado (no tras un
 * efecto, como useIsMobile): así no se ve un instante la versión de ordenador.
 */
function useEsMovil(): boolean {
  const [movil, setMovil] = useState(
    () => typeof window !== "undefined" && window.innerWidth < CORTE_MOVIL,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${CORTE_MOVIL - 1}px)`);
    const alCambiar = () => setMovil(mql.matches);
    alCambiar();
    mql.addEventListener("change", alCambiar);
    return () => mql.removeEventListener("change", alCambiar);
  }, []);
  return movil;
}

export function Calendario({
  tareas,
  categorias,
  personas,
  yo,
  hoy,
  verIniciales,
  puedeEscribir,
  puedeCrear,
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
  /** Puede marcar realizadas (nivel y persona). */
  puedeEscribir: boolean;
  /** Puede crear tareas: nivel para escribir y una persona que las firme. */
  puedeCrear: boolean;
  cambiando: boolean;
  onAbrir: (id: string) => void;
  onNueva: (dia: string) => void;
  onCambiarHecha: (t: Tarea) => void;
}) {
  const movil = useEsMovil();
  // La vista guardada se lee antes del primer pintado, para no enseñar un
  // instante el Mes. En el servidor no hay localStorage: ahí no se pinta el
  // calendario hasta saberla (el efecto la lee nada más montar).
  const [vista, setVistaEstado] = useState<VistaCalendario | null>(() =>
    typeof window === "undefined" ? null : vistaGuardada(),
  );
  useEffect(() => {
    setVistaEstado((v) => v ?? vistaGuardada());
  }, []);
  const [ref, setRef] = useState(hoy);
  // A medianoche cambia «hoy»: si se estaba mirando el día de hoy, se sigue.
  const hoyAntes = useRef(hoy);
  useEffect(() => {
    const antes = hoyAntes.current;
    hoyAntes.current = hoy;
    if (antes !== hoy) setRef((r) => (r === antes ? hoy : r));
  }, [hoy]);
  /** Lo que elige quien usa la Agenda: se guarda en el dispositivo. */
  const elegirVista = (v: VistaCalendario) => {
    setVistaEstado(v);
    guardarVista(v);
  };
  /** Ir a un día no es elegir la vista Día: la preferencia no cambia. */
  const irADia = (dia: string) => {
    setRef(dia);
    setVistaEstado("dia");
  };

  const { desde, hasta } = rangoDeVista(ref, vista ?? "mes");
  const porDia = useMemo(() => tareasPorDia(tareas, desde, hasta), [tareas, desde, hasta]);

  if (!vista) {
    return <Card className="min-h-64" aria-label="Calendario" aria-busy="true" />;
  }

  const nombre = (id: string) => personas.find((p) => p.id === id)?.nombre ?? "—";
  const hayAlgo = porDia.size > 0;
  const textoVacio = { dia: "este día", semana: "esta semana", mes: "este mes", anio: "este año" }[
    vista
  ];

  return (
    <Card className="overflow-hidden" aria-label="Calendario">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <h2
          aria-live="polite"
          className="order-first basis-full text-base font-semibold md:order-none md:basis-auto md:text-lg"
        >
          {tituloDeVista(ref, vista)}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            aria-current={ref === hoy ? "date" : undefined}
            onClick={() => setRef(hoy)}
          >
            Hoy
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-9 md:w-9"
            onClick={() => setRef(moverReferencia(ref, vista, -1, hoy))}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-9 md:w-9"
            onClick={() => setRef(moverReferencia(ref, vista, 1, hoy))}
            aria-label="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div
          role="group"
          aria-label="Vista del calendario"
          className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-1 max-sm:w-full sm:inline-grid"
        >
          {VISTAS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={vista === v.id ? "true" : undefined}
              onClick={() => elegirVista(v.id)}
              className={cn(
                "inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm transition-colors md:min-h-8",
                vista === v.id
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground",
              )}
            >
              {v.nombre}
            </button>
          ))}
        </div>
        {vista !== "anio" && <Leyenda />}
      </div>

      {vista === "dia" ? (
        <VistaDia
          tareas={porDia.get(ref) ?? []}
          dia={ref}
          categorias={categorias}
          yo={yo}
          nombre={nombre}
          puedeEscribir={puedeEscribir}
          puedeCrear={puedeCrear}
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
            setRef(referenciaDelMes(d, hoy));
            setVistaEstado("mes");
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
            puedeCrear={puedeCrear && !movil}
            movil={movil}
            onAbrir={onAbrir}
            onNueva={onNueva}
            onDia={irADia}
          />
          {!hayAlgo && (
            <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
              Nada {textoVacio} con este filtro.
              {puedeCrear && (
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
      <span className={cn("inline-flex items-center gap-1 font-semibold", CLASES_REALIZADA.texto)}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Realizada
      </span>
    </div>
  );
}

/** Lo que se ve de una tarea en una casilla (sin ser botón: lo envuelve quien la pinta). */
function ContenidoPastilla({
  t,
  semana,
  verIniciales,
  para,
}: {
  t: Tarea;
  semana: boolean;
  verIniciales: boolean;
  para: string;
}) {
  const hecha = t.estado === "hecha";
  const p = prioridadDe(t.prioridad);
  return (
    <>
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
    </>
  );
}

function clasesPastilla(t: Tarea) {
  const c = t.estado === "hecha" ? CLASES_REALIZADA : CLASES_PRIORIDAD[t.prioridad];
  return cn("rounded border-l-[3px]", c.borde, c.suave, c.texto);
}

/** Una tarea en una casilla del ordenador: color de su prioridad (verde si está realizada). */
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
  const para = nombre(t.paraSocioId);
  return (
    <button
      type="button"
      data-tarea-id={t.id}
      onClick={() => onAbrir(t.id)}
      title={`${t.titulo} · ${hecha ? "Realizada" : p.nombre} · para ${para}`}
      className={cn(
        "flex w-full min-w-0 items-start gap-1 px-1.5 py-0.5 text-left text-xs hover:brightness-95",
        clasesPastilla(t),
      )}
    >
      <ContenidoPastilla t={t} semana={semana} verIniciales={verIniciales} para={para} />
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
  puedeCrear,
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
  /** Sale el «+» de cada día (solo en el ordenador). */
  puedeCrear: boolean;
  movil: boolean;
  onAbrir: (id: string) => void;
  onNueva: (dia: string) => void;
  onDia: (dia: string) => void;
}) {
  const maximo = semana ? Infinity : 3;
  return (
    <div className="grid grid-cols-7" data-zona-tareas="">
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
        const pendientes = ts.filter((t) => t.estado === "pendiente").length;
        const resumen = ts.length
          ? `, ${ts.length} ${ts.length === 1 ? "tarea" : "tareas"}${
              pendientes && pendientes < ts.length
                ? ` (${pendientes} ${pendientes === 1 ? "pendiente" : "pendientes"})`
                : ""
            }`
          : "";
        const clasesCasilla = cn(
          "relative flex min-w-0 flex-col gap-1 border-b p-1 sm:p-1.5",
          (i + 1) % 7 !== 0 && "border-r",
          semana ? "min-h-28 sm:min-h-72" : "min-h-16 sm:min-h-24",
          fuera && "bg-muted/40",
          esHoy && "bg-status-procesando/10",
        );
        const numero = cn(
          "grid h-7 w-7 place-items-center self-center rounded-full text-xs font-semibold tabular-nums sm:self-start",
          fuera && "text-muted-foreground",
          esHoy && "bg-primary text-primary-foreground",
        );

        // Móvil: el día entero es un botón que abre su lista; las tareas, barras.
        if (movil) {
          return (
            <button
              key={dia}
              type="button"
              onClick={() => onDia(dia)}
              aria-current={esHoy ? "date" : undefined}
              aria-label={`Ver el ${diaLargo(dia)}${esHoy ? ", hoy" : ""}${resumen}`}
              className={cn(clasesCasilla, "items-stretch text-left active:bg-accent/60")}
            >
              <span aria-hidden="true" className={numero}>
                {Number(dia.slice(8))}
              </span>
              {ts.slice(0, maximo).map((t) => (
                <span
                  key={t.id}
                  aria-hidden="true"
                  className={cn(
                    "block h-1.5 w-full shrink-0 rounded-full",
                    (t.estado === "hecha" ? CLASES_REALIZADA : CLASES_PRIORIDAD[t.prioridad]).punto,
                  )}
                />
              ))}
              {ts.length > maximo && (
                <span
                  aria-hidden="true"
                  className="text-[11px] font-semibold text-status-procesando"
                >
                  +{ts.length - maximo}
                </span>
              )}
            </button>
          );
        }

        return (
          <div key={dia} className={cn(clasesCasilla, "group")}>
            <div className="flex items-start justify-between gap-1">
              <button
                type="button"
                onClick={() => onDia(dia)}
                aria-current={esHoy ? "date" : undefined}
                aria-label={`Ver el ${diaLargo(dia)}${esHoy ? ", hoy" : ""}${resumen}`}
                className={cn(numero, esHoy ? "hover:bg-primary" : "hover:bg-border")}
              >
                {Number(dia.slice(8))}
              </button>
              {puedeCrear && (
                <button
                  type="button"
                  onClick={() => onNueva(dia)}
                  aria-label={`Nueva tarea el ${diaLargo(dia)}`}
                  title="Nueva tarea este día"
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
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
                onClick={() => onDia(dia)}
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
  puedeCrear,
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
  puedeCrear: boolean;
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
        <ul data-zona-tareas="">
          {tareas.map((t) => {
            const hecha = t.estado === "hecha";
            const c = hecha ? CLASES_REALIZADA : CLASES_PRIORIDAD[t.prioridad];
            const p = prioridadDe(t.prioridad);
            const cat = categorias.find((x) => x.id === t.categoriaId);
            const Icono = iconoDeCategoria(cat);
            return (
              <li
                key={t.id}
                data-tarea-id={t.id}
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
                    hecha ? CLASES_REALIZADA.circulo : CLASES_REALIZADA.circuloVacio,
                  )}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </button>
                <span className={cn("text-sm font-semibold tabular-nums", c.texto)}>
                  {franjaDeTarea(t) ?? "Todo el día"}
                </span>
                <div className="min-w-0">
                  <button
                    type="button"
                    data-foco-tarea=""
                    onClick={() => onAbrir(t.id)}
                    className={cn(
                      "break-words text-left font-semibold hover:underline",
                      hecha && cn(CLASES_REALIZADA.texto, "line-through"),
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
      {puedeCrear && (
        <div className="px-4 py-3">
          <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={() => onNueva(dia)}>
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
  const hayPendientes = [...porDia.values()].some((ts) => prioridadMasAlta(ts) !== null);
  return (
    <>
      <div
        aria-label="Leyenda"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 text-xs text-muted-foreground"
      >
        <span>
          Solo cuentan las pendientes. Cada día lleva la marca de su tarea más importante:
        </span>
        {PRIORIDADES.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("inline-block h-2 w-2", CLASES_PRIORIDAD[p.id].punto, FORMA[p.id])}
            />
            {p.nombre}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-grid h-4 w-4 place-items-center rounded-md bg-primary text-[9px] font-bold text-primary-foreground"
          >
            {Number(hoy.slice(8))}
          </span>
          Hoy
        </span>
      </div>
      {!hayPendientes && (
        <p className="border-b px-4 py-3 text-sm text-muted-foreground">
          Ninguna tarea pendiente en {anio} con este filtro.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-6 gap-y-5 p-4">
        {Array.from({ length: 12 }, (_, m) => {
          const primero = `${anio}-${String(m + 1).padStart(2, "0")}-01`;
          const casillas = casillasDelMes(primero);
          const esMesDeHoy = hoy.slice(0, 7) === primero.slice(0, 7);
          return (
            <div key={m}>
              <h3 className="mb-1.5">
                <button
                  type="button"
                  onClick={() => onMes(primero)}
                  aria-current={esMesDeHoy ? "date" : undefined}
                  className={cn(
                    "rounded px-1 text-sm font-semibold capitalize hover:bg-accent",
                    esMesDeHoy && "text-primary underline underline-offset-4",
                  )}
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
                  const esHoy = dia === hoy;
                  return (
                    <button
                      key={dia}
                      type="button"
                      onClick={() => onDia(dia)}
                      aria-current={esHoy ? "date" : undefined}
                      aria-label={`${diaLargo(dia)}${esHoy ? ", hoy" : ""}${
                        pendientes && marca
                          ? `, ${pendientes} ${pendientes === 1 ? "pendiente" : "pendientes"}, la más importante ${prioridadDe(marca).nombre}`
                          : ""
                      }`}
                      className={cn(
                        "relative aspect-square rounded-md text-[11px] tabular-nums hover:bg-accent",
                        esHoy && "bg-primary font-bold text-primary-foreground hover:bg-primary",
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
                            // Sobre el fondo de hoy, con un borde para que se vea.
                            esHoy && "ring-1 ring-primary-foreground",
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
    </>
  );
}
