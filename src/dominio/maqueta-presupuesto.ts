/**
 * Las cuentas de la maqueta del PDF de presupuestos: cuánto sitio tiene cada
 * texto de la cabecera, a qué tamaño cabe un nombre, cómo se colocan las
 * pastillas de los datos, dónde va la banda del pie según cuántas líneas
 * lleve, qué ancho necesita cada columna de la tabla y cómo se reparten las
 * condiciones en dos columnas.
 *
 * Lógica pura, en milímetros sobre un A4 vertical. El ancho de un texto lo
 * mide quien llama (`Medir`, `Partir`), porque depende de la fuente del PDF;
 * aquí solo se decide con esas medidas. La plantilla y sus límites están en
 * `plantilla-presupuesto.ts`.
 */

import { ALTO_PAGINA, ANCHO_PAGINA, MARGEN, type Alineacion } from "./plantilla-presupuesto";
import type { DocumentoPresupuesto } from "./presupuestos";
import { redondear } from "./importes";

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

/**
 * Parte un texto en líneas de hasta `ancho` mm, por palabras, con la medida
 * que se le pase: para letras que jsPDF no sabe partir solas (las espaciadas).
 * Una palabra que no cabe sola va en su línea.
 */
export function partirConMedida(
  texto: string,
  ancho: number,
  tamano: number,
  medir: Medir,
): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (actual && medir(prueba, tamano) > ancho) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

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

/** Lo que mide como poco la banda del pie. */
export const ALTO_BANDA_PIE = 12;

/**
 * La banda de color del pie según sus líneas y su tamaño, y hasta dónde puede
 * llegar lo de encima. Va pegada al borde de abajo y crece hacia arriba si el
 * texto no cabe en 12 mm; el texto, centrado en ella. Con el pie de siempre
 * (una línea a 8 pt): banda desde 285 mm, texto a 292 mm, cuerpo hasta 282,5 mm.
 */
export function maquetaPie(
  lineas: number,
  tamano: number,
): {
  /** Donde empieza la banda. */
  arriba: number;
  /** La línea base de la primera línea del texto. */
  primeraLinea: number;
  /** Hasta dónde llega el cuerpo. */
  finCuerpo: number;
  /** Hasta dónde llega la tabla de líneas. */
  finTabla: number;
} {
  const n = Math.max(1, lineas);
  const bloque = (n - 1) * altoLinea(tamano) + subida(tamano);
  const alto = Math.max(ALTO_BANDA_PIE, bloque + 7);
  const arriba = ALTO_PAGINA - alto;
  const primeraLinea = arriba + (alto - bloque) / 2 + subida(tamano);
  return { arriba, primeraLinea, finCuerpo: arriba - 2.5, finTabla: arriba - 6 };
}

/**
 * Dónde empieza el cuerpo: 5 mm por debajo de donde acaba la cabecera (`fin`:
 * la banda o, si la hay, la cinta) y nunca por encima de lo más bajo que se
 * haya dibujado en ella, con 6 mm de aire.
 */
export function inicioCuerpo(fin: number, cabecera: readonly Caja[]): number {
  const fondo = cabecera.reduce((m, c) => Math.max(m, c.y1), 0);
  return Math.max(fin + 5, fondo + 6);
}

// ---------------------------------------------------------------------------
// Las pastillas de los datos: número, fecha y validez
// ---------------------------------------------------------------------------

/** Lo alta que es cada pastilla, en mm. */
export const ALTO_PASTILLA = 6.9;
/** Lo que se ve de la sombra de cada pastilla, abajo a la derecha. */
export const SOMBRA_PASTILLA = 0.5;
/** El hueco entre dos pastillas de la misma fila. */
export const HUECO_PASTILLAS = 3;
/** De la letra al borde de la pastilla, a cada lado. */
export const RELLENO_PASTILLA = 3.7;
/** De una fila de pastillas a la siguiente. */
export const SALTO_PASTILLAS = ALTO_PASTILLA + 2.5;
/** El tamaño de la letra de las pastillas, en puntos. */
export const TAMANO_PASTILLA = 8;

/**
 * Cómo se colocan las pastillas entre `x` y `x + ancho`: en su orden, en filas
 * alineadas a la derecha; la que no cabe en una fila pasa a la siguiente.
 * `textos` es el ancho de la letra de cada una, a `TAMANO_PASTILLA`. Si la más
 * ancha no cabe sola, todas encogen por igual (`escala`).
 */
