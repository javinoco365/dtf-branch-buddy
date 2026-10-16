import type { jsPDF } from "jspdf";

/**
 * Las letras del PDF de presupuestos: Anton para los títulos y las cifras
 * grandes, e Inter para el texto. Son las del modelo de la casa.
 *
 * Van dentro del PDF (jsPDF las incrusta), así que se ven igual en cualquier
 * ordenador. Son las de Fontsource, solo el juego latino (con €, «», ñ y las
 * tildes), pasadas a TTF; licencia SIL OFL 1.1, en `src/assets/fuentes-pdf/`.
 *
 * Se cargan aparte, la primera vez que hacen falta, y una sola vez: pesan unos
 * 230 kB y no tienen que ir en el paquete de cada pantalla.
 */

/** Los nombres con que se piden a jsPDF (`doc.setFont`). */
export const LETRA = {
  /** Anton: títulos, rótulos de la tabla, el TOTAL. */
  titular: "Anton",
  /** Inter normal y negrita. */
  texto: "Inter",
  /** Inter seminegrita: las cifras. */
  cifras: "InterSemi",
} as const;

type Datos = { anton: string; regular: string; semi: string; bold: string };

let cargando: Promise<Datos> | null = null;

/** El base64 de un `data:` (lo que da `?inline`). */
const base64 = (url: string) => url.slice(url.indexOf(",") + 1);

function cargar(): Promise<Datos> {
  cargando ??= Promise.all([
    import("@/assets/fuentes-pdf/Anton-Regular.ttf?inline"),
    import("@/assets/fuentes-pdf/Inter-Regular.ttf?inline"),
    import("@/assets/fuentes-pdf/Inter-SemiBold.ttf?inline"),
    import("@/assets/fuentes-pdf/Inter-Bold.ttf?inline"),
  ]).then(
    ([anton, regular, semi, bold]) => ({
      anton: base64(anton.default),
      regular: base64(regular.default),
      semi: base64(semi.default),
      bold: base64(bold.default),
    }),
    (e) => {
      // Que el siguiente intento vuelva a probar.
      cargando = null;
      throw e;
    },
  );
  return cargando;
}

/** Deja las letras del presupuesto listas en `doc`. */
export async function registrarFuentesPdf(doc: jsPDF): Promise<void> {
  const d = await cargar();
  const poner = (fichero: string, datos: string, nombre: string, estilo: string) => {
    doc.addFileToVFS(fichero, datos);
    doc.addFont(fichero, nombre, estilo);
  };
  poner("Anton-Regular.ttf", d.anton, LETRA.titular, "normal");
  poner("Inter-Regular.ttf", d.regular, LETRA.texto, "normal");
  poner("Inter-Bold.ttf", d.bold, LETRA.texto, "bold");
  poner("Inter-SemiBold.ttf", d.semi, LETRA.cifras, "normal");
}

/**
 * Las mismas letras para el navegador (`FontFace`), para que el diseñador de
 * la cabecera las enseñe como el PDF. Sin `document`, no hace nada.
 */
export async function registrarFuentesNavegador(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  const d = await cargar();
  const url = (b64: string) => `url(data:font/ttf;base64,${b64})`;
  const caras = [
    new FontFace("PDF Anton", url(d.anton)),
    new FontFace("PDF Inter", url(d.regular), { weight: "400" }),
    new FontFace("PDF Inter", url(d.semi), { weight: "600" }),
    new FontFace("PDF Inter", url(d.bold), { weight: "700" }),
  ];
  for (const c of await Promise.all(caras.map((c) => c.load()))) document.fonts.add(c);
}
