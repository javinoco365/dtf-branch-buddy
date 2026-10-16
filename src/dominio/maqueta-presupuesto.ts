/**
 * Las cuentas de la maqueta del PDF de presupuestos: cuánto sitio tiene cada
 * texto de la cabecera, a qué tamaño cabe un nombre, dónde va el pie según
 * cuántas líneas lleve, qué ancho necesita cada columna de la tabla y cuándo
 * la caja de aceptación tiene que pasar de página con lo que la precede.
 *
 * Lógica pura, en milímetros sobre un A4 vertical. El ancho de un texto lo
 * mide quien llama (`Medir`, `Partir`), porque depende de la fuente del PDF;
 * aquí solo se decide con esas medidas. La plantilla y sus límites están en
 * `plantilla-presupuesto.ts`.
 */

import { ALTO_PAGINA, ANCHO_PAGINA, MARGEN, type Alineacion } from "./plantilla-presupuesto";

/** Milímetros por punto tipográfico. */
export const MM_POR_PUNTO = 25.4 / 72;
/** El interlineado con que jsPDF separa las líneas de un mismo texto. */
export const INTERLINEADO = 1.15;

/** Distancia entre dos líneas base de un texto de `tamano` puntos. */
export const altoLinea = (tamano: number) => tamano * MM_POR_PUNTO * INTERLINEADO;
/** Lo que sube una mayúscula sobre la línea base (Helvetica: 0,72 em). */
export const subida = (tamano: number) => tamano * MM_POR_PUNTO * 0.72;
/** Lo que baja una letra con rabo (g, p, j) por debajo de la línea base. */
export const bajada = (tamano: number) => tamano * MM_POR_PUNTO * 0.22;

/** Un rectángulo en la página: de (x0, y0) arriba a la izquierda a (x1, y1). */
export type Caja = { x0: number; y0: number; x1: number; y1: number };

/** El ancho en mm de un texto a `tamano` puntos. */
export type Medir = (texto: string, tamano: number) => number;
/** Un texto partido en líneas que quepan en `ancho` mm a `tamano` puntos. */
export type Partir = (texto: string, ancho: number, tamano: number) => string[];

/** Dónde empieza (por la izquierda) un texto de `ancho` mm anclado en `x`. */
export function inicioTexto(x: number, ancho: number, alineacion: Alineacion): number {
  if (alineacion === "centro") return x - ancho / 2;
  if (alineacion === "derecha") return x - ancho;
  return x;
}

/**
 * Lo que ocupa un texto: `y` es la línea base de la primera línea (como en la
 * plantilla) y `ancho`, el de su línea más larga.
 */
export function cajaTexto(
  x: number,
  y: number,
  ancho: number,
  lineas: number,
  tamano: number,
  alineacion: Alineacion,
): Caja {
  const x0 = inicioTexto(x, ancho, alineacion);
  return {
    x0,
    y0: y - subida(tamano),
    x1: x0 + ancho,
    y1: y + Math.max(0, lineas - 1) * altoLinea(tamano) + bajada(tamano),
  };
}

/**
 * El ancho del que dispone un texto anclado en `x`: hasta el margen de la
 * página por el lado hacia el que crece (los dos, si va centrado), y sin
 * pisar lo que ya hay en la cabecera a su altura (`banda`), dejando `hueco` mm.
 * Lo que está detrás del ancla no estorba: si el usuario monta un texto
 * encima del logo, es su diseño, y lo ve en la vista previa.
 */
export function anchoDisponible(
  ancla: { x: number; alineacion: Alineacion },
  banda: { y0: number; y1: number },
  obstaculos: readonly Caja[],
  { hueco = 6, minimo = 15 }: { hueco?: number; minimo?: number } = {},
): number {
  const { x, alineacion } = ancla;
  let izquierda = Math.min(MARGEN, x);
  let derecha = Math.max(ANCHO_PAGINA - MARGEN, x);
  for (const o of obstaculos) {
    if (o.y0 >= banda.y1 || o.y1 <= banda.y0) continue;
    if (alineacion !== "derecha" && o.x0 > x) derecha = Math.min(derecha, o.x0 - hueco);
    if (alineacion !== "izquierda" && o.x1 < x) izquierda = Math.max(izquierda, o.x1 + hueco);
  }
  const ancho =
    alineacion === "izquierda"
      ? derecha - x
      : alineacion === "derecha"
        ? x - izquierda
        : 2 * Math.min(x - izquierda, derecha - x);
  return Math.max(minimo, ancho);
}

/**
 * Cómo se alinea el logo dentro de su caja, según dónde esté la caja: en el
 * centro de la página, centrado; en la mitad derecha, a la derecha; si no, a
 * la izquierda. Así un logo estrecho en una caja ancha queda donde se espera.
 */
export function alineacionDeCaja(x: number, ancho: number): Alineacion {
  const centro = x + ancho / 2;
  if (Math.abs(centro - ANCHO_PAGINA / 2) <= 8) return "centro";
  return centro > ANCHO_PAGINA / 2 ? "derecha" : "izquierda";
}

