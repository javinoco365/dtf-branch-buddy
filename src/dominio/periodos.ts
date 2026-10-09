/**
 * El periodo que se está mirando en una pantalla, y con qué se compara.
 *
 * Un solo selector para toda la aplicación: hoy, semana, mes, trimestre, año,
 * los últimos 7, 30 o 90 días, unas fechas libres o todo. Cada pantalla elige
 * cuáles ofrece y cuál sale por defecto; las cuentas son las mismas en todas.
 *
 * La comparación es justa: si el periodo está en curso, solo cuenta hasta hoy
 * y se compara con el mismo trozo del periodo anterior. El 5 de octubre,
 * «octubre» va contra «del 1 al 5 de septiembre» y no contra septiembre
 * entero, que siempre ganaría.
 *
 * Lógica pura: fechas en la hora local del navegador, sin base de datos.
 */

import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  getQuarter,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subYears,
} from "date-fns";
import { es } from "date-fns/locale";
import { leerFecha } from "./filtros";

export type TipoPeriodo =
  | "hoy"
  | "semana"
  | "mes"
  | "trimestre"
  | "anio"
  | "ultimos7"
  | "ultimos30"
  | "ultimos90"
  | "libre"
  | "todo";

/** En el orden en que salen en el desplegable. */
export const TIPOS_PERIODO: readonly { valor: TipoPeriodo; etiqueta: string }[] = [
  { valor: "hoy", etiqueta: "Día" },
  { valor: "semana", etiqueta: "Semana" },
  { valor: "mes", etiqueta: "Mes" },
  { valor: "trimestre", etiqueta: "Trimestre" },
  { valor: "anio", etiqueta: "Año" },
  { valor: "ultimos7", etiqueta: "Últimos 7 días" },
  { valor: "ultimos30", etiqueta: "Últimos 30 días" },
  { valor: "ultimos90", etiqueta: "Últimos 90 días" },
  { valor: "libre", etiqueta: "Fechas libres" },
  { valor: "todo", etiqueta: "Todo" },
];

/**
 * Los de un cuadro de mando: todos menos «todo», porque un cuadro compara y
 * dibuja por días, y eso necesita un principio y un fin.
 */
export const PERIODOS_CUADRO: readonly TipoPeriodo[] = TIPOS_PERIODO.map((t) => t.valor).filter(
  (t) => t !== "todo",
);

export function esTipoPeriodo(v: unknown): v is TipoPeriodo {
  return TIPOS_PERIODO.some((t) => t.valor === v);
}

export type Comparar = "anterior" | "anio" | "no";

export const OPCIONES_COMPARAR: readonly { valor: Comparar; etiqueta: string }[] = [
  { valor: "anterior", etiqueta: "Frente al periodo anterior" },
  { valor: "anio", etiqueta: "Frente al año pasado" },
  { valor: "no", etiqueta: "Sin comparar" },
];

export function esComparar(v: unknown): v is Comparar {
  return v === "anterior" || v === "anio" || v === "no";
}

/** Del primer instante de `desde` al último de `hasta`, los dos incluidos. */
export type Rango = { desde: Date; hasta: Date };

/**
 * Lo elegido. `ref` es el día que manda (el mes que contiene, el último de
 * los «últimos 30 días»…); `desde` y `hasta` solo cuentan en fechas libres.
 */
export type Seleccion = { tipo: TipoPeriodo; ref: Date; desde?: Date; hasta?: Date };

const DIAS_ULTIMOS: Partial<Record<TipoPeriodo, number>> = {
  ultimos7: 7,
  ultimos30: 30,
  ultimos90: 90,
};

