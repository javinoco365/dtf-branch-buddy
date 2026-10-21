/**
 * El tipo real de un fichero subido, leído de sus primeros bytes.
 *
 * El tipo que llega con el fichero (`File.type`) lo pone el navegador a partir
 * de la extensión: cualquiera puede mandar otra cosa con «.pdf» o
 * «image/png». Lo que se guarda o se manda a la IA se comprueba aquí.
 */

const ascii = (b: Uint8Array, desde: number, n: number) =>
  String.fromCharCode(...b.subarray(desde, desde + n));

/** El tipo MIME según la firma, o null si no es ninguno de los admitidos. */
export function tipoPorFirma(b: Uint8Array): string | null {
  // Un PDF puede llevar basura delante de «%PDF-» (lo admiten los lectores
  // hasta 1024 bytes); en la práctica, los de facturas empiezan por ahí.
  if (b.length >= 5 && ascii(b, 0, Math.min(b.length, 1024)).includes("%PDF-")) {
    return "application/pdf";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    ascii(b, 1, 3) === "PNG" &&
    b[4] === 0x0d &&
    b[5] === 0x0a
  ) {
    return "image/png";
  }
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  return null;
}

/**
 * null si el fichero es de verdad del tipo que dice; si no, el motivo en
 * castellano para enseñarlo.
 */
export function errorDeFirma(b: Uint8Array, tipoDeclarado: string): string | null {
  const real = tipoPorFirma(b);
  if (real === null) return "El fichero no es un PDF ni una imagen que se pueda leer.";
  if (real !== tipoDeclarado) {
    return `El fichero dice ser ${tipoDeclarado || "de tipo desconocido"} pero su contenido es ${real}.`;
  }
  return null;
}

/** Tope de tamaño de los ficheros que se suben (facturas, documentos para la IA). */
export const MAXIMO_BYTES_SUBIDA = 10 * 1024 * 1024;

/** Tope de un extracto bancario: son texto o una hoja pequeña. */
export const MAXIMO_BYTES_EXTRACTO = 5 * 1024 * 1024;
