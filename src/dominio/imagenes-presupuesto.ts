/**
 * Las imágenes de un presupuesto (el diseño, la prenda, una maqueta): qué se
 * admite, cómo se reconoce un fichero, dónde se guarda, cómo se sacan las
 * fotos de un PDF y cómo se colocan en el PDF del presupuesto.
 *
 * Lógica pura: se prueba sin red, sin base de datos y sin navegador.
 */

/** Lo que se admite: lo mismo que el bucket 'presupuestos' (migración 20261030100000). */
export const TIPOS_IMAGEN_PRESUPUESTO = ["image/jpeg", "image/png", "image/webp"] as const;
export type TipoImagenPresupuesto = (typeof TIPOS_IMAGEN_PRESUPUESTO)[number];

export const EXTENSION_IMAGEN: Record<TipoImagenPresupuesto, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Como mucho, 5 MB por imagen (el límite del bucket y del CHECK de la tabla). */
export const MAXIMO_BYTES_IMAGEN = 5 * 1024 * 1024;

/** Como mucho, tantas imágenes por presupuesto: el PDF no es un catálogo. */
export const MAXIMO_IMAGENES_PRESUPUESTO = 8;

export const esTipoImagenPresupuesto = (t: string): t is TipoImagenPresupuesto =>
  (TIPOS_IMAGEN_PRESUPUESTO as readonly string[]).includes(t);

export type MedidasImagen = {
  tipo: TipoImagenPresupuesto;
  ancho: number;
  alto: number;
  /** Solo JPEG: 1 (gris), 3 (color) o 4 (CMYK). */
  componentes?: number;
  /**
   * Solo JPEG: la orientación EXIF (1 a 8), si la lleva. `ancho` y `alto`
   * son los del fichero (los del sensor): con 5 a 8, la foto se ve girada y
   * sus medidas a la vista son las contrarias (ver `medidasALaVista`).
   */
  orientacion?: number;
};

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...Array.from(b.subarray(i, i + n)));

/**
 * La orientación de un segmento APP1 de EXIF (lo que va después de la
 * longitud): «Exif\0\0», la cabecera TIFF y la etiqueta 0x0112 del IFD0.
 * null si no la lleva o no se entiende.
 */
function orientacionExif(b: Uint8Array, desde: number, hasta: number): number | null {
  if (
    hasta - desde < 14 ||
    ascii(b, desde, 4) !== "Exif" ||
    b[desde + 4] !== 0 ||
    b[desde + 5] !== 0
  ) {
    return null;
  }
  const tiff = desde + 6;
  const orden = ascii(b, tiff, 2);
  if (orden !== "II" && orden !== "MM") return null;
  const le = orden === "II";
  const u16 = (i: number) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (i: number) =>
    le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i);
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > hasta) return null;
  const entradas = u16(ifd);
  for (let k = 0; k < entradas; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > hasta) return null;
    if (u16(e) === 0x0112) {
      const valor = u16(e + 8);
      return valor >= 1 && valor <= 8 ? valor : null;
    }
  }
  return null;
}

/**
 * El tipo y las medidas (en píxeles) de una imagen, leídos de sus primeros
 * bytes, no del nombre ni del tipo que diga el navegador. null si no es un
 * JPEG, un PNG o un WEBP que se entienda.
 */