/** El rango de fechas de lo elegido; `null` es «todo», sin límite. */
export function rangoDe(sel: Seleccion): Rango | null {
  const { ref } = sel;
  switch (sel.tipo) {
    case "hoy":
      return { desde: startOfDay(ref), hasta: endOfDay(ref) };
    case "semana":
      return {
        desde: startOfWeek(ref, { weekStartsOn: 1 }),
        hasta: endOfWeek(ref, { weekStartsOn: 1 }),
      };
    case "mes":
      return { desde: startOfMonth(ref), hasta: endOfMonth(ref) };
    case "trimestre":
      return { desde: startOfQuarter(ref), hasta: endOfQuarter(ref) };
    case "anio":
      return { desde: startOfYear(ref), hasta: endOfYear(ref) };
    case "ultimos7":
    case "ultimos30":
    case "ultimos90": {
      const n = DIAS_ULTIMOS[sel.tipo]!;
      return { desde: startOfDay(addDays(ref, -(n - 1))), hasta: endOfDay(ref) };
    }
    case "libre": {
      const a = sel.desde ?? ref;
      const b = sel.hasta ?? a;
      const [d, h] = a <= b ? [a, b] : [b, a];
      return { desde: startOfDay(d), hasta: endOfDay(h) };
    }
    case "todo":
      return null;
  }
}

/** Días naturales que abarca un rango, contando los dos extremos. */
export function diasDe(r: Rango): number {
  return differenceInCalendarDays(r.hasta, r.desde) + 1;
}

/** El periodo siguiente (`1`) o el anterior (`-1`) del mismo tipo. */
export function moverSeleccion(sel: Seleccion, dir: -1 | 1): Seleccion {
  const { ref } = sel;
  switch (sel.tipo) {
    case "hoy":
      return { ...sel, ref: addDays(ref, dir) };
    case "semana":
      return { ...sel, ref: addWeeks(ref, dir) };
    case "mes":
      return { ...sel, ref: addMonths(ref, dir) };
    case "trimestre":
      return { ...sel, ref: addQuarters(ref, dir) };
    case "anio":
      return { ...sel, ref: addYears(ref, dir) };
    case "ultimos7":
    case "ultimos30":
    case "ultimos90":
      return { ...sel, ref: addDays(ref, dir * DIAS_ULTIMOS[sel.tipo]!) };
    case "libre": {
      const r = rangoDe(sel)!;
      const n = diasDe(r) * dir;
      return { ...sel, desde: addDays(r.desde, n), hasta: addDays(startOfDay(r.hasta), n) };
    }
    case "todo":
      return sel;
  }
}

/** Si tiene sentido moverse con las flechas. */
export function esNavegable(tipo: TipoPeriodo): boolean {
  return tipo !== "todo";
}

const mayuscula = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/**
 * Unas fechas en corto: «5 oct 2026», «1–5 sep 2026», «28 sep – 4 oct 2026»
 * o «15 dic 2025 – 10 ene 2026».
 */
export function textoRango(r: Rango): string {
  const { desde: d, hasta: h } = r;
  if (isSameDay(d, h)) return format(d, "d MMM yyyy", { locale: es });
  if (d.getFullYear() !== h.getFullYear()) {
    return `${format(d, "d MMM yyyy", { locale: es })} – ${format(h, "d MMM yyyy", { locale: es })}`;
  }
  if (d.getMonth() !== h.getMonth()) {
    return `${format(d, "d MMM", { locale: es })} – ${format(h, "d MMM yyyy", { locale: es })}`;
  }
  return `${format(d, "d", { locale: es })}–${format(h, "d MMM yyyy", { locale: es })}`;
}

/** Cómo se llama lo elegido, para la cabecera: «Octubre 2026», «4.º trimestre 2026»… */
export function etiquetaPeriodo(sel: Seleccion, hoy: Date = new Date()): string {
  const r = rangoDe(sel);
  switch (sel.tipo) {
    case "hoy":
      if (isSameDay(sel.ref, hoy)) return "Hoy";
      if (isSameDay(sel.ref, addDays(hoy, -1))) return "Ayer";
      return mayuscula(format(sel.ref, "EEEE d MMM yyyy", { locale: es }));
    case "mes":
      return mayuscula(format(sel.ref, "LLLL yyyy", { locale: es }));
    case "trimestre":
      return `${getQuarter(sel.ref)}.º trimestre ${sel.ref.getFullYear()}`;
    case "anio":
      return String(sel.ref.getFullYear());
    case "ultimos7":
    case "ultimos30":
    case "ultimos90":
      if (isSameDay(sel.ref, hoy)) return `Últimos ${DIAS_ULTIMOS[sel.tipo]} días`;
      return textoRango(r!);
    case "todo":
      return "Todo";
    default:
      return textoRango(r!);
  }
}

