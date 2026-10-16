import { useEffect, useState } from "react";
import type { MedidasTexto } from "@/dominio/maqueta-cabecera";

/**
 * Las medidas de la letra del PDF: la Helvetica de jsPDF, medida y partida con
 * las mismas llamadas que usa el generador (`getTextWidth`, `splitTextToSize`).
 * Así el diseñador encoge y parte los textos de la cabecera igual que el PDF.
 *
 * jsPDF es grande y se carga aparte (la vista previa también lo usa): hasta
 * que llega, null. Se carga una vez por pestaña.
 */
let cargadas: MedidasTexto | null = null;
let cargando: Promise<MedidasTexto> | null = null;

function cargar(): Promise<MedidasTexto> {
  cargando ??= import("jspdf").then(({ jsPDF }) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const fuente = (estilo: "normal" | "bold", tamano: number) => {
      doc.setFont("helvetica", estilo);
      doc.setFontSize(tamano);
    };
    const medidas: MedidasTexto = {
      medir: (estilo) => (texto, tamano) => {
        fuente(estilo, tamano);
        return doc.getTextWidth(texto);
      },
      partir: (estilo) => (texto, ancho, tamano) => {
        fuente(estilo, tamano);
        return doc.splitTextToSize(texto, ancho) as string[];
      },
    };
    cargadas = medidas;
    return medidas;
  });
  return cargando;
}

export function useMedidasPdf(): MedidasTexto | null {
  const [medidas, setMedidas] = useState<MedidasTexto | null>(() => cargadas);
  useEffect(() => {
    if (medidas) return;
    let vivo = true;
    cargar().then(
      (m) => {
        if (vivo) setMedidas(m);
      },
      () => {
        // Sin jsPDF (red caída): se queda con las medidas a ojo y se reintenta la próxima vez.
        cargando = null;
      },
    );
    return () => {
      vivo = false;
    };
  }, [medidas]);
  return medidas;
}