export function medidasImagen(b: Uint8Array): MedidasImagen | null {
  // PNG: la firma y la cabecera IHDR.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    const ancho = u32be(b, 16);
    const alto = u32be(b, 20);
    return ancho > 0 && alto > 0 ? { tipo: "image/png", ancho, alto } : null;
  }

  // JPEG: se recorren los segmentos hasta el de las medidas (SOFn); de
  // camino, la orientación EXIF (APP1), que va antes.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    let orientacion: number | null = null;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marca = b[i + 1];
      if (marca === 0xff) {
        i += 1;
        continue;
      }
      // Sin longitud: RSTn, SOI, EOI, TEM.
      if ((marca >= 0xd0 && marca <= 0xd9) || marca === 0x01) {
        i += 2;
        continue;
      }
      const largo = u16be(b, i + 2);
      if (largo < 2) return null;
      if (marca === 0xe1 && orientacion === null) {
        orientacion = orientacionExif(b, i + 4, Math.min(b.length, i + 2 + largo));
      }
      const esSof =
        marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc;
      if (esSof) {
        const alto = u16be(b, i + 5);
        const ancho = u16be(b, i + 7);
        const componentes = b[i + 9];
        if (!(ancho > 0 && alto > 0)) return null;
        return orientacion && orientacion !== 1
          ? { tipo: "image/jpeg", ancho, alto, componentes, orientacion }
          : { tipo: "image/jpeg", ancho, alto, componentes };
      }
      i += 2 + largo;
    }
    return null;
  }

  // WEBP: RIFF....WEBP y el primer trozo (con pérdida, sin pérdida o extendido).
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const trozo = ascii(b, 12, 4);
    let ancho = 0;
    let alto = 0;
    if (trozo === "VP8 ") {
      ancho = (b[26] | (b[27] << 8)) & 0x3fff;
      alto = (b[28] | (b[29] << 8)) & 0x3fff;
    } else if (trozo === "VP8L") {
      ancho = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      alto = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    } else if (trozo === "VP8X") {
      ancho = 1 + u24le(b, 24);
      alto = 1 + u24le(b, 27);
    } else {
      return null;
    }
    return ancho > 0 && alto > 0 ? { tipo: "image/webp", ancho, alto } : null;
  }

  return null;
}

/**
 * Cuánto hay que girar la imagen, en grados y en el sentido de las agujas
 * del reloj, para verla como se hizo. Las orientaciones con espejo (2, 4, 5
 * y 7), que las cámaras no usan, se giran igual que su pareja sin espejo: el
 * espejo se pierde, pero sale derecha y con su proporción.
 */
