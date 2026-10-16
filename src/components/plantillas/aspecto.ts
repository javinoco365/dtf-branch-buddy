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
import type { Plantilla } from "./editor";

/** Un punto tipográfico en milímetros: los tamaños de letra van en puntos, las posiciones en mm. */
export const MM_POR_PT = MM_POR_PUNTO;

/** Lo que baja cada renglón respecto al tamaño de la letra (el de jsPDF). */
export const INTERLINEA = INTERLINEADO;

/** La letra del PDF (Helvetica) y las que miden igual. */
export const FUENTE_PDF = "Helvetica, Arial, 'Liberation Sans', sans-serif";

/** Los grises del PDF. */
export const GRIS_TEXTO = "rgb(15 23 42)";
export const GRIS_SUAVE = "rgb(100 116 139)";
export const GRIS_LINEA = "rgb(226 232 240)";

/** Entre fila y fila de los datos del presupuesto (número, fecha, validez), en mm. */
export const SALTO_DATOS = 5.5;

const css = (c: RGB) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Los colores con que sale la cabecera, con las mismas reglas que el PDF
 * (`coloresDocumento`): `texto` es el del nombre y el título (el principal, o
 * tinta oscura si es tan claro que no se lee sobre el papel) y `acento`, el de
 * la línea.
 */
export function coloresDiseno(
  plantilla: Plantilla,
  colorBase: string | null,
): { texto: string; acento: string } {
  const c = coloresDocumento({
    principal: plantilla.colores.principal,
    acento: plantilla.colores.acento,
    base: colorBase,
  });
  return { texto: css(c.textoPrincipal), acento: css(c.acento) };
}

/**
 * Qué color sale si el principal o el de la línea se dejan vacíos, en
 * hexadecimal, y de dónde viene: para enseñarlo junto al campo.
 */
export function coloresHeredados(
  plantilla: Plantilla,
  colorBase: string | null,
): {
  principal: string;
  principalDeLaBase: boolean;
  acento: string;
  acentoEsPrincipal: boolean;
} {
  const sinPrincipal = coloresDocumento({ base: colorBase });
  const conPrincipal = coloresDocumento({
    principal: plantilla.colores.principal,
    base: colorBase,
  });
  return {
    principal: hex(sinPrincipal.principal),
    // El de la base solo vale si el blanco se lee encima; si no, sale el de la casa.
    principalDeLaBase: hex(sinPrincipal.principal) === hex(sinPrincipal.acento),
    acento: hex(conPrincipal.acento),
    acentoEsPrincipal: hex(conPrincipal.acento) === hex(conPrincipal.principal),
  };
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
 * Si el nombre comercial sale en la cabecera: «siempre», «nunca» o, en «auto»,
 * solo cuando no hay logo que poner.
 */
export function nombreVisible(plantilla: Plantilla, hayLogo: boolean): boolean {
  const modo = plantilla.cabecera.nombre.mostrar;
  return modo === "siempre" || (modo === "auto" && !(plantilla.cabecera.logo.mostrar && hayLogo));
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
