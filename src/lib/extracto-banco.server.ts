/**
 * Lee el extracto que descarga el banco: Excel, CSV o Norma 43.
 *
 * Solo servidor: `read-excel-file` es una dependencia pesada que no tiene por
 * qué viajar al navegador. Se importa dinámicamente dentro del handler.
 *
 * La detección del formato (codificación, separador, orden de la fecha,
 * decimal) y la lectura viven en `src/dominio/extractos.ts`, que se prueba
 * sin red ni base de datos. Aquí solo se abre el fichero.
 */

import {
  extractoDeFilas,
  leerExtractoTexto,
  type Extracto,
  type Opciones,
} from "@/dominio/extractos";

const MAXIMO_BYTES = 5 * 1024 * 1024;

/** Un .xlsx es un zip: empieza por «PK». */
const esXlsx = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

export async function leerExtracto(
  bytes: Uint8Array,
  nombreFichero: string,
  opciones: Opciones = {},
): Promise<Extracto> {
  if (bytes.byteLength > MAXIMO_BYTES) {
    throw new Error("El fichero pesa más de 5 MB. Exporta un periodo más corto.");
  }
  if (/\.xls$/i.test(nombreFichero) && !esXlsx(bytes)) {
    throw new Error("Es un Excel antiguo (.xls). Guárdalo como .xlsx o expórtalo en CSV.");
  }
  const extracto = esXlsx(bytes)
    ? extractoDeFilas(await leerXlsx(bytes), { tipo: "excel" }, opciones)
    : leerExtractoTexto(bytes, opciones);
  if (extracto.movimientos.length === 0) {
    throw new Error("El fichero no trae ningún movimiento con fecha e importe.");
  }
  return extracto;
}

async function leerXlsx(bytes: Uint8Array): Promise<unknown[][]> {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  // Sin esquema: se lee tal cual y las columnas se buscan por su cabecera.
  return (await readXlsxFile(Buffer.from(bytes))) as unknown as unknown[][];
}