export function giroDeOrientacion(orientacion: number | undefined): 0 | 90 | 180 | 270 {
  switch (orientacion) {
    case 3:
    case 4:
      return 180;
    case 5:
    case 6:
      return 90;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

/** Las medidas tal como se ve la imagen: con un giro de 90° o 270°, cambiadas. */
export function medidasALaVista(m: { ancho: number; alto: number; orientacion?: number }): {
  ancho: number;
  alto: number;
} {
  const g = giroDeOrientacion(m.orientacion);
  return g === 90 || g === 270
    ? { ancho: m.alto, alto: m.ancho }
    : { ancho: m.ancho, alto: m.alto };
}

/**
 * Lo que se le pasa a jsPDF (`addImage(…, x, y, ancho, alto, …, rotacion)`)
 * para que una imagen girada `giro` grados ocupe, ya derecha, el hueco
 * (x, y, ancho, alto) de la maqueta, medido a la vista.
 *
 * jsPDF dibuja la imagen sin girar con su esquina inferior izquierda en
 * (x, y + alto) y la gira alrededor de ese punto en sentido contrario a las
 * agujas del reloj: de ahí el signo y el desplazamiento de cada caso.
 */
export function colocacionGirada(
  hueco: { x: number; y: number; ancho: number; alto: number },
  giro: 0 | 90 | 180 | 270,
): { x: number; y: number; ancho: number; alto: number; rotacion: number } {
  const { x, y, ancho, alto } = hueco;
  switch (giro) {
    case 90:
      return { x, y: y - ancho, ancho: alto, alto: ancho, rotacion: -90 };
    case 180:
      return { x: x + ancho, y: y - alto, ancho, alto, rotacion: 180 };
    case 270:
      return { x: x + ancho, y: y + alto - ancho, ancho: alto, alto: ancho, rotacion: 90 };
    default:
      return { x, y, ancho, alto, rotacion: 0 };
  }
}

/**
 * Por encima de tantos píxeles, un PNG o un WEBP no se admite: para el PDF
 * se descomprime a píxeles en bruto (4 bytes cada uno), y en el servidor la
 * memoria es poca. Un JPEG entra en el PDF tal cual, sin descomprimir.
 */
export const MAXIMO_PIXELES_SIN_JPEG = 4_000_000;

/** El lado más largo con el que se sube una imagen: el navegador la reduce antes. */
export const LADO_MAXIMO_SUBIDA = 1600;

/**
 * Las medidas con las que el navegador vuelve a guardar una imagen antes de
 * subirla (en JPEG), o null si se sube tal cual: solo se reduce la que pasa
 * de `LADO_MAXIMO_SUBIDA` en su lado más largo. Las medidas son a la vista
 * (el navegador la dibuja ya girada).
 */
export function medidasReducidas(
  m: { ancho: number; alto: number; orientacion?: number },
  ladoMaximo = LADO_MAXIMO_SUBIDA,
): { ancho: number; alto: number } | null {
  const v = medidasALaVista(m);
  const lado = Math.max(v.ancho, v.alto);
  if (lado <= ladoMaximo) return null;
  const escala = ladoMaximo / lado;
  return {
    ancho: Math.max(1, Math.round(v.ancho * escala)),
    alto: Math.max(1, Math.round(v.alto * escala)),
  };
}

/**
 * Las imágenes que caben en un presupuesto (`maximo`), por orden de
 * preferencia: primero las del primer grupo, luego las del segundo… Devuelve
 * las que entran y cuántas se quedan fuera.
 */
export function recortarImagenes<T>(
  grupos: readonly (readonly T[])[],
  maximo = MAXIMO_IMAGENES_PRESUPUESTO,
): { elegidas: T[]; fuera: number } {
  const todas = grupos.flat();
  const hueco = Math.max(0, maximo);
  return { elegidas: todas.slice(0, hueco), fuera: Math.max(0, todas.length - hueco) };
}

/**
 * Si el fichero se puede guardar como imagen de un presupuesto. Devuelve sus
 * medidas, o por qué no, en castellano.
 */
export function revisarImagen(
  bytes: Uint8Array,
  nombre: string,
): { ok: true; medidas: MedidasImagen } | { ok: false; error: string } {
  if (bytes.byteLength === 0) return { ok: false, error: `«${nombre}» está vacío.` };
  if (bytes.byteLength > MAXIMO_BYTES_IMAGEN) {
    return { ok: false, error: `«${nombre}» pesa más de 5 MB: redúcela antes de subirla.` };
  }
  const medidas = medidasImagen(bytes);
  if (!medidas) return { ok: false, error: `«${nombre}» no es un JPG, un PNG ni un WEBP.` };
  if (medidas.tipo === "image/jpeg" && medidas.componentes === 4) {
    return {
      ok: false,
      error: `«${nombre}» es un JPG en CMYK: guárdalo en RGB para que salga bien en el PDF.`,
    };
  }
  if (medidas.tipo !== "image/jpeg" && medidas.ancho * medidas.alto > MAXIMO_PIXELES_SIN_JPEG) {
    return {
      ok: false,
      error: `«${nombre}» es demasiado grande (${medidas.ancho} × ${medidas.alto} px): redúcela a ${LADO_MAXIMO_SUBIDA} px de lado o guárdala en JPG.`,
    };
  }
  return { ok: true, medidas };
}

/** `<empresa>/<tienda|textil>/<presupuesto>/<id>.<ext>`: lo que exige el CHECK de la tabla. */
export function rutaImagenPresupuesto(
  empresaId: string,
  ambito: "tienda" | "textil",
  presupuestoId: string,
  id: string,
  tipo: TipoImagenPresupuesto,
): string {
  return `${empresaId}/${ambito}/${presupuestoId}/${id}.${EXTENSION_IMAGEN[tipo]}`;
}

// ---------------------------------------------------------------------------
// Las fotos que lleva un PDF
// ---------------------------------------------------------------------------

/** Por debajo de esto (en el lado más corto), es un icono o un logo: no se propone. */
export const LADO_MINIMO_EXTRAIDA = 150;
/** Como mucho, tantas fotos sacadas de un PDF. */
export const MAXIMO_EXTRAIDAS = 8;

export type ImagenExtraida = { bytes: Uint8Array; ancho: number; alto: number };

/**
 * Las fotos JPEG incrustadas en un PDF, tal cual (sin descomprimir ni
 * recomprimir nada): los objetos imagen con el filtro DCTDecode solo, que
 * dentro llevan un JPEG completo.
 *
 * Solo lo seguro: se dejan fuera las que llevan otro filtro encadenado, las
 * máscaras, las que tienen /Decode (colores invertidos), las CMYK (salen
 * mal), las que no empiezan y acaban como un JPEG, las pequeñas (iconos,
 * logos) y las repetidas. Las imágenes que el PDF guarda en otros formatos
 * (mapas de píxeles comprimidos) no se sacan: se añaden aparte.
 */
export function extraerJpegsDePdf(pdf: Uint8Array): ImagenExtraida[] {
  // latin1: un byte, un carácter; las posiciones del texto son las de los bytes.
  const t = new TextDecoder("latin1").decode(pdf);
  const encontradas: ImagenExtraida[] = [];
  const vistas = new Set<string>();
  const inicio = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = inicio.exec(t)) && encontradas.length < MAXIMO_EXTRAIDAS) {
    // «endstream» también acaba en «stream»: no es un comienzo.
    if (t.slice(Math.max(0, m.index - 3), m.index) === "end") continue;
    const desde = m.index + m[0].length;
    const hasta = t.indexOf("endstream", desde);
    if (hasta < 0) break;
    const cabeza = t.slice(Math.max(0, t.lastIndexOf("obj", m.index)), m.index);
    inicio.lastIndex = hasta + 9;

    const dicc = cabeza.replace(/\s+/g, " ");
    if (!/\/Subtype ?\/Image\b/.test(dicc)) continue;
    if (!/\/Filter ?(\/DCTDecode|\[ ?\/DCTDecode ?\])/.test(dicc)) continue;
    if (/\/ImageMask ?true|\/Decode ?\[|\/DeviceCMYK/.test(dicc)) continue;

    let fin = hasta;
    while (fin > desde && (pdf[fin - 1] === 0x0a || pdf[fin - 1] === 0x0d)) fin -= 1;
    const bytes = pdf.slice(desde, fin);
    if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      continue;
    }
    const medidas = medidasImagen(bytes);
    if (!medidas || medidas.tipo !== "image/jpeg" || medidas.componentes === 4) continue;
    if (Math.min(medidas.ancho, medidas.alto) < LADO_MINIMO_EXTRAIDA) continue;
    if (bytes.byteLength > MAXIMO_BYTES_IMAGEN) continue;
    const huella = `${bytes.length}:${Array.from(bytes.subarray(bytes.length - 64)).join(",")}`;
    if (vistas.has(huella)) continue;
    vistas.add(huella);
    encontradas.push({ bytes, ancho: medidas.ancho, alto: medidas.alto });
  }
  return encontradas;
}

