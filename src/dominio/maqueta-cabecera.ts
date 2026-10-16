/**
 * La cabecera del PDF de presupuestos, maquetada: dónde cae cada elemento, a
 * qué tamaño y en cuántas líneas, y dónde empieza el cuerpo.
 *
 * La usan el generador del PDF (`pdf-presupuesto.ts`) y el diseñador del
 * editor: logo, datos, título, antetítulo y nombre, en ese orden. Lo que se
 * dibuja estorba a lo que viene después, que se encoge o se parte para no
 * pisarlo (`anchoDisponible`, `encajarTexto`).
 *
 * Lógica pura, en milímetros. Medir y partir los textos lo hace quien llama
 * (`MedidasTexto`), con la letra del PDF.
 */

import {
  ALTO_CINTA,
  ALTO_PAGINA,
  ANCHO_PAGINA,
  type Alineacion,
  type PlantillaPresupuesto,
} from "./plantilla-presupuesto";
import {
  ALTO_PASTILLA,
  MM_POR_PUNTO,
  SALTO_PASTILLAS,
  TAMANO_PASTILLA,
  ajusteVertical,
  altoLinea,
  altoPastillas,
  anchoDisponible,
  anclaEnPagina,
  bajada,
  cajaTexto,
  encajarImagen,
  encajarTexto,
  inicioCuerpo,
  maquetaPastillas,
  subida,
  tramoEnPagina,
  type Caja,
  type Medir,
  type Partir,
} from "./maqueta-presupuesto";

/**
 * Las letras de la cabecera: `titular` es Anton (el título y el nombre);
 * `rotulo`, Inter negrita en mayúsculas espaciadas (el antetítulo); `bold` y
 * `normal`, Inter.
 */
export type EstiloLetra = "normal" | "bold" | "titular" | "rotulo";

/** Cómo se miden y se parten los textos con la letra del PDF, en cada estilo. */
export type MedidasTexto = {
  medir: (estilo: EstiloLetra) => Medir;
  partir: (estilo: EstiloLetra) => Partir;
};

/** El espacio de más entre letra y letra del antetítulo, en mm. */
export const ESPACIADO_ROTULO = 0.45;
/** La raya de color delante del antetítulo: lo que mide y el hueco hasta el texto. */
export const RAYA_ANTETITULO = { largo: 7, hueco: 3 };

/** Lo que sube una mayúscula de Anton sobre la línea base: es más alta que la de Inter. */
const subidaTitular = (tamano: number) => tamano * MM_POR_PUNTO * 0.86;

/** Un texto de la cabecera ya colocado: dónde se ancla, su tamaño, sus líneas y lo que ocupa. */
export type TextoMaquetado = {
  x: number;
  y: number;
  tamano: number;
  lineas: string[];
  caja: Caja;
};

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

/** Las pastillas de los datos colocadas: cada una con su texto, y lo que ocupan todas. */
export type DatosMaquetados = {
  pastillas: { texto: string; x: number; y: number; ancho: number }[];
  tamano: number;
  caja: Caja;
};

/**
 * Las pastillas de los datos (número, fecha, validez) en su caja: la caja,
 * entera dentro del papel; las pastillas, en filas alineadas a la derecha
 * (`maquetaPastillas`), desde `y` hacia abajo. Null si no hay ninguna.
 */
export function maquetarDatos(
  datos: { x: number; y: number; ancho: number },
  textos: readonly string[],
  medir: Medir,
): DatosMaquetados | null {
  if (!textos.length) return null;
  const { inicio: x, largo: ancho } = tramoEnPagina(datos.x, datos.ancho, ANCHO_PAGINA);
  const m = maquetaPastillas(
    textos.map((t) => medir(t, TAMANO_PASTILLA)),
    { x, ancho },
  );
  const alto = altoPastillas(m.filas);
  const y = tramoEnPagina(datos.y, alto, ALTO_PAGINA).inicio;
  return {
    pastillas: m.pastillas.map((p, i) => ({
      texto: textos[i],
      x: p.x,
      y: y + p.fila * SALTO_PASTILLAS,
      ancho: p.ancho,
    })),
    tamano: TAMANO_PASTILLA * m.escala,
    caja: { x0: x, y0: y, x1: x + ancho, y1: y + alto },
  };
}

