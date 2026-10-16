/**
 * Los límites de cada campo de la plantilla, sacados de la propia
 * `normalizarPlantilla` en vez de copiados a mano.
 *
 * La plantilla se normaliza al leerla y al guardarla: un número fuera de rango
 * se recorta a su mínimo o a su máximo, y un texto largo se corta. Así que,
 * para saber el rango de cada número, basta con pasarle una plantilla con
 * todos los números enormes (sale el máximo de cada uno) y otra con todos muy
 * negativos (sale el mínimo). Con los textos, igual: uno larguísimo sale
 * cortado a su largo máximo. Si un rango cambia en el dominio, el editor lo
 * sigue sin tocar nada aquí.
 */

import {
  normalizarPlantilla,
  PLANTILLA_POR_DEFECTO,
  type PlantillaPresupuesto,
} from "@/dominio/plantilla-presupuesto";

/** La misma forma, con cada hoja (número, texto, sí/no) cambiada por `f`. Las listas, tal cual. */
function cambiarHojas(v: unknown, f: (hoja: unknown) => unknown): unknown {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cambiarHojas(x, f)]));
  }
  return f(v);
}

const sondear = (f: (hoja: unknown) => unknown): PlantillaPresupuesto =>
  normalizarPlantilla(cambiarHojas(PLANTILLA_POR_DEFECTO, f));

/** Cada número de la plantilla, en su mínimo. */
export const MINIMOS = sondear((h) => (typeof h === "number" ? -1e9 : h));
/** Cada número de la plantilla, en su máximo. */
export const MAXIMOS = sondear((h) => (typeof h === "number" ? 1e9 : h));
/**
 * Cada texto, en su largo máximo: `LARGOS.cabecera.nombre.texto.length`. Solo
 * vale para los textos libres; los colores y las opciones no son textos libres.
 */
export const LARGOS = sondear((h) => (typeof h === "string" ? "x".repeat(5000) : h));

/** Un número dentro de [min, max]. */
export const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Al medio milímetro: lo que se mueve un elemento al arrastrarlo. */
export const aMedioMm = (v: number) => Math.round(v * 2) / 2;

/** Lo que guarda la plantilla: una décima (igual que `normalizarPlantilla`). */
export const aDecima = (v: number) => Math.round(v * 10) / 10;
