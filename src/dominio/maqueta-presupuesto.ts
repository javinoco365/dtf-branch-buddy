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
 * Dónde anclar un texto de la cabecera para que no se salga del papel.
 *
 * Si por el lado hacia el que crece no le quedan ni `minimo` mm hasta el
 * margen (está pegado a él, o fuera), el ancla se mete hacia dentro lo justo
 * para que el texto quepa a su ancho natural (`natural`, el de una línea a su
 * tamaño; nunca más que el ancho entre márgenes). Es lo que pasa al cambiar
 * solo la alineación de un texto que estaba en una guía: el título, a la
 * derecha en 194, pasado «a la izquierda» acaba en 194 en vez de empezar ahí
 * estrujado en 15 mm y fuera del margen. Con sitio, el ancla no se toca: lo que
 * no quepa lo encoge o lo parte quien llama, con `anchoDisponible`.
 */
export function anclaEnPagina(
  x: number,
  alineacion: Alineacion,
  natural: number,
  minimo = 15,
): number {
  const izquierda = MARGEN;
  const derecha = ANCHO_PAGINA - MARGEN;
  const largo = Math.min(Math.max(0, natural), derecha - izquierda);
  if (alineacion === "izquierda") {
    return derecha - x >= minimo ? x : Math.min(x, derecha - largo);
  }
  if (alineacion === "derecha") {
    return x - izquierda >= minimo ? x : Math.max(x, izquierda + largo);
  }
  if (2 * Math.min(x - izquierda, derecha - x) >= minimo) return x;
  return x < ANCHO_PAGINA / 2
    ? Math.max(x, izquierda + largo / 2)
    : Math.min(x, derecha - largo / 2);
}

/**
 * Un tramo de `largo` mm que empieza en `inicio`, metido entero en [0, total]
 * (el ancho o el alto del papel): se desplaza hacia dentro lo justo y, si ni
 * así cabe, se queda en el total. Si ya está dentro, sale tal cual.
 */
export function tramoEnPagina(
  inicio: number,
  largo: number,
  total: number = ANCHO_PAGINA,
): { inicio: number; largo: number } {
  const l = Math.min(Math.max(0, largo), total);
  return { inicio: Math.min(Math.max(0, inicio), total - l), largo: l };
}

/**
 * Cuánto bajar (o subir, si sale negativo) un texto para que no se salga del
 * papel por arriba ni por abajo. `y` es la línea base de su primera línea y
 * `alto`, lo que hay de ella a la última. Arriba cuenta lo más alto que llega
 * la letra (una mayúscula con tilde: 0,93 em), no solo la mayúscula. Dentro
 * del papel, 0.
 */
export function ajusteVertical(y: number, alto: number, tamano: number): number {
  const arriba = y - tamano * MM_POR_PUNTO * 0.93;
  const abajo = y + Math.max(0, alto) + bajada(tamano);
  return tramoEnPagina(arriba, abajo - arriba, ALTO_PAGINA).inicio - arriba;
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

/**
 * Cómo se colocan las filas del bloque de datos (número, fecha y validez): la
 * etiqueta a la izquierda y el valor alineado a la derecha, en `ancho` mm. Los
 * anchos de la etiqueta y del valor de cada fila los mide quien llama, a su
 * tamaño de siempre.
 *
 * La etiqueta y el valor nunca se pisan. Si alguna fila no cabe con `hueco` mm
 * entre los dos, todo el bloque encoge por igual lo que pida la más apretada,
 * hasta `escalaMinima`. Una fila que ni así cabe se parte: la etiqueta en su
 * línea y el valor en la siguiente, a la escala del bloque o menos si hace falta
 * para no pasar de `ancho`; las filas de después bajan. Si todo cabe, no cambia
 * nada: una fila cada `paso` mm, a tamaño completo.
 */
export function maquetaDatos(
  filas: readonly { etiqueta: number; valor: number }[],
  ancho: number,
  {
    hueco = 3,
    escalaMinima = 0.75,
    paso = 5.5,
    tamanoEtiqueta = 8.5,
    tamanoValor = 9.5,
  }: {
    hueco?: number;
    escalaMinima?: number;
    paso?: number;
    tamanoEtiqueta?: number;
    tamanoValor?: number;
  } = {},
): {
  /** Lo que encoge todo el bloque (1: nada). */
  escala: number;
  /**
   * Por fila: la línea base de la etiqueta y la del valor, contadas desde la
   * de la primera fila, y lo que encoge cada uno.
   */
  filas: { y: number; yValor: number; escalaEtiqueta: number; escalaValor: number }[];
  /** De la primera línea base a la última. */
  alto: number;
} {
  const juntas = (f: { etiqueta: number; valor: number }) => f.etiqueta + f.valor;
  const necesaria = (f: { etiqueta: number; valor: number }) =>
    juntas(f) > 0 ? (ancho - hueco) / juntas(f) : 1;
  // Las filas que caben en una línea marcan la escala; si no cabe ninguna, la mínima.
  const posibles = filas.map(necesaria).filter((k) => k >= escalaMinima);
  const escala = filas.length && !posibles.length ? escalaMinima : Math.min(1, ...posibles);
  let y = 0;
  const colocadas = filas.map((f) => {
    if (juntas(f) * escala + hueco <= ancho + 1e-9) {
      const fila = { y, yValor: y, escalaEtiqueta: escala, escalaValor: escala };
      y += paso;
      return fila;
    }
    const escalaEtiqueta = Math.min(escala, f.etiqueta > 0 ? ancho / f.etiqueta : 1);
    const escalaValor = Math.min(escala, f.valor > 0 ? ancho / f.valor : 1);
    const yValor =
      y + altoLinea(Math.max(tamanoEtiqueta * escalaEtiqueta, tamanoValor * escalaValor));
    const fila = { y, yValor, escalaEtiqueta, escalaValor };
    y = yValor + paso;
    return fila;
  });
  return {
    escala,
    filas: colocadas,
    alto: colocadas.length ? colocadas[colocadas.length - 1].yValor : 0,
  };
}

/**
 * A qué presupuesto pertenece cada página desde la segunda, arriba: el título
 * tal como lo escribió el usuario («PRESUPUESTO DTF», «Oferta»), sin tocarle
 * las mayúsculas, que pueden ser siglas, y el número. El título de por defecto
 * de la plantilla («PRESUPUESTO»), o ninguno, sale como siempre: «Presupuesto».
 */
export function referenciaPaginas(titulo: string, numero: string): string {
  const t = titulo.trim().replace(/\s+/g, " ");
  const nombre = !t || t === "PRESUPUESTO" ? "Presupuesto" : t;
  return [nombre, numero.trim()].filter(Boolean).join(" ");
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