/** Los textos de las pastillas de la cabecera: «Nº PRE-…», «Fecha …», «Válido hasta …». */
export function textosDatos(
  cab: PlantillaPresupuesto["cabecera"],
  valores: { numero: string; fecha: string; validez: string },
): { texto: string; validez: boolean }[] {
  return (
    [
      [cab.datos.etiquetaNumero, valores.numero, false],
      [cab.datos.etiquetaFecha, valores.fecha, false],
      [cab.datos.etiquetaValidez, valores.validez, true],
    ] as const
  )
    .filter(([etiqueta]) => etiqueta.trim())
    .map(([etiqueta, valor, validez]) => ({ texto: `${etiqueta.trim()} ${valor}`, validez }));
}

/** El alto de una pastilla, para quien la dibuja. */
export { ALTO_PASTILLA };

const anchoMayor = (lineas: readonly string[], tamano: number, medir: Medir) =>
  Math.max(0, ...lineas.map((l) => medir(l, tamano)));

/** Lo que ocupa un texto de la cabecera, ya movido para no salirse del papel por arriba ni por abajo. */
function colocar(
  x: number,
  t: AnclaTexto,
  lineas: string[],
  tamano: number,
  estilo: EstiloLetra,
  medir: Medir,
): TextoMaquetado {
  const dy = ajusteVertical(t.y, (lineas.length - 1) * altoLinea(tamano), tamano);
  const y = t.y + dy;
  const caja = cajaTexto(
    x,
    y,
    anchoMayor(lineas, tamano, medir),
    lineas.length,
    tamano,
    t.alineacion,
  );
  if (estilo === "titular") caja.y0 = y - subidaTitular(tamano);
  return { x, y, tamano, lineas, caja };
}

/**
 * Un texto de la cabecera (el título o el nombre) encajado en el sitio que le
 * dejan los `obstaculos`: más pequeño o en más líneas, nunca cortado. Pegado
 * al margen por el lado hacia el que crece, el ancla se mete en la página
 * (`anclaEnPagina`). Null si no tiene nada que escribir.
 */
export function encajarEnCabecera(
  t: AnclaTexto,
  texto: string,
  estilo: EstiloLetra,
  encaje: EncajeTexto,
  obstaculos: readonly Caja[],
  medidas: MedidasTexto,
): TextoMaquetado | null {
  const medir = medidas.medir(estilo);
  const x = anclaEnPagina(t.x, t.alineacion, medir(texto.trim(), t.tamano));
  const banda = {
    y0: t.y - (estilo === "titular" ? subidaTitular(t.tamano) : subida(t.tamano)),
    y1: t.y + (encaje.lineasPrevistas - 1) * altoLinea(t.tamano) + bajada(t.tamano),
  };
  const ancho = anchoDisponible({ x, alineacion: t.alineacion }, banda, obstaculos);
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
  return colocar(x, t, lineas, tamano, estilo, medir);
}

/**
 * El antetítulo: en mayúsculas espaciadas, no se encoge; se parte en las
 * líneas que hagan falta para no pisar los `obstaculos`. Su caja cuenta la
 * raya de delante. Null si no tiene párrafos.
 */
export function partirTextoLibre(
  t: AnclaTexto,
  parrafos: readonly string[],
  obstaculos: readonly Caja[],
  medidas: MedidasTexto,
): TextoMaquetado | null {
  const textos = parrafos.map((p) => p.toUpperCase()).filter((p) => p.trim());
  if (!textos.length) return null;
  const medir = medidas.medir("rotulo");
  const raya = RAYA_ANTETITULO.largo + RAYA_ANTETITULO.hueco;
  const natural = Math.max(...textos.map((l) => medir(l, t.tamano))) + raya;
  const x = anclaEnPagina(t.x, t.alineacion, natural);
  const banda = {
    y0: t.y - subida(t.tamano),
    y1: t.y + textos.length * altoLinea(t.tamano) + bajada(t.tamano),
  };
  const ancho = anchoDisponible({ x, alineacion: t.alineacion }, banda, obstaculos) - raya;
  const partir = medidas.partir("rotulo");
  const lineas = textos.flatMap((l) => partir(l, Math.max(15, ancho), t.tamano));
  if (!lineas.length) return null;
  const m = colocar(x, t, lineas, t.tamano, "rotulo", medir);
  // La raya va delante de la primera línea.
  const primera = cajaTexto(x, m.y, medir(lineas[0], t.tamano), 1, t.tamano, t.alineacion);
  m.caja.x0 = Math.min(m.caja.x0, primera.x0 - raya);
  return m;
}