export function maquetaPastillas(
  textos: readonly number[],
  caja: { x: number; ancho: number },
): {
  escala: number;
  pastillas: { x: number; fila: number; ancho: number }[];
  filas: number;
} {
  if (!textos.length) return { escala: 1, pastillas: [], filas: 0 };
  const mayor = Math.max(...textos);
  const escala = Math.min(1, Math.max(0.5, (caja.ancho - 2 * RELLENO_PASTILLA) / (mayor || 1)));
  const anchos = textos.map((t) => t * escala + 2 * RELLENO_PASTILLA);
  const filas: number[][] = [[]];
  let usado = 0;
  anchos.forEach((a, i) => {
    const fila = filas[filas.length - 1];
    const necesita = (fila.length ? usado + HUECO_PASTILLAS : 0) + a;
    if (fila.length && necesita > caja.ancho + 1e-9) {
      filas.push([i]);
      usado = a;
    } else {
      fila.push(i);
      usado = necesita;
    }
  });
  const pastillas: { x: number; fila: number; ancho: number }[] = [];
  filas.forEach((fila, f) => {
    const largo = fila.reduce((s, i) => s + anchos[i], 0) + (fila.length - 1) * HUECO_PASTILLAS;
    let x = caja.x + caja.ancho - largo;
    for (const i of fila) {
      pastillas[i] = { x, fila: f, ancho: anchos[i] };
      x += anchos[i] + HUECO_PASTILLAS;
    }
  });
  return { escala, pastillas, filas: filas.length };
}

/** Lo que ocupan `filas` filas de pastillas que empiezan en `y`, sombra incluida. */
export function altoPastillas(filas: number): number {
  return filas ? (filas - 1) * SALTO_PASTILLAS + ALTO_PASTILLA + SOMBRA_PASTILLA : 0;
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
  cantidad: { base: 22, tope: 34 },
  precio: { base: 27, tope: 40 },
  iva: { base: 16, tope: 20 },
  importe: { base: 27, tope: 36 },
};

/** El ancho de la columna de la referencia (01, 02…). */
export const ANCHO_REF = 16;

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

// La identidad de DTI: azul noche, azul marino, azul cielo y naranja.
/** La banda de la cabecera y del pie, y la cabecera de la tabla. */
export const NOCHE: RGB = [24, 19, 65];
/** Los títulos sobre el papel. */
export const MARINO: RGB = [42, 33, 96];
export const CIELO: RGB = [0, 168, 228];
export const NARANJA: RGB = [251, 131, 0];
/** El texto de siempre: casi negro. También los bordes. */
export const TINTA: RGB = [20, 22, 31];
/** Las etiquetas y las notas. */
export const GRIS: RGB = [91, 96, 117];
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
 * Los colores del documento: los de la plantilla y, los que deja vacíos, los
 * de la casa. El principal, aunque sea claro, es la marca: lo que se escribe
 * encima pasa a tinta oscura si en blanco no se leería, y los títulos que van
 * en ese color sobre el papel, también, si no llegan a 3:1. Lo mismo con el
 * acento (la cinta) y el destacado (el TOTAL).
 */
export function coloresDocumento(o: {
  principal?: string | null;
  acento?: string | null;
  destacado?: string | null;
}): {
  banda: RGB;
  sobreBanda: RGB;
  titulos: RGB;
  acento: RGB;
  sobreAcento: RGB;
  destacado: RGB;
  sobreDestacado: RGB;
} {
  const elegido = colorHex(o.principal);
  const banda = elegido ?? NOCHE;
  const acento = colorHex(o.acento) ?? CIELO;
  const destacado = colorHex(o.destacado) ?? NARANJA;
  const encima = (fondo: RGB) => (contraste(fondo, TINTA) >= 4.5 ? TINTA : BLANCO);
  return {
    banda,
    sobreBanda: contraste(banda, BLANCO) >= 4.5 ? BLANCO : TINTA,
    titulos: elegido ? (contraste(elegido, BLANCO) >= 3 ? elegido : TINTA) : MARINO,
    acento,
    sobreAcento: encima(acento),
    destacado,
    sobreDestacado: encima(destacado),
  };
}

// ---------------------------------------------------------------------------
// El resumen y las condiciones
// ---------------------------------------------------------------------------

/**
 * Con una sola línea, lo que cuesta cada unidad con el IVA: el total entre la
 * cantidad, redondeado al céntimo. Null si hay más de una línea (el envío
 * cuenta como una), si la cantidad no es positiva o si no hay total.
 */
export function unitarioConIva(
  d: Pick<DocumentoPresupuesto, "lineas" | "total">,
): { cantidad: number; unidad: string; precio: number; conIva: number } | null {
  if (d.lineas.length !== 1) return null;
  const [l] = d.lineas;
  if (!(l.cantidad > 0) || !(d.total > 0)) return null;
  return {
    cantidad: l.cantidad,
    unidad: l.unidad,
    precio: l.precio_unitario,
    conIva: redondear(d.total / l.cantidad),
  };
}

/**
 * Reparte bloques de `altos` mm en dos columnas, en su orden: los primeros en
 * la izquierda hasta la mitad del alto total (más o menos), el resto en la
 * derecha. Devuelve cuántos van en la izquierda.
 */
export function repartirEnDosColumnas(altos: readonly number[]): number {
  const total = altos.reduce((s, a) => s + a, 0);
  let mejor = altos.length;
  let diferencia = Infinity;
  let izquierda = 0;
  for (let i = 0; i <= altos.length; i++) {
    const d = Math.abs(izquierda - (total - izquierda));
    // A igualdad, la izquierda con más: se lee primero.
    if (d <= diferencia + 1e-9) {
      diferencia = d;
      mejor = i;
    }
    if (i < altos.length) izquierda += altos[i];
  }
  return Math.max(Math.min(altos.length, 1), mejor);
}
