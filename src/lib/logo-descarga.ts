import type { LogoPDF } from "./pdf-factura";

const FORMATOS: Record<string, LogoPDF["formato"]> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/jpg": "JPEG",
  "image/webp": "WEBP",
};

/** Un logo demasiado grande no aporta nada a un A4 y sí encarece cada PDF. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Descarga el logo congelado en la factura y lo deja listo para incrustarlo.
 *
 * Devuelve null ante cualquier problema —URL vacía, red caída, formato que
 * jsPDF no admite, fichero enorme— y nunca lanza: la factura sale sin logo,
 * que es infinitamente mejor que no poder emitirla o no poder imprimirla.
 * Por eso el aviso va a consola y no al usuario.
 */
export async function descargarLogo(url: string | null | undefined): Promise<LogoPDF | null> {
  if (!url) return null;
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      console.warn(`[logo] ${url} devolvió ${respuesta.status}`);
      return null;
    }

    const tipo = (respuesta.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const formato = FORMATOS[tipo];
    if (!formato) {
      console.warn(`[logo] formato no admitido en el PDF: ${tipo || "desconocido"}`);
      return null;
    }

    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      console.warn(`[logo] ${bytes.byteLength} bytes, por encima del límite`);
      return null;
    }

    // btoa por trozos: pasar un array de un millón de bytes a String.fromCharCode
    // de golpe desborda la pila de argumentos.
    let binario = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binario += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }

    return { dataUrl: `data:${tipo};base64,${btoa(binario)}`, formato };
  } catch (error) {
    console.warn(`[logo] no se pudo descargar ${url}:`, error);
    return null;
  }
}