/**
 * Dónde se dibuja una imagen de `imagen.ancho` × `imagen.alto` (en cualquier
 * unidad: solo cuenta la proporción) encajada en su caja sin deformarla:
 * pegada arriba y alineada según `alineacionDeCaja`.
 */
export function encajarImagen(
  caja: { x: number; y: number; ancho: number; alto: number },
  imagen: { ancho: number; alto: number },
): Caja {
  if (!(imagen.ancho > 0) || !(imagen.alto > 0)) {
    return { x0: caja.x, y0: caja.y, x1: caja.x, y1: caja.y };
  }
  const escala = Math.min(caja.ancho / imagen.ancho, caja.alto / imagen.alto);
  const ancho = imagen.ancho * escala;
  const alto = imagen.alto * escala;
  const alineacion = alineacionDeCaja(caja.x, caja.ancho);
  const x0 =
    alineacion === "centro"
      ? caja.x + (caja.ancho - ancho) / 2
      : alineacion === "derecha"
        ? caja.x + caja.ancho - ancho
        : caja.x;
  return { x0, y0: caja.y, x1: x0 + ancho, y1: caja.y + alto };
}

/**
 * El tamaño y las líneas con que un texto cabe en `ancho` mm, sin cortarlo:
 *
 * 1. En una línea, reduciendo la letra desde `tamano` hasta `minimoUnaLinea`.
 * 2. Si no, en `maxLineas` líneas como mucho, al mayor tamaño que lo permita
 *    (bajando de medio en medio punto hasta `minimo`).
 * 3. Si ni así cabe, a `minimo` con todas las líneas que hagan falta: mejor una
 *    línea de más que un nombre cortado sin avisar.
 */
export function encajarTexto(
  texto: string,
  ancho: number,
  opciones: { tamano: number; minimoUnaLinea: number; minimo: number; maxLineas: number },
  medir: Medir,
  partir: Partir,
): { tamano: number; lineas: string[] } {
  const { tamano, maxLineas } = opciones;
  const minimo = Math.min(opciones.minimo, tamano);
  const minimoUnaLinea = Math.max(minimo, Math.min(opciones.minimoUnaLinea, tamano));
  const limpio = texto.trim();
  if (!limpio) return { tamano, lineas: [] };

  // El ancho de un texto es proporcional a su tamaño: se calcula de una vez.
  const anchoATamano = medir(limpio, tamano);
  if (anchoATamano <= ancho) return { tamano, lineas: [limpio] };
  const unaLinea = Math.floor(((tamano * ancho) / anchoATamano) * 10) / 10;
  if (unaLinea >= minimoUnaLinea && medir(limpio, unaLinea) <= ancho) {
    return { tamano: unaLinea, lineas: [limpio] };
  }

  for (let t = tamano; t >= minimo - 1e-9; t -= 0.5) {
    const lineas = partir(limpio, ancho, t);
    if (lineas.length <= maxLineas && lineas.every((l) => medir(l, t) <= ancho + 0.01)) {
      return { tamano: t, lineas };
    }
  }
  return { tamano: minimo, lineas: partir(limpio, ancho, minimo) };
}

/**
 * Dónde va el pie según sus líneas y su tamaño, y hasta dónde puede llegar lo
 * de encima. Crece hacia arriba: la última línea nunca baja de 7,5 mm del
 * borde. Con el pie de siempre (una o dos líneas a 7 pt) sale lo de antes:
 * raya a 282 mm, texto a 286,5 mm y el cuerpo hasta 273 mm.
 */
export function maquetaPie(
  lineas: number,
  tamano: number,
): {
  /** La línea base de la primera línea del pie. */
  primeraLinea: number;
  /** La raya que separa el pie del cuerpo. */
  raya: number;
  /** Hasta dónde llega el texto del cuerpo. */
  finCuerpo: number;
  /** Hasta dónde llega la tabla de líneas. */
  finTabla: number;
} {
  const n = Math.max(1, lineas);
  const ultimaPermitida = ALTO_PAGINA - 7.5;
  const primeraLinea = Math.min(ALTO_PAGINA - 10.5, ultimaPermitida - (n - 1) * altoLinea(tamano));
  const raya = Math.min(ALTO_PAGINA - 15, primeraLinea - subida(tamano) - 2.7);
  return { primeraLinea, raya, finCuerpo: raya - 9, finTabla: raya - 13 };
}

/**
 * Dónde empieza el cuerpo: debajo de la raya de la cabecera (`alto`) y nunca
 * por encima de lo más bajo que se haya dibujado en ella.
 */
export function inicioCuerpo(alto: number, cabecera: readonly Caja[]): number {
  const fondo = cabecera.reduce((m, c) => Math.max(m, c.y1), 0);
  return Math.max(alto + 7, fondo + 6);
}

export type ColumnaCifra = "cantidad" | "precio" | "iva" | "importe";

/** Los anchos de siempre de las columnas de cifras, y hasta dónde pueden crecer. */
export const COLUMNAS_CIFRAS: Record<ColumnaCifra, { base: number; tope: number }> = {
  cantidad: { base: 25, tope: 34 },
  precio: { base: 28, tope: 40 },
  iva: { base: 16, tope: 20 },
  importe: { base: 28, tope: 36 },
};

