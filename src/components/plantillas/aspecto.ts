/**
 * Cómo pinta el diseñador la cabecera y el pie: los mismos colores, tamaños y
 * reglas de visibilidad que el PDF, aproximados en pantalla. Lo exacto es la
 * vista previa del PDF de al lado; esto es para colocar las cosas a ojo.
 *
 * Las reglas salen del dominio (`maqueta-presupuesto.ts`), las mismas que usa
 * el generador del PDF: aquí solo se pasan a lo que entiende SVG.
 */

import type { Alineacion } from "@/dominio/plantilla-presupuesto";
import {
  INTERLINEADO,
  MM_POR_PUNTO,
  alineacionDeCaja,
  coloresDocumento,
  type RGB,
} from "@/dominio/maqueta-presupuesto";
import type { MedidasTexto } from "@/dominio/maqueta-cabecera";
import type { Plantilla } from "./editor";

/** Un punto tipográfico en milímetros: los tamaños de letra van en puntos, las posiciones en mm. */
export const MM_POR_PT = MM_POR_PUNTO;

/** Lo que baja cada renglón respecto al tamaño de la letra (el de jsPDF). */
export const INTERLINEA = INTERLINEADO;

/** Las letras del PDF (`registrarFuentesNavegador`), y parecidas mientras cargan. */
export const FUENTE_PDF = "'PDF Inter', Inter, Helvetica, Arial, sans-serif";
export const FUENTE_TITULAR = "'PDF Anton', Anton, Impact, 'Arial Narrow', sans-serif";

/** Los grises del PDF. */
export const GRIS_TEXTO = "rgb(20 22 31)";
export const GRIS_SUAVE = "rgb(91 96 117)";
export const GRIS_LINEA = "rgb(216 221 233)";

const css = (c: RGB) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Los colores con que sale la cabecera, con las mismas reglas que el PDF
 * (`coloresDocumento`): la banda, lo que se escribe encima, el acento (la
 * cinta, el antetítulo, la sombra de las pastillas) y el destacado (la raya
 * del antetítulo y la pastilla de la validez).
 */
export function coloresDiseno(plantilla: Plantilla) {
  const c = coloresDocumento(plantilla.colores);
  return {
    banda: css(c.banda),
    sobreBanda: css(c.sobreBanda),
    acento: css(c.acento),
    sobreAcento: css(c.sobreAcento),
    destacado: css(c.destacado),
    sobreDestacado: css(c.sobreDestacado),
  };
}

/** Qué color sale si se deja vacío cada uno, en hexadecimal: los de la casa. */
export function coloresHeredados(): { principal: string; acento: string; destacado: string } {
  const c = coloresDocumento({});
  return { principal: hex(c.banda), acento: hex(c.acento), destacado: hex(c.destacado) };
}

/** Del alineado de la plantilla al de SVG. */
export const ANCLA: Record<Alineacion, "start" | "middle" | "end"> = {
  izquierda: "start",
  centro: "middle",
  derecha: "end",
};

/**
 * Cómo se encaja el logo en su caja, como en el PDF (`alineacionDeCaja`):
 * arriba y, según dónde esté la caja, a la izquierda, centrado o a la derecha.
 */
export function encajeLogo(caja: { x: number; ancho: number }): string {
  const a = alineacionDeCaja(caja.x, caja.ancho);
  return `${a === "centro" ? "xMid" : a === "derecha" ? "xMax" : "xMin"}YMin meet`;
}

/**
 * Parte un texto en renglones de hasta `ancho` mm, a ojo: un carácter de
 * Helvetica ocupa de media algo más de medio cuerpo. Solo para enseñarlo en
 * el diseñador; el PDF corta con las medidas exactas de la letra.
 */
export function partirAprox(texto: string, ancho: number, tamanoPt: number): string[] {
  const porCaracter = tamanoPt * MM_POR_PT * 0.52;
  const caben = Math.max(8, Math.floor(ancho / porCaracter));
  const renglones: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (prueba.length > caben && actual) {
      renglones.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}

/**
 * Medidas a ojo (`partirAprox`): solo mientras no han llegado las de la letra
 * del PDF (`useMedidasPdf`), que son las que valen.
 */
export const MEDIDAS_A_OJO: MedidasTexto = {
  medir: (estilo) => (texto, tamanoPt) =>
    texto.length * tamanoPt * MM_POR_PT * (estilo === "titular" ? 0.42 : 0.55),
  partir: () => partirAprox,
};