/** Nombre del periodo con el que se compara, cuando es un periodo entero. */
function nombreEntero(sel: Seleccion, hoy: Date): string {
  switch (sel.tipo) {
    case "hoy":
      return isSameDay(sel.ref, addDays(hoy, -1)) ? "ayer" : textoRango(rangoDe(sel)!);
    case "mes":
      return format(sel.ref, "LLLL yyyy", { locale: es });
    case "trimestre":
      return `${getQuarter(sel.ref)}T ${sel.ref.getFullYear()}`;
    case "anio":
      return String(sel.ref.getFullYear());
    default:
      return textoRango(rangoDe(sel)!);
  }
}

export type Comparacion = {
  /** Lo que se mide: el periodo, cortado en hoy si está en curso. */
  actual: Rango;
  /** Contra qué se mide. */
  previo: Rango;
  /** Para «+12 % frente a …»: «septiembre 2026», «1–5 sep 2026», «2025». */
  etiqueta: string;
  /** El periodo está en curso y los dos rangos van cortados. */
  parcial: boolean;
};

/**
 * Los dos rangos que se comparan. `null` sin comparación, o con «todo», que
 * no tiene anterior.
 *
 * - «anterior»: el periodo inmediatamente anterior del mismo tipo (el mes
 *   pasado, la semana pasada, los 30 días de antes…).
 * - «anio»: las mismas fechas un año antes.
 *
 * Si el periodo contiene hoy, el actual se corta en hoy y el previo se corta
 * en el mismo número de días.
 */
export function compararCon(
  sel: Seleccion,
  modo: Comparar,
  hoy: Date = new Date(),
): Comparacion | null {
  const r = rangoDe(sel);
  if (!r || modo === "no") return null;

  const finHoy = endOfDay(hoy);
  const parcial = r.desde <= finHoy && r.hasta > finHoy;
  const actual: Rango = { desde: r.desde, hasta: parcial ? finHoy : r.hasta };

  let previoEntero: Rango;
  let nombre: string;
  if (modo === "anterior") {
    const antes = moverSeleccion(sel, -1);
    previoEntero = rangoDe(antes)!;
    nombre = nombreEntero(antes, hoy);
  } else {
    // Mismo periodo del año pasado. Para los periodos de calendario se
    // recalcula (febrero de 2028 acaba el 29, el de 2027 el 28); para el
    // resto, las mismas fechas un año antes.
    const calendario = ["mes", "trimestre", "anio", "hoy"].includes(sel.tipo);
    const antes: Seleccion = { ...sel, ref: subYears(sel.ref, 1) };
    previoEntero = calendario
      ? rangoDe(antes)!
      : { desde: subYears(r.desde, 1), hasta: endOfDay(subYears(startOfDay(r.hasta), 1)) };
    nombre = calendario ? nombreEntero(antes, hoy) : textoRango(previoEntero);
  }

  if (!parcial) return { actual, previo: previoEntero, etiqueta: nombre, parcial };

  const transcurridos = diasDe(actual);
  const finPrevio = endOfDay(addDays(previoEntero.desde, transcurridos - 1));
  const previo: Rango = {
    desde: previoEntero.desde,
    hasta: finPrevio < previoEntero.hasta ? finPrevio : previoEntero.hasta,
  };
  return { actual, previo, etiqueta: textoRango(previo), parcial };
}

// ---------------------------------------------------------------------------
// En la dirección
// ---------------------------------------------------------------------------

/** Lo que se guarda en la dirección. Vacío es «lo de por defecto». */
export type SeleccionUrl = { periodo: string; fecha: string; desde: string; hasta: string };

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Lo elegido según la dirección. Sin `periodo`, el de por defecto; con fechas
 * `desde`/`hasta` y sin periodo (los enlaces viejos de la caja), fechas
 * libres. Sin `fecha`, hoy.
 */
