/**
 * La cabecera del PDF de presupuestos, maquetada: dónde cae cada elemento, a
 * qué tamaño y en cuántas líneas, y dónde empieza el cuerpo.
 *
 * Es la misma cadena que sigue el generador del PDF (`pdf-presupuesto.ts`):
 * logo, datos, título, texto libre y nombre, en ese orden. Lo que se dibuja
 * estorba a lo que viene después, que se encoge o se parte para no pisarlo
 * (`anchoDisponible`, `encajarTexto`). El diseñador de la cabecera la usa para
 * enseñar las cajas, el arranque del cuerpo y el aviso tal como saldrán en el
 * PDF.
 *
 * Lógica pura, en milímetros. Medir y partir los textos lo hace quien llama
 * (`MedidasTexto`), con la letra del PDF.
 */

import {
  ALTO_PAGINA,
  ANCHO_PAGINA,
  type Alineacion,
  type PlantillaPresupuesto,
} from "./plantilla-presupuesto";
import {
  altoLinea,
  anchoDisponible,
  bajada,
  cajaTexto,
  encajarImagen,
  encajarTexto,
  inicioCuerpo,
  subida,
  type Caja,
  type Medir,
  type Partir,
} from "./maqueta-presupuesto";

export type EstiloLetra = "normal" | "bold";

/** Cómo se miden y se parten los textos con la letra del PDF, en cada estilo. */
export type MedidasTexto = {
  medir: (estilo: EstiloLetra) => Medir;
  partir: (estilo: EstiloLetra) => Partir;
};

/** Entre fila y fila de los datos del presupuesto (número, fecha, validez), en mm. */
export const SALTO_FILAS_DATOS = 5.5;
/** El tamaño de las cifras de los datos, en puntos: el que manda en su caja. */
export const TAMANO_CIFRAS_DATOS = 9.5;

/** Un texto de la cabecera ya colocado: su tamaño, sus líneas y lo que ocupa. */
export type TextoMaquetado = { tamano: number; lineas: string[]; caja: Caja };

/** Dónde se ancla un texto de la cabecera. */
export type AnclaTexto = { x: number; y: number; tamano: number; alineacion: Alineacion };

/** Cómo se encaja un texto que no cabe: hasta dónde se encoge y en cuántas líneas. */
export type EncajeTexto = { minimoUnaLinea: number; maxLineas: number; lineasPrevistas: number };

/** El título: en una línea, encogido hasta 6 pt si hace falta. */
export const ENCAJE_TITULO: EncajeTexto = { minimoUnaLinea: 6, maxLineas: 1, lineasPrevistas: 1 };

/** El nombre comercial: nunca cortado; primero más pequeño (hasta 2/3), luego en dos líneas. */
export const encajeNombre = (tamano: number): EncajeTexto => ({
  minimoUnaLinea: (tamano * 2) / 3,
  maxLineas: 2,
  lineasPrevistas: 2,
});

/** Lo que ocupan los datos del presupuesto: de `x` a `x + ancho`, fila a fila. */
export function cajaDatos(datos: { x: number; y: number; ancho: number }, filas: number): Caja {
  return {
    x0: datos.x,
    y0: datos.y - subida(TAMANO_CIFRAS_DATOS),
    x1: datos.x + datos.ancho,
    y1: datos.y + (filas - 1) * SALTO_FILAS_DATOS + bajada(TAMANO_CIFRAS_DATOS),
  };
}

const anchoMayor = (lineas: readonly string[], tamano: number, medir: Medir) =>
  Math.max(0, ...lineas.map((l) => medir(l, tamano)));

/**
 * Un texto de la cabecera (el título o el nombre) encajado en el sitio que le
 * dejan los `obstaculos`: más pequeño o en más líneas, nunca cortado. Null si
 * no tiene nada que escribir.
 */
export function encajarEnCabecera(
  t: AnclaTexto,
  texto: string,
  estilo: EstiloLetra,
  encaje: EncajeTexto,
  obstaculos: readonly Caja[],
  medidas: MedidasTexto,
): TextoMaquetado | null {
  const banda = {
    y0: t.y - subida(t.tamano),
    y1: t.y + (encaje.lineasPrevistas - 1) * altoLinea(t.tamano) + bajada(t.tamano),
  };
  const ancho = anchoDisponible(t, banda, obstaculos);
  const medir = medidas.medir(estilo);
  const { tamano, lineas } = encajarTexto(
    texto,
    ancho,
    {
      tamano: t.tamano,
      minimo: 6,
      minimoUnaLinea: encaje.minimoUnaLinea,
      maxLineas: encaje.maxLineas,
    },
    medir,
    medidas.partir(estilo),
  );
  if (!lineas.length) return null;
  const caja = cajaTexto(
    t.x,
    t.y,
    anchoMayor(lineas, tamano, medir),
    lineas.length,
    tamano,
    t.alineacion,
  );
  return { tamano, lineas, caja };
}

/**
 * El texto libre de la cabecera: no se encoge, se parte en las líneas que
 * hagan falta para no pisar los `obstaculos`. Null si no tiene párrafos.
 */
