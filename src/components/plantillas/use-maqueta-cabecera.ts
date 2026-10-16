import { useEffect, useMemo, useState } from "react";
import { ALTO_PAGINA, ANCHO_PAGINA, rellenarTexto } from "@/dominio/plantilla-presupuesto";
import type { Caja } from "@/dominio/maqueta-presupuesto";
import {
  ENCAJE_TITULO,
  cajaDatos,
  encajarEnCabecera,
  encajeNombre,
  limitesEnPapel,
  maquetarCabecera,
  partirTextoLibre,
  type RangoPosicion,
  type TextoMaquetado,
} from "@/dominio/maqueta-cabecera";
import { useEditor, type ElementoCabecera } from "./editor";
import { MAXIMOS, MINIMOS } from "./limites";
import { MEDIDAS_A_OJO } from "./aspecto";
import { useMedidasPdf } from "./use-medidas-pdf";

/**
 * El tamaño natural de una imagen, el que lee el PDF del fichero para encajar
 * el logo en su caja. Null mientras carga, si no carga o si no tiene tamaño
 * propio (un SVG sin medidas).
 */
function useTamanoNatural(src: string | null): { ancho: number; alto: number } | null {
  const [leido, setLeido] = useState<{ src: string; ancho: number; alto: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setLeido({ src, ancho: img.naturalWidth, alto: img.naturalHeight });
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return leido && leido.src === src && leido.ancho > 0 && leido.alto > 0 ? leido : null;
}

/** El rango de siempre del punto de un elemento (el de la plantilla). */
const rangoDe = (el: ElementoCabecera): RangoPosicion => ({
  minX: MINIMOS.cabecera[el].x,
  maxX: MAXIMOS.cabecera[el].x,
  minY: MINIMOS.cabecera[el].y,
  maxY: MAXIMOS.cabecera[el].y,
});

/**
 * La cabecera de la plantilla que se edita, maquetada como en el PDF
 * (`maquetarCabecera`): el logo encajado en su caja según su tamaño natural, y
 * cada texto encogido o partido para no pisar lo de antes, con las medidas de
 * la letra del PDF (a ojo mientras llegan). Lo usan el diseñador, para dibujar
 * y colocar, y los campos de posición, para no sacar nada del papel.
 */
export function useMaquetaCabecera() {
  const { plantilla: p, identidad, logoPropio, base, valores } = useEditor();
  const cab = p.cabecera;

  // Lo que dice cada elemento, con los datos de la vista previa si los hay.
  const logoDisponible = logoPropio || base.logo_url;
  const nombre = identidad.nombre_comercial || base.nombre || "";
  const parrafos = useMemo(
    () => rellenarTexto(cab.texto.texto, valores),
    [cab.texto.texto, valores],
  );
  // Una etiqueta vacía quita su fila, como en el PDF.
  const filasDatos = (
    [
      [cab.datos.etiquetaNumero, valores.numero || "—"],
      [cab.datos.etiquetaFecha, valores.fecha || "—"],
      [cab.datos.etiquetaValidez, valores.fecha_validez || "—"],
    ] as const
  ).filter(([etiqueta]) => etiqueta.trim() !== "");
  const nFilas = filasDatos.length;

  const medidas = useMedidasPdf() ?? MEDIDAS_A_OJO;
  const natural = useTamanoNatural(logoDisponible);

  const calculado = useMemo(() => {
    const maqueta = maquetarCabecera(
      cab,
      {
        // Sin su tamaño (cargando, o sin medidas propias), la caja entera.
        logo: logoDisponible ? (natural ?? { ancho: cab.logo.ancho, alto: cab.logo.alto }) : null,
        filasDatos: nFilas,
        parrafos,
        nombre: nombre || "Nombre comercial",
      },
      medidas,
    );

    // Lo que sale en el PDF.
    const visible: Record<ElementoCabecera, boolean> = {
      logo: !!maqueta.logo,
      nombre: !!maqueta.nombre,
      titulo: !!maqueta.titulo,
      datos: !!maqueta.datos,
      texto: !!maqueta.texto,
    };

    // Un texto que no sale se maqueta igual (con un texto de muestra si está
    // vacío), en el sitio que le dejaría lo demás: para dibujarlo tenue si se
    // elige, y para saber hasta dónde se puede mover.
    const textos: Record<"nombre" | "titulo" | "texto", TextoMaquetado | null> = {
      nombre:
        maqueta.nombre ??
        encajarEnCabecera(
          cab.nombre,
          nombre || "Nombre comercial",
          "bold",
          encajeNombre(cab.nombre.tamano),
          maqueta.dibujado,
          medidas,
        ),
      titulo:
        maqueta.titulo ??
        encajarEnCabecera(
          cab.titulo,
          cab.titulo.texto.trim() || "Título",
          "bold",
          ENCAJE_TITULO,
          maqueta.dibujado,
          medidas,
        ),
      texto:
        maqueta.texto ??
        partirTextoLibre(
          cab.texto,
          parrafos.length ? parrafos : ["Texto libre"],
          maqueta.dibujado,
          medidas,
        ),
    };

    // Lo que ocupa cada elemento: el logo, su caja entera (la que se mueve y
    // se estira); lo demás, lo que ocupa en el PDF.
    const cajas: Partial<Record<ElementoCabecera, Caja>> = {
      logo: {
        x0: cab.logo.x,
        y0: cab.logo.y,
        x1: cab.logo.x + cab.logo.ancho,
        y1: cab.logo.y + cab.logo.alto,
      },
    };
    if (nFilas) cajas.datos = cajaDatos(cab.datos, nFilas);
    if (textos.nombre) cajas.nombre = textos.nombre.caja;
    if (textos.titulo) cajas.titulo = textos.titulo.caja;
    if (textos.texto) cajas.texto = textos.texto.caja;

    /**
     * Hasta dónde puede ir el punto de `el` con su caja dentro del papel: lo
     * mismo al arrastrar, con las flechas y en los campos X e Y. `alto`, hasta
     * dónde puede bajar la caja.
     */
    const limites = (el: ElementoCabecera, alto: number = ALTO_PAGINA): RangoPosicion =>
      limitesEnPapel({ x: cab[el].x, y: cab[el].y }, cajas[el] ?? null, rangoDe(el), { alto });

    /** El ancho máximo de la caja del logo o de los datos: sin pasar del borde del papel. */
    const anchoMax = (el: "logo" | "datos") =>
      Math.max(
        MINIMOS.cabecera[el].ancho,
        Math.min(MAXIMOS.cabecera[el].ancho, ANCHO_PAGINA - cab[el].x),
      );

    return { maqueta, visible, textos, cajas, limites, anchoMax };
  }, [cab, logoDisponible, natural, nFilas, parrafos, nombre, medidas]);

  return { ...calculado, filasDatos, logoDisponible };
}