/** La cabecera maquetada: lo que sale de cada elemento (null si no sale) y lo que ocupa todo. */
export type CabeceraMaquetada = {
  /** Lo que ocupa la imagen del logo encajada en su caja (no la caja entera). */
  logo: Caja | null;
  datos: DatosMaquetados | null;
  titulo: TextoMaquetado | null;
  texto: TextoMaquetado | null;
  nombre: TextoMaquetado | null;
  /** Todo lo dibujado, en el orden en que se dibuja. */
  dibujado: Caja[];
  /** Dónde acaba la cabecera: la banda o, si la hay, la cinta de debajo. */
  fin: number;
  /** Dónde empieza el cuerpo (`inicioCuerpo`). */
  inicio: number;
};

/**
 * Maqueta la cabecera como el PDF: logo, datos, título, antetítulo y nombre,
 * cada uno en el sitio que le dejan los anteriores. La usan el generador del
 * PDF y el diseñador del editor, para que salga lo mismo en los dos.
 *
 * - El logo sale si la plantilla lo pone y hay logo (`contenido.logo`, su
 *   tamaño natural o solo su proporción), encajado en su caja sin deformarse
 *   y con la caja entera dentro del papel.
 * - Los datos, si la plantilla los pone y tienen alguna pastilla.
 * - El título, si la plantilla lo pone y tiene texto.
 * - El antetítulo, si la plantilla lo pone y le queda algún párrafo.
 * - El nombre, «siempre», o en «auto» si no ha salido el logo.
 */
export function maquetarCabecera(
  cab: PlantillaPresupuesto["cabecera"],
  contenido: {
    /** El tamaño del logo que se pone (cuenta la proporción); null si no hay logo. */
    logo: { ancho: number; alto: number } | null;
    /** El texto de cada pastilla de los datos que sale: las de etiqueta no vacía. */
    datos: readonly string[];
    /** Los párrafos del antetítulo, con las variables ya puestas (`rellenarTexto`). */
    parrafos: readonly string[];
    /** El nombre comercial que sale. */
    nombre: string;
  },
  medidas: MedidasTexto,
): CabeceraMaquetada {
  // Lo dibujado hasta cada momento: lo que estorba al siguiente.
  const dibujado: Caja[] = [];

  let logo: Caja | null = null;
  if (cab.logo.mostrar && contenido.logo) {
    const h = tramoEnPagina(cab.logo.x, cab.logo.ancho, ANCHO_PAGINA);
    const v = tramoEnPagina(cab.logo.y, cab.logo.alto, ALTO_PAGINA);
    const c = encajarImagen(
      { x: h.inicio, y: v.inicio, ancho: h.largo, alto: v.largo },
      contenido.logo,
    );
    // Solo cuenta como logo (y quita el nombre en «auto») si se ve algo.
    if (c.x1 > c.x0 && c.y1 > c.y0) logo = c;
  }
  if (logo) dibujado.push(logo);

  const datos = cab.datos.mostrar
    ? maquetarDatos(cab.datos, contenido.datos, medidas.medir("bold"))
    : null;
  if (datos) dibujado.push(datos.caja);

  const titulo =
    cab.titulo.mostrar && cab.titulo.texto.trim()
      ? encajarEnCabecera(cab.titulo, cab.titulo.texto, "titular", ENCAJE_TITULO, dibujado, medidas)
      : null;
  if (titulo) dibujado.push(titulo.caja);

  const texto = cab.texto.mostrar
    ? partirTextoLibre(cab.texto, contenido.parrafos, dibujado, medidas)
    : null;
  if (texto) dibujado.push(texto.caja);

  const n = cab.nombre;
  const nombre =
    n.mostrar === "siempre" || (n.mostrar === "auto" && !logo)
      ? encajarEnCabecera(n, contenido.nombre, "titular", encajeNombre(n.tamano), dibujado, medidas)
      : null;
  if (nombre) dibujado.push(nombre.caja);

  const fin = cab.alto + (cab.cinta.mostrar ? ALTO_CINTA : 0);
  return { logo, datos, titulo, texto, nombre, dibujado, fin, inicio: inicioCuerpo(fin, dibujado) };
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
