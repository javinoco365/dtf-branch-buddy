/**
 * Agenda: las reglas de las tareas, sin base de datos.
 *
 * Una tarea es de un socio para otro (o para sí mismo), tiene prioridad,
 * categoría, día (y a veces hora) y tres estados: pendiente, hecha o
 * cancelada. No se borra: se cancela. Las tablas son agenda_tareas y
 * agenda_categorias (migración 20261116100000).
 *
 * Los días son de España: una tarea «del jueves» es del jueves en Madrid, la
 * mire quien la mire. En la base, `inicio` es un instante (timestamptz); una
 * tarea de todo el día guarda las 00:00 de su día en Madrid.
 */

export const ZONA_AGENDA = "Europe/Madrid";

export type Prioridad = "urgente" | "alta" | "normal" | "baja";
export type EstadoTarea = "pendiente" | "hecha" | "cancelada";

/** De más a menos importante. La marca acompaña al color: no se fía todo al color. */
export const PRIORIDADES: readonly { id: Prioridad; nombre: string; marca: string }[] = [
  { id: "urgente", nombre: "Urgente", marca: "!!" },
  { id: "alta", nombre: "Alta", marca: "!" },
  { id: "normal", nombre: "Normal", marca: "" },
  { id: "baja", nombre: "Baja", marca: "" },
];

export const ETIQUETA_ESTADO: Record<EstadoTarea, string> = {
  pendiente: "Pendiente",
  hecha: "Realizada",
  cancelada: "Cancelada",
};

export function esPrioridad(v: unknown): v is Prioridad {
  return PRIORIDADES.some((p) => p.id === v);
}

export function ordenPrioridad(p: Prioridad): number {
  return PRIORIDADES.findIndex((x) => x.id === p);
}

export type CategoriaAgenda = {
  id: string;
  nombre: string;
  /** La tarea de esta categoría enlaza un pedido o un cliente; null, nada. */
  enlace: "pedido" | "cliente" | null;
  icono: string | null;
  activa: boolean;
  orden: number;
};

export type Tarea = {
  id: string;
  titulo: string;
  notas: string | null;
  categoriaId: string;
  prioridad: Prioridad;
  todoElDia: boolean;
  /** Instante ISO. Todo el día: las 00:00 de su día en Madrid. */
  inicio: string;
  fin: string | null;
  deSocioId: string;
  paraSocioId: string;
  pedidoId: string | null;
  clienteId: string | null;
  enlaceTexto: string | null;
  estado: EstadoTarea;
  hechaEn: string | null;
  vistaEn: string | null;
};

// ---------------------------------------------------------------------------
// Días y horas de Madrid
// ---------------------------------------------------------------------------

