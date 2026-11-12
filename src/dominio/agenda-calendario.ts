/**
 * El calendario de la Agenda: qué días enseña cada vista y qué tareas van en
 * cada día. Lógica pura, con días 'yyyy-mm-dd' de Madrid (src/dominio/agenda.ts).
 *
 * Vistas (decisión de Javier): Día es una lista; Semana y Mes son casillas,
 * una por día; Año son doce meses pequeños con una marca en los días con
 * tareas pendientes. Las semanas empiezan en lunes.
 */
import {
  diaDeTarea,
  lunesDe,
  ordenPrioridad,
  sumarDias,
  type Prioridad,
  type Tarea,
} from "./agenda";

export type VistaCalendario = "dia" | "semana" | "mes" | "anio";

export const VISTAS: readonly { id: VistaCalendario; nombre: string }[] = [
  { id: "dia", nombre: "Día" },
  { id: "semana", nombre: "Semana" },
  { id: "mes", nombre: "Mes" },
  { id: "anio", nombre: "Año" },
];

export function esVista(v: unknown): v is VistaCalendario {
  return VISTAS.some((x) => x.id === v);
}

/** El primer día del mes de un día. */
export function primeroDelMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

/** Días que tiene el mes de un día. */
export function diasDelMesDe(dia: string): number {
  const [y, m] = dia.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Los 7 días de la semana (de lunes a domingo) de un día. */
export function semanaDe(dia: string): string[] {
  const l = lunesDe(dia);
  return Array.from({ length: 7 }, (_, i) => sumarDias(l, i));
}

/**
 * Las casillas del mes: semanas completas de lunes a domingo, desde la que
 * contiene el día 1 hasta la que contiene el último. Incluye días de los
 * meses de al lado (para rellenar la primera y la última semana).
 */
export function casillasDelMes(dia: string): string[] {
  const primero = primeroDelMes(dia);
  const ultimo = sumarDias(primero, diasDelMesDe(dia) - 1);
  const desde = lunesDe(primero);
  const hasta = sumarDias(lunesDe(ultimo), 6);
  const casillas: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) casillas.push(d);
  return casillas;
}

/** Mueve la fecha de referencia una vista adelante (+1) o atrás (-1). */
export function moverReferencia(dia: string, vista: VistaCalendario, n: 1 | -1): string {
  const [y, m, d] = dia.split("-").map(Number);
  switch (vista) {
    case "dia":
      return sumarDias(dia, n);
    case "semana":
      return sumarDias(dia, 7 * n);
    case "mes": {
      const f = new Date(Date.UTC(y!, m! - 1 + n, 1));
      return f.toISOString().slice(0, 10);
    }
    case "anio":
      return `${y! + n}-${String(m).padStart(2, "0")}-${d === 29 && m === 2 ? "28" : String(d).padStart(2, "0")}`;
  }
}

/** El rango de días [desde, hasta] que enseña una vista. */
export function rangoDeVista(
  dia: string,
  vista: VistaCalendario,
): { desde: string; hasta: string } {
  switch (vista) {
    case "dia":
      return { desde: dia, hasta: dia };
    case "semana": {
      const s = semanaDe(dia);
      return { desde: s[0]!, hasta: s[6]! };
    }
    case "mes": {
      const c = casillasDelMes(dia);
      return { desde: c[0]!, hasta: c[c.length - 1]! };
    }
    case "anio":
      return { desde: `${dia.slice(0, 4)}-01-01`, hasta: `${dia.slice(0, 4)}-12-31` };
  }
}

/**
 * Las tareas de cada día del rango, ya ordenadas: primero las de todo el día,
 * luego por hora; las realizadas al final; a igual momento, la más importante.
 * Las canceladas no salen en el calendario (quedan en la lista).
 */
export function tareasPorDia<T extends Tarea>(
  tareas: T[],
  desde: string,
  hasta: string,
): Map<string, T[]> {
  const porDia = new Map<string, T[]>();
  for (const t of tareas) {
    if (t.estado === "cancelada") continue;
    const d = diaDeTarea(t);
    if (d < desde || d > hasta) continue;
    const lista = porDia.get(d);
    if (lista) lista.push(t);
    else porDia.set(d, [t]);
  }
  for (const lista of porDia.values()) {
    lista.sort(
      (a, b) =>
        Number(b.todoElDia) - Number(a.todoElDia) ||
        Number(a.estado === "hecha") - Number(b.estado === "hecha") ||
        a.inicio.localeCompare(b.inicio) ||
        ordenPrioridad(a.prioridad) - ordenPrioridad(b.prioridad),
    );
  }
  return porDia;
}

/** La prioridad más importante entre las pendientes de un día (para el Año). */
export function prioridadMasAlta(tareas: Tarea[]): Prioridad | null {
  let mejor: Prioridad | null = null;
  for (const t of tareas) {
    if (t.estado !== "pendiente") continue;
    if (mejor === null || ordenPrioridad(t.prioridad) < ordenPrioridad(mejor)) mejor = t.prioridad;
  }
  return mejor;
}

const NOMBRE_MES = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" });

function deDia(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
}

/** «noviembre», en minúscula, del mes de un día. */
export function nombreDelMes(dia: string): string {
  return NOMBRE_MES.format(deDia(dia));
}

/**
 * El título de la vista: «Jueves, 12 de noviembre de 2026», «9 – 15 de
 * noviembre de 2026», «Noviembre de 2026» o «2026». Solo la primera letra en
 * mayúscula: nada de «Noviembre De 2026».
 */
export function tituloDeVista(dia: string, vista: VistaCalendario): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const anio = dia.slice(0, 4);
  switch (vista) {
    case "dia":
      return cap(
        new Intl.DateTimeFormat("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(deDia(dia)),
      );
    case "semana": {
      const s = semanaDe(dia);
      const a = s[0]!;
      const b = s[6]!;
      const dA = Number(a.slice(8));
      const dB = Number(b.slice(8));
      if (a.slice(0, 7) === b.slice(0, 7)) {
        return `${dA} – ${dB} de ${nombreDelMes(b)} de ${b.slice(0, 4)}`;
      }
      if (a.slice(0, 4) === b.slice(0, 4)) {
        return `${dA} de ${nombreDelMes(a)} – ${dB} de ${nombreDelMes(b)} de ${b.slice(0, 4)}`;
      }
      return `${dA} de ${nombreDelMes(a)} de ${a.slice(0, 4)} – ${dB} de ${nombreDelMes(b)} de ${b.slice(0, 4)}`;
    }
    case "mes":
      return `${cap(nombreDelMes(dia))} de ${anio}`;
    case "anio":
      return anio;
  }
}