export function leerSeleccion(
  url: Partial<SeleccionUrl>,
  porDefecto: TipoPeriodo,
  hoy: Date = new Date(),
): Seleccion {
  const conFechas = !!url.desde || !!url.hasta;
  const tipo: TipoPeriodo = esTipoPeriodo(url.periodo)
    ? url.periodo
    : conFechas
      ? "libre"
      : porDefecto;
  const ref = leerFecha(url.fecha, hoy);
  if (tipo !== "libre") return { tipo, ref };
  const desde = url.desde ? leerFecha(url.desde, hoy) : undefined;
  const hasta = url.hasta ? leerFecha(url.hasta, hoy) : undefined;
  return { tipo, ref, desde: desde ?? hasta ?? hoy, hasta: hasta ?? desde ?? hoy };
}

/**
 * Para la dirección. La fecha de referencia solo se escribe si el periodo no
 * es el que contiene hoy, así la dirección de «este mes» queda limpia y sigue
 * siendo «este mes» mañana.
 */
export function escribirSeleccion(sel: Seleccion, hoy: Date = new Date()): SeleccionUrl {
  if (sel.tipo === "libre") {
    const r = rangoDe(sel)!;
    return { periodo: "libre", fecha: "", desde: dia(r.desde), hasta: dia(r.hasta) };
  }
  if (sel.tipo === "todo") return { periodo: "todo", fecha: "", desde: "", hasta: "" };
  const a = rangoDe(sel)!;
  const b = rangoDe({ tipo: sel.tipo, ref: hoy })!;
  const fecha = a.desde.getTime() === b.desde.getTime() ? "" : dia(sel.ref);
  return { periodo: sel.tipo, fecha, desde: "", hasta: "" };
}

/** Si una fecha cae dentro del rango; sin rango («todo»), siempre. */
export function enRango(fecha: Date | string | null | undefined, r: Rango | null): boolean {
  if (!r) return true;
  if (!fecha) return false;
  const d = typeof fecha === "string" ? fechaDeTexto(fecha) : fecha;
  return d >= r.desde && d <= r.hasta;
}

/** El día ('yyyy-mm-dd') de una fecha, en la hora del navegador. */
export function diaDeFecha(d: Date): string {
  return dia(d);
}

/**
 * El primer y el último día de un rango ('yyyy-mm-dd'), en la hora del
 * navegador como todo este fichero: con ellos se compara el día de un pedido
 * (ver dia-pedido.ts). `null` si el rango está vacío porque empieza después de
 * acabar, como el que piden las pantallas que no comparan.
 */
export function diasDelRango(r: Rango): { desde: string; hasta: string } | null {
  if (r.desde.getTime() > r.hasta.getTime()) return null;
  return { desde: dia(r.desde), hasta: dia(r.hasta) };
}

/**
 * «2026-10-05» es ese día en hora local, no a medianoche UTC: si no, en
 * Madrid el día 5 caería el 4 a las dos de la madrugada y saldría del rango
 * del día 5. Con hora («2026-10-05T10:00:00Z»), la hora que diga.
 */
function fechaDeTexto(texto: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(texto);
}

export type Tramo = Rango & { etiqueta: string };

/**
 * Los puntos de la gráfica de un periodo: un día por barra hasta dos meses,
 * un mes por barra a partir de ahí (un año de días son 365 barras que no se
 * leen).
 */
export function tramosGrafica(r: Rango): { por: "dia" | "mes"; tramos: Tramo[] } {
  if (diasDe(r) <= 62) {
    return {
      por: "dia",
      tramos: eachDayOfInterval({ start: r.desde, end: r.hasta }).map((d) => ({
        desde: startOfDay(d),
        hasta: endOfDay(d),
        etiqueta: format(d, "d MMM", { locale: es }),
      })),
    };
  }
  const varios = r.desde.getFullYear() !== r.hasta.getFullYear();
  return {
    por: "mes",
    tramos: eachMonthOfInterval({ start: r.desde, end: r.hasta }).map((m) => ({
      desde: m < r.desde ? r.desde : startOfMonth(m),
      hasta: endOfMonth(m) > r.hasta ? r.hasta : endOfMonth(m),
      etiqueta: format(m, varios ? "MMM yy" : "MMM", { locale: es }),
    })),
  };
}