export function partirTextoLibre(
  t: AnclaTexto,
  parrafos: readonly string[],
  obstaculos: readonly Caja[],
  medidas: MedidasTexto,
): TextoMaquetado | null {
  if (!parrafos.length) return null;
  const banda = {
    y0: t.y - subida(t.tamano),
    y1: t.y + parrafos.length * altoLinea(t.tamano) + bajada(t.tamano),
  };
  const ancho = anchoDisponible(t, banda, obstaculos);
  const partir = medidas.partir("normal");
  const lineas = parrafos.flatMap((l) => partir(l, ancho, t.tamano));
  if (!lineas.length) return null;
  const caja = cajaTexto(
    t.x,
    t.y,
    anchoMayor(lineas, t.tamano, medidas.medir("normal")),
    lineas.length,
    t.tamano,
    t.alineacion,
  );
  return { tamano: t.tamano, lineas, caja };
}

/** La cabecera maquetada: lo que sale de cada elemento (null si no sale) y dónde empieza el cuerpo. */
export type CabeceraMaquetada = {
  /** Lo que ocupa la imagen del logo encajada en su caja (no la caja entera). */
  logo: Caja | null;
  datos: Caja | null;
  titulo: TextoMaquetado | null;
  texto: TextoMaquetado | null;
  nombre: TextoMaquetado | null;
  /** Todo lo dibujado, en el orden en que se dibuja. */
  dibujado: Caja[];
  /** Dónde empieza el cuerpo (`inicioCuerpo`). */
  inicio: number;
};

/**
 * Maqueta la cabecera como el PDF: logo, datos, título, texto libre y nombre,
 * cada uno en el sitio que le dejan los anteriores.
 *
 * - El logo sale si la plantilla lo pone y hay logo (`contenido.logo`, su
 *   tamaño natural o solo su proporción), encajado en su caja sin deformarse.
 * - Los datos, si la plantilla los pone y tienen alguna fila.
 * - El título, si la plantilla lo pone y tiene texto.
 * - El texto libre, si la plantilla lo pone y le queda algún párrafo.
 * - El nombre, «siempre», o en «auto» si no ha salido el logo.
 */
export function maquetarCabecera(
  cab: PlantillaPresupuesto["cabecera"],
  contenido: {
    /** El tamaño del logo que se pone (cuenta la proporción); null si no hay logo. */
    logo: { ancho: number; alto: number } | null;
    /** Las filas de los datos que salen: las de etiqueta no vacía. */
    filasDatos: number;
    /** Los párrafos del texto libre, con las variables ya puestas (`rellenarTexto`). */
    parrafos: readonly string[];
    /** El nombre comercial que sale. */
    nombre: string;
  },
  medidas: MedidasTexto,
): CabeceraMaquetada {
  // Lo dibujado hasta cada momento: lo que estorba al siguiente.
  const dibujado: Caja[] = [];

  const logo = cab.logo.mostrar && contenido.logo ? encajarImagen(cab.logo, contenido.logo) : null;
  if (logo) dibujado.push(logo);

  const datos =
    cab.datos.mostrar && contenido.filasDatos > 0
      ? cajaDatos(cab.datos, contenido.filasDatos)
      : null;
  if (datos) dibujado.push(datos);

  const titulo =
    cab.titulo.mostrar && cab.titulo.texto.trim()
      ? encajarEnCabecera(cab.titulo, cab.titulo.texto, "bold", ENCAJE_TITULO, dibujado, medidas)
      : null;
  if (titulo) dibujado.push(titulo.caja);

  const texto = cab.texto.mostrar
    ? partirTextoLibre(cab.texto, contenido.parrafos, dibujado, medidas)
    : null;
  if (texto) dibujado.push(texto.caja);

  const n = cab.nombre;
  const nombre =
    n.mostrar === "siempre" || (n.mostrar === "auto" && !logo)
      ? encajarEnCabecera(n, contenido.nombre, "bold", encajeNombre(n.tamano), dibujado, medidas)
      : null;
  if (nombre) dibujado.push(nombre.caja);

  return { logo, datos, titulo, texto, nombre, dibujado, inicio: inicioCuerpo(cab.alto, dibujado) };
}

/** Un rango de posiciones para el punto (x, y) de un elemento. */
export type RangoPosicion = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Hasta dónde puede ir el punto (x, y) de un elemento sin que su caja salga
 * del papel: la caja va con el punto, así que se descuenta lo que sobresale
 * por cada lado. Dentro, además, de su `rango` de siempre. Es el mismo límite
 * al arrastrar, con las flechas y en los campos X e Y; `alto` es hasta dónde
 * puede bajar la caja (al arrastrar, el fondo del dibujo).
 */
export function limitesEnPapel(
  punto: { x: number; y: number },
  caja: Caja | null,
  rango: RangoPosicion,
  { ancho = ANCHO_PAGINA, alto = ALTO_PAGINA }: { ancho?: number; alto?: number } = {},
): RangoPosicion {
  const c = caja ?? { x0: punto.x, y0: punto.y, x1: punto.x, y1: punto.y };
  const minX = Math.max(rango.minX, punto.x - c.x0);
  const maxX = Math.min(rango.maxX, ancho - (c.x1 - punto.x));
  const minY = Math.max(rango.minY, punto.y - c.y0);
  const maxY = Math.min(rango.maxY, alto - (c.y1 - punto.y));
  // Una caja más grande que el papel: se queda pegada arriba a la izquierda.
  return { minX, maxX: Math.max(minX, maxX), minY, maxY: Math.max(minY, maxY) };
}