/**
 * El ancho de cada columna de cifras: el de siempre, o más si su contenido lo
 * necesita (hasta su tope), para que un precio como «2,35 €/unidades» no se
 * parta por la mitad de una palabra. La descripción se queda el resto, y
 * nunca menos de `minimoDescripcion` mm: si no llega, las columnas que han
 * crecido devuelven lo que haga falta, en proporción.
 */
export function anchosColumnas(
  necesarios: Partial<Record<ColumnaCifra, number>>,
  anchoTabla: number,
  minimoDescripcion = 60,
): { descripcion: number } & Partial<Record<ColumnaCifra, number>> {
  const columnas = (Object.keys(COLUMNAS_CIFRAS) as ColumnaCifra[]).filter(
    (c) => necesarios[c] !== undefined,
  );
  const anchos = new Map<ColumnaCifra, number>();
  for (const c of columnas) {
    const { base, tope } = COLUMNAS_CIFRAS[c];
    anchos.set(c, Math.min(tope, Math.max(base, necesarios[c] ?? base)));
  }
  const base = columnas.reduce((s, c) => s + COLUMNAS_CIFRAS[c].base, 0);
  const extra = columnas.reduce((s, c) => s + anchos.get(c)! - COLUMNAS_CIFRAS[c].base, 0);
  const sobra = anchoTabla - base - minimoDescripcion;
  if (extra > 0 && extra > sobra) {
    const factor = Math.max(0, sobra) / extra;
    for (const c of columnas) {
      const b = COLUMNAS_CIFRAS[c].base;
      anchos.set(c, b + (anchos.get(c)! - b) * factor);
    }
  }
  const usado = columnas.reduce((s, c) => s + anchos.get(c)!, 0);
  return { descripcion: anchoTabla - usado, ...Object.fromEntries(anchos) };
}

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

// La identidad de DTI: azul marino y azul cielo, los mismos que la aplicación.
export const MARINO: RGB = [42, 34, 96];
export const CIELO: RGB = [0, 168, 228];
/** El texto de siempre: casi negro. */
export const TINTA: RGB = [15, 23, 42];
export const BLANCO: RGB = [255, 255, 255];

/** «#2a2260» o «#22a» a RGB; null si no es un color en hexadecimal. */
export function colorHex(css: string | null | undefined): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((css ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** El contraste entre dos colores, de 1 a 21 (WCAG). */
export function contraste(a: RGB, b: RGB): number {
  const luminancia = (c: RGB) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Los colores del documento.
 *
 * - Con un principal elegido en la plantilla, ese, aunque sea claro: es la
 *   marca. Lo que se escribe encima (la cabecera de la tabla, el TOTAL) pasa a
 *   tinta oscura si en blanco no se leería, y los títulos que van en ese color
 *   sobre el papel, también, si no llegan a 3:1.
 * - Sin él, el color de la tienda o de la marca si el blanco se lee bien encima
 *   (4,5:1); si no, o si no tiene, el azul marino de la casa con el azul cielo
 *   de acento. Es lo de antes de existir la plantilla.
 * - El acento (la raya de la cabecera), el de la plantilla; si no, el principal
 *   (o el azul cielo con el azul de la casa).
 */
export function coloresDocumento(o: {
  principal?: string | null;
  acento?: string | null;
  base?: string | null;
}): { principal: RGB; acento: RGB; sobrePrincipal: RGB; textoPrincipal: RGB } {
  const elegido = colorHex(o.principal);
  const base = colorHex(o.base);
  const deLaBase = !elegido && base && contraste(base, BLANCO) >= 4.5 ? base : null;
  const principal = elegido ?? deLaBase ?? MARINO;
  const acento = colorHex(o.acento) ?? (elegido || deLaBase ? principal : CIELO);
  return {
    principal,
    acento,
    sobrePrincipal: contraste(principal, BLANCO) >= 4.5 ? BLANCO : TINTA,
    textoPrincipal: contraste(principal, BLANCO) >= 3 ? principal : TINTA,
  };
}

// ---------------------------------------------------------------------------
// Paso de página
// ---------------------------------------------------------------------------

/** Las líneas de un bloque largo que pasan de página con la caja de aceptación. */
export const LINEAS_CON_ACEPTACION = 3;

/**
 * Si lo que va justo antes de la aceptación tiene que pasar de página con
 * ella: sí cuando las dos cosas juntas son cortas (caben de sobra en media
 * página). Así la caja de firma nunca se queda sola en una página nueva,
 * separada de las condiciones que acepta. Con un bloque largo no: ese pasa de
 * página línea a línea, y lo que pasa con la caja son sus últimas líneas
 * (`LINEAS_CON_ACEPTACION`).
 */
export function juntarConAceptacion(
  altoAnterior: number,
  altoAceptacion: number,
  altoUtil: number,
): boolean {
  return altoAnterior > 0 && altoAnterior + altoAceptacion <= altoUtil / 2;
}