const relojMadrid = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_AGENDA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partesMadrid(instante: Date) {
  const p = Object.fromEntries(relojMadrid.formatToParts(instante).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** El día ('yyyy-mm-dd') de un instante, en Madrid. */
export function diaDeMadrid(instante: string | Date): string {
  return partesMadrid(new Date(instante)).dia;
}

/** La hora ('HH:MM') de un instante, en Madrid. */
export function horaDeMadrid(instante: string | Date): string {
  return partesMadrid(new Date(instante)).hora;
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function esDia(v: string): boolean {
  const m = DIA.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function esHora(v: string): boolean {
  return HORA.test(v);
}

/**
 * El instante (ISO, en UTC) de un día y una hora del reloj de Madrid. Tiene en
 * cuenta el horario de verano. Una hora que no existe (la que se salta en
 * marzo) cae en la siguiente que sí.
 */
export function instanteDeMadrid(dia: string, hora = "00:00"): string {
  const md = DIA.exec(dia);
  const mh = HORA.exec(hora);
  if (!md || !mh) throw new Error(`Día u hora no válidos: ${dia} ${hora}`);
  const deseado = Date.UTC(+md[1], +md[2] - 1, +md[3], +mh[1], +mh[2]);
  let t = deseado;
  // Dos vueltas bastan: la diferencia con Madrid es de 1 o 2 horas.
  for (let i = 0; i < 2; i++) {
    const p = partesMadrid(new Date(t));
    const [y, mo, d] = p.dia.split("-").map(Number);
    const [h, mi] = p.hora.split(":").map(Number);
    const visto = Date.UTC(y!, mo! - 1, d!, h!, mi!);
    t += deseado - visto;
  }
  return new Date(t).toISOString();
}

/** Suma días a un día 'yyyy-mm-dd' (sin horas: no le afecta el horario de verano). */
export function sumarDias(dia: string, n: number): string {
  const m = DIA.exec(dia);
  if (!m) throw new Error(`Día no válido: ${dia}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.toISOString().slice(0, 10);
}

/** El lunes de la semana de un día. */
export function lunesDe(dia: string): string {
  const m = DIA.exec(dia);
  if (!m) throw new Error(`Día no válido: ${dia}`);
  const semana = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return sumarDias(dia, -((semana + 6) % 7));
}

/** Días entre dos días (b - a). */
export function diasEntre(a: string, b: string): number {
  const ma = DIA.exec(a);
  const mb = DIA.exec(b);
  if (!ma || !mb) throw new Error(`Día no válido: ${a} / ${b}`);
  return Math.round(
    (Date.UTC(+mb[1], +mb[2] - 1, +mb[3]) - Date.UTC(+ma[1], +ma[2] - 1, +ma[3])) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// Estado de una tarea
// ---------------------------------------------------------------------------

export function diaDeTarea(t: Pick<Tarea, "inicio">): string {
  return diaDeMadrid(t.inicio);
}

/**
 * Vencida: pendiente y de un día anterior a hoy (decisión de Javier). Lo de
 * hoy no se marca como vencido hasta mañana, aunque ya haya pasado su hora.
 */
export function esVencida(t: Pick<Tarea, "estado" | "inicio">, hoy: string): boolean {
  return t.estado === "pendiente" && diaDeTarea(t) < hoy;
}

/** Cuántos días lleva vencida (0 si no lo está). */
export function diasVencida(t: Pick<Tarea, "estado" | "inicio">, hoy: string): number {
  return esVencida(t, hoy) ? diasEntre(diaDeTarea(t), hoy) : 0;
}

/**
 * Nueva para mí: pendiente, me la han mandado y aún no la he abierto. Las que
 * uno se manda a sí mismo nunca son nuevas.
 */
export function esNueva(
  t: Pick<Tarea, "estado" | "paraSocioId" | "deSocioId" | "vistaEn">,
  yo: string | null,
): boolean {
  return (
    !!yo && t.estado === "pendiente" && t.paraSocioId === yo && t.deSocioId !== yo && !t.vistaEn
  );
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

/**
 * «Para»: quién tiene que hacerla. «De»: quién la mandó. Mandan en el
 * calendario y en la lista a la vez.
 *   para: 'yo' | 'otros' (todos menos yo) | 'todos' | un socio
 *   de:   'yo' | 'todos' | un socio
 */
export type FiltroPersona = { para: string; de: string };

export const ATAJOS_PERSONA: readonly { id: string; nombre: string; filtro: FiltroPersona }[] = [
  { id: "mias", nombre: "Para mí", filtro: { para: "yo", de: "todos" } },
  { id: "enviadas", nombre: "Enviadas por mí", filtro: { para: "otros", de: "yo" } },
  { id: "todas", nombre: "Todas", filtro: { para: "todos", de: "todos" } },
];

/** Por defecto cada uno ve lo suyo (decisión de Javier). */
export const FILTRO_PERSONA_INICIAL: FiltroPersona = { para: "yo", de: "todos" };

export function pasaPersona(
  t: Pick<Tarea, "paraSocioId" | "deSocioId">,
  f: FiltroPersona,
  yo: string | null,
): boolean {
  const okPara =
    f.para === "todos" ||
    (f.para === "yo"
      ? t.paraSocioId === yo
      : f.para === "otros"
        ? t.paraSocioId !== yo
        : t.paraSocioId === f.para);
  const okDe = f.de === "todos" || (f.de === "yo" ? t.deSocioId === yo : t.deSocioId === f.de);
  return okPara && okDe;
}

export type Periodo = "todas" | "vencidas" | "hoy" | "semana" | "mes" | "rango";

export type FiltrosLista = {
  texto: string;
  prioridades: Prioridad[];
  categoriaId: string | null;
  estado: EstadoTarea | "todas";
  periodo: Periodo;
  /** Solo con periodo 'rango'. 'yyyy-mm-dd' o vacío. */
  desde: string;
  hasta: string;
  soloNuevas: boolean;
};

export const FILTROS_LISTA_INICIALES: FiltrosLista = {
  texto: "",
  prioridades: [],
  categoriaId: null,
  estado: "pendiente",
  periodo: "todas",
  desde: "",
  hasta: "",
  soloNuevas: false,
};

/** Hay algún filtro de la lista puesto, aparte del estado (que va en pestañas). */
export function hayFiltrosLista(f: FiltrosLista): boolean {
  return (
    !!f.texto.trim() ||
    f.prioridades.length > 0 ||
    !!f.categoriaId ||
    f.periodo !== "todas" ||
    f.soloNuevas
  );
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Todo menos el estado: sirve para contar cuántas hay en cada pestaña. */
export function pasaFiltrosSinEstado(
  t: Tarea,
  f: FiltrosLista,
  ctx: { yo: string | null; hoy: string },
): boolean {
  if (f.prioridades.length && !f.prioridades.includes(t.prioridad)) return false;
  if (f.categoriaId && t.categoriaId !== f.categoriaId) return false;
  if (f.soloNuevas && !esNueva(t, ctx.yo)) return false;
  const q = normalizar(f.texto.trim());
  if (q && !normalizar(`${t.titulo} ${t.enlaceTexto ?? ""} ${t.notas ?? ""}`).includes(q)) {
    return false;
  }
  const dia = diaDeTarea(t);
  switch (f.periodo) {
    case "vencidas":
      return esVencida(t, ctx.hoy);
    case "hoy":
      return dia === ctx.hoy;
    case "semana": {
      const l = lunesDe(ctx.hoy);
      return dia >= l && dia <= sumarDias(l, 6);
    }
    case "mes":
      return dia.slice(0, 7) === ctx.hoy.slice(0, 7);
    case "rango":
      return (!f.desde || dia >= f.desde) && (!f.hasta || dia <= f.hasta);
    default:
      return true;
  }
}

export function pasaFiltros(
  t: Tarea,
  f: FiltrosLista,
  ctx: { yo: string | null; hoy: string },
): boolean {
  return (f.estado === "todas" || t.estado === f.estado) && pasaFiltrosSinEstado(t, f, ctx);
}

export type Orden = { campo: "fecha" | "prioridad"; dir: 1 | -1 };

/**
 * Por fecha: las más antiguas primero (las vencidas arriba), y a igual momento,
 * la más importante. En «Realizadas», las más recientes primero.
 * Por prioridad: la más importante primero y, a igual prioridad, por fecha.
 */
export function ordenarTareas<T extends Tarea>(
  tareas: T[],
  orden: Orden,
  estado: EstadoTarea | "todas" = "pendiente",
): T[] {
  const porFecha = (a: T, b: T) => {
    const d = a.inicio.localeCompare(b.inicio);
    return estado === "hecha" ? -d : d;
  };
  const porPrioridad = (a: T, b: T) => ordenPrioridad(a.prioridad) - ordenPrioridad(b.prioridad);
  return [...tareas].sort((a, b) => {
    const c =
      orden.campo === "prioridad"
        ? porPrioridad(a, b) || porFecha(a, b)
        : porFecha(a, b) || porPrioridad(a, b);
    return c * orden.dir || a.id.localeCompare(b.id);
  });
}

/**
 * Lo que va arriba de la Agenda y en el contador del menú: mis pendientes de
 * hoy, las vencidas y las nuevas. `aviso` cuenta cada tarea una vez.
 */
export function resumenDe(
  tareas: Tarea[],
  yo: string | null,
  hoy: string,
): { hoy: number; vencidas: number; nuevas: number; aviso: number } {
  const mias = tareas.filter((t) => t.estado === "pendiente" && t.paraSocioId === yo);
  const deHoy = (t: Tarea) => diaDeTarea(t) === hoy;
  return {
    hoy: mias.filter(deHoy).length,
    vencidas: mias.filter((t) => esVencida(t, hoy)).length,
    nuevas: mias.filter((t) => esNueva(t, yo)).length,
    aviso: mias.filter((t) => deHoy(t) || esVencida(t, hoy) || esNueva(t, yo)).length,
  };
}

// ---------------------------------------------------------------------------
// Alta y edición
// ---------------------------------------------------------------------------

export type BorradorTarea = {
  titulo: string;
  notas: string;
  categoriaId: string;
  prioridad: Prioridad;
  todoElDia: boolean;
  dia: string;
  horaInicio: string;
  horaFin: string;
  deSocioId: string;
  paraSocioId: string;
  pedidoId: string | null;
  clienteId: string | null;
};

export type ErroresTarea = Partial<
  Record<"titulo" | "categoria" | "enlace" | "dia" | "hora" | "de" | "para", string>
>;

export const LARGO_TITULO = 200;
export const LARGO_NOTAS = 4000;

/** Lo que falta o está mal, con el texto que verá quien la escribe. */
export function validarTarea(
  b: BorradorTarea,
  categoria: Pick<CategoriaAgenda, "enlace"> | null,
): ErroresTarea {
  const e: ErroresTarea = {};
  const titulo = b.titulo.trim();
  if (!titulo) e.titulo = "Escribe qué hay que hacer.";
  else if (titulo.length > LARGO_TITULO) e.titulo = `Como mucho ${LARGO_TITULO} caracteres.`;
  if (!categoria) e.categoria = "Elige una categoría.";
  else if (categoria.enlace === "pedido" && !b.pedidoId) {
    e.enlace = "Elige un pedido de la lista, o cambia la categoría.";
  } else if (categoria.enlace === "cliente" && !b.clienteId) {
    e.enlace = "Elige un cliente de la lista, o cambia la categoría.";
  }
  if (!esDia(b.dia)) e.dia = "Elige el día.";
  if (!b.todoElDia) {
    if (!esHora(b.horaInicio) || !esHora(b.horaFin)) e.hora = "Pon la hora de inicio y de fin.";
    else if (b.horaFin <= b.horaInicio) {
      e.hora = "La hora de fin tiene que ser posterior a la de inicio.";
    }
  }
  if (!b.deSocioId) e.de = "Elige quién la crea.";
  if (!b.paraSocioId) e.para = "Elige para quién es.";
  return e;
}

/** Inicio y fin, como los guarda la base. Solo con un borrador válido. */
export function momentosDe(
  b: Pick<BorradorTarea, "dia" | "todoElDia" | "horaInicio" | "horaFin">,
): {
  inicio: string;
  fin: string | null;
} {
  if (b.todoElDia) return { inicio: instanteDeMadrid(b.dia), fin: null };
  return { inicio: instanteDeMadrid(b.dia, b.horaInicio), fin: instanteDeMadrid(b.dia, b.horaFin) };
}

/** El enlace que se guarda según la categoría: el que no toca, fuera. */
export function enlaceSegunCategoria(
  b: Pick<BorradorTarea, "pedidoId" | "clienteId">,
  categoria: Pick<CategoriaAgenda, "enlace">,
): { pedidoId: string | null; clienteId: string | null } {
  return {
    pedidoId: categoria.enlace === "pedido" ? b.pedidoId : null,
    clienteId: categoria.enlace === "cliente" ? b.clienteId : null,
  };
}

/** Ya existe otra categoría con ese nombre (sin mirar mayúsculas, acentos ni espacios). */
export function nombreCategoriaRepetido(
  nombre: string,
  categorias: Pick<CategoriaAgenda, "id" | "nombre">[],
  exceptoId?: string,
): boolean {
  const n = normalizar(nombre.trim());
  return categorias.some((c) => c.id !== exceptoId && normalizar(c.nombre.trim()) === n);
}