// ---------------------------------------------------------------------------
// Cómo se colocan en el PDF
// ---------------------------------------------------------------------------

export type CeldaImagen = {
  /** La imagen (su posición en la lista que se pasó). */
  indice: number;
  /** Desde el margen izquierdo, en mm. */
  x: number;
  ancho: number;
  alto: number;
};

export type FilaImagenes = { alto: number; celdas: CeldaImagen[] };

/**
 * Las imágenes en filas de `columnas` (dos por defecto), cada una tan grande
 * como quepa en su hueco sin deformarla y sin pasar de `altoMaximo`, y
 * centrada en él. Con una sola imagen, una columna a todo lo ancho.
 */
export function maquetarImagenes(
  medidas: readonly { ancho: number; alto: number }[],
  anchoUtil: number,
  opciones: { columnas?: number; separacion?: number; altoMaximo?: number } = {},
): FilaImagenes[] {
  const validas = medidas
    .map((m, indice) => ({ ...m, indice }))
    .filter((m) => m.ancho > 0 && m.alto > 0);
  if (!validas.length || anchoUtil <= 0) return [];
  const columnas = Math.max(1, Math.min(opciones.columnas ?? 2, validas.length));
  const separacion = opciones.separacion ?? 6;
  const altoMaximo = opciones.altoMaximo ?? 85;
  const hueco = (anchoUtil - separacion * (columnas - 1)) / columnas;

  const filas: FilaImagenes[] = [];
  for (let i = 0; i < validas.length; i += columnas) {
    const celdas = validas.slice(i, i + columnas).map((m, j): CeldaImagen => {
      const escala = Math.min(hueco / m.ancho, altoMaximo / m.alto);
      const ancho = m.ancho * escala;
      const alto = m.alto * escala;
      return { indice: m.indice, x: j * (hueco + separacion) + (hueco - ancho) / 2, ancho, alto };
    });
    filas.push({ alto: Math.max(...celdas.map((c) => c.alto)), celdas });
  }
  return filas;
}
