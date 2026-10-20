/**
 * Las imágenes de un presupuesto, del lado del servidor: leer sus filas y
 * bajar sus ficheros para el PDF. Ver 20261030100000_presupuesto_imagenes.sql.
 *
 * Todo con el cliente que se le pase: en las server functions, el de la sesión
 * del usuario (la RLS de presupuesto_imagenes y la política del bucket deciden
 * qué puede ver). Aquí no se usa la clave de servicio.
 *
 * Sin la migración aplicada, no hay imágenes: nada falla, simplemente no salen.
 */

import { faltaLaTabla, tabla } from "./rpc";
import { pdfEnBase64 } from "./pdf-presupuesto-datos";
import type { ImagenPDF } from "./pdf-presupuesto";
import { medidasImagen } from "@/dominio/imagenes-presupuesto";

export type AmbitoImagenes = "tienda" | "textil";

/** El bucket privado de las imágenes. */
export const BUCKET_IMAGENES = "presupuestos";

/** La migración que crea la tabla y el bucket, para los mensajes. */
export const MIGRACION_IMAGENES = "20261030100000_presupuesto_imagenes.sql";

/** La columna que apunta al presupuesto, según el ámbito. */
export const columnaPresupuesto = (a: AmbitoImagenes) =>
  a === "tienda" ? "presupuesto_id" : "textil_presupuesto_id";

export type FilaImagen = {
  id: string;
  ruta: string;
  nombre: string;
  tipo_mime: string;
  ancho: number | null;
  alto: number | null;
  orden: number;
};

/** Las imágenes de un presupuesto, en orden. `disponible: false` sin la migración. */
export async function leerFilasImagenes(
  sb: unknown,
  ambito: AmbitoImagenes,
  presupuestoId: string,
): Promise<{ disponible: boolean; filas: FilaImagen[] }> {
  const { data, error } = await tabla(sb, "presupuesto_imagenes")
    .select("id, ruta, nombre, tipo_mime, ancho, alto, orden")
    .eq(columnaPresupuesto(ambito), presupuestoId)
    .order("orden")
    .order("created_at");
  if (faltaLaTabla(error)) return { disponible: false, filas: [] };
  if (error) throw new Error(error.message);
  return { disponible: true, filas: (data ?? []) as FilaImagen[] };
}

const FORMATO: Record<string, ImagenPDF["formato"]> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
};

/**
 * Las imágenes de un presupuesto listas para el PDF. Nunca lanza: una imagen
 * que no se puede bajar o no se entiende no impide sacar el presupuesto; se
 * queda fuera y se avisa en el registro del servidor.
 */
export async function imagenesParaPdf(
  sb: unknown,
  ambito: AmbitoImagenes,
  presupuestoId: string,
): Promise<ImagenPDF[]> {
  let filas: FilaImagen[];
  try {
    filas = (await leerFilasImagenes(sb, ambito, presupuestoId)).filas;
  } catch (e) {
    console.warn("[presupuesto] no se pudieron leer las imágenes:", e);
    return [];
  }
  const storage = (sb as { storage: { from: (b: string) => any } }).storage.from(BUCKET_IMAGENES);
  const imagenes = await Promise.all(
    filas.map(async (f): Promise<ImagenPDF | null> => {
      try {
        const r = await storage.download(f.ruta);
        if (r.error || !r.data) {
          console.warn(`[presupuesto] imagen ${f.ruta}: no se pudo bajar`);
          return null;
        }
        const bytes = new Uint8Array(await (r.data as Blob).arrayBuffer());
        const medidas = medidasImagen(bytes);
        if (!medidas) return null;
        const base64 = await pdfEnBase64(new Blob([bytes]));
        return {
          dataUrl: `data:${medidas.tipo};base64,${base64}`,
          formato: FORMATO[medidas.tipo],
          ancho: medidas.ancho,
          alto: medidas.alto,
        };
      } catch (e) {
        console.warn(`[presupuesto] imagen ${f.ruta}:`, e);
        return null;
      }
    }),
  );
  return imagenes.filter((x): x is ImagenPDF => x !== null);
}

/** Las rutas de los ficheros de un presupuesto, para borrarlos con él. Vacío sin la migración. */
export async function rutasImagenes(
  sb: unknown,
  ambito: AmbitoImagenes,
  presupuestoId: string,
): Promise<string[]> {
  try {
    return (await leerFilasImagenes(sb, ambito, presupuestoId)).filas.map((f) => f.ruta);
  } catch {
    return [];
  }
}
