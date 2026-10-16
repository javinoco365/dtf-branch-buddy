import { useEffect, useState } from "react";
import { ESPACIADO_ROTULO, type EstiloLetra, type MedidasTexto } from "@/dominio/maqueta-cabecera";
import { partirConMedida } from "@/dominio/maqueta-presupuesto";
import { LETRA, registrarFuentesNavegador, registrarFuentesPdf } from "@/lib/fuentes-pdf";

/**
 * Las medidas de la letra del PDF: Anton e Inter en jsPDF, medidas y partidas
 * con las mismas llamadas que usa el generador (`getTextWidth`,
 * `splitTextToSize`). Así el diseñador encoge y parte los textos de la
 * cabecera igual que el PDF. De paso, deja las mismas letras puestas en el
 * navegador para dibujarlas.
 *
 * jsPDF y las letras son grandes y se cargan aparte (la vista previa también
 * los usa): hasta que llegan, null. Se cargan una vez por pestaña.
 */
let cargadas: MedidasTexto | null = null;
let cargando: Promise<MedidasTexto> | null = null;

function cargar(): Promise<MedidasTexto> {
  cargando ??= import("jspdf").then(async ({ jsPDF }) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    await registrarFuentesPdf(doc);
    // Que el diseñador las dibuje con la letra del PDF; si no, con la parecida.
    registrarFuentesNavegador().catch(() => {});
    const fuente = (estilo: EstiloLetra, tamano: number) => {
      if (estilo === "titular") doc.setFont(LETRA.titular, "normal");
      else doc.setFont(LETRA.texto, estilo === "normal" ? "normal" : "bold");
      doc.setFontSize(tamano);
    };
    const medir = (estilo: EstiloLetra) => (texto: string, tamano: number) => {
      fuente(estilo, tamano);
      const ancho = doc.getTextWidth(texto);
      return estilo === "rotulo" ? ancho + ESPACIADO_ROTULO * texto.length : ancho;
    };
    const medidas: MedidasTexto = {
      medir,
      partir: (estilo) => (texto, ancho, tamano) => {
        if (estilo === "rotulo") return partirConMedida(texto, ancho, tamano, medir("rotulo"));
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
