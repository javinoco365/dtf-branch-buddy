/**
 * Solo navegador: antes de subir una imagen a un presupuesto, la reduce si es
 * muy grande. El PDF se hace en el servidor (Cloudflare Workers en
 * producción), con poca memoria: una foto del móvil o una maqueta a 300 ppp
 * no hace falta a ese tamaño para verse bien en un A4.
 *
 * Qué se reduce y a cuánto lo decide el dominio (`medidasReducidas`). La
 * imagen se dibuja con un <img>, que aplica la orientación EXIF igual que la
 * miniatura del editor, y se guarda en JPEG sobre fondo blanco (el del PDF).
 */

import { medidasImagen, medidasReducidas } from "@/dominio/imagenes-presupuesto";

const CALIDAD_JPEG = 0.88;

function cargar(url: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rechazar(new Error("no se puede abrir la imagen"));
    img.src = url;
  });
}

/**
 * La imagen lista para subir: la misma si no pasa del tamaño, o una copia
 * reducida en JPEG. Si algo falla al reducirla, la original (el servidor la
 * revisa igual y dice por qué no la admite, si no la admite).
 */
export async function reducirImagenParaSubir(fichero: File): Promise<File> {
  try {
    const medidas = medidasImagen(new Uint8Array(await fichero.arrayBuffer()));
    if (!medidas) return fichero;
    const destino = medidasReducidas(medidas);
    if (!destino) return fichero;

    const url = URL.createObjectURL(fichero);
    try {
      const img = await cargar(url);
      const lienzo = document.createElement("canvas");
      lienzo.width = destino.ancho;
      lienzo.height = destino.alto;
      const ctx = lienzo.getContext("2d");
      if (!ctx) return fichero;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, destino.ancho, destino.alto);
      ctx.drawImage(img, 0, 0, destino.ancho, destino.alto);
      const blob = await new Promise<Blob | null>((r) =>
        lienzo.toBlob(r, "image/jpeg", CALIDAD_JPEG),
      );
      if (!blob) return fichero;
      const nombre = fichero.name.replace(/\.[^.]*$/, "") || "imagen";
      return new File([blob], `${nombre}.jpg`, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return fichero;
  }
}
