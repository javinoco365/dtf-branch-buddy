import { eur, eurUnitario, fechaCorta, numeroJusto } from "@/lib/format";
import type { FacturaPDFData } from "@/lib/pdf-factura";
import { importeLineaSinIva, pieDocumentoEmitido } from "@/dominio/importes";

/**
 * Los mismos datos que el A4, desglose de IVA congelado incluido, y además el
 * nombre comercial, que solo imprime el de 80 mm.
 */
export type TicketPDFData = FacturaPDFData & {
  /** El nombre de la tienda o de la marca, encima de la razón social. */
  nombre_comercial?: string | null;
};

const ANCHO = 80;
const MARGEN = 4;
const UTIL = ANCHO - MARGEN * 2;
/** Milímetros que mide un punto tipográfico. */
const MM_POR_PUNTO = 25.4 / 72;
/** Lo que sube una mayúscula de Helvetica sobre su línea base, en cuerpos. */
const ALTURA_MAYUSCULA = 0.72;

/**
 * El ticket para la impresora térmica: 80 mm de ancho y el largo que haga
 * falta.
 *
 * Lleva lo que el RD 1619/2012 art. 7 pide a una factura simplificada: número
 * y serie, fecha, razón social y NIF del emisor, qué se vende, el tipo de IVA
 * y el total. Si el cliente dio su nombre, también.
 *
 * Cada línea lleva su importe sin IVA, su base. Debajo, la suma: la base del
 * documento, una cuota por cada tipo de IVA y el total. El desglose va
 * siempre: al cliente profesional que lo quiera deducir le hace falta y a los
 * demás no les estorba. Todas las cifras son las congeladas al emitir; aquí no
 * se recalcula ninguna.
 */
export async function generarTicketPDF(d: TicketPDFData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  // Primera pasada en un papel largo para saber cuánto mide; la segunda, en su medida.
  const borrador = new jsPDF({ unit: "mm", format: [ANCHO, 1000] });
  const alto = Math.max(pintar(borrador, d) + MARGEN, 50);
  // La orientación, explícita: jsPDF pone en vertical el lado más largo, así
  // que un ticket corto (menos de 80 mm de alto) salía girado, con 80 mm de
  // alto y el ancho recortado: la columna de la derecha se quedaba fuera.
  const doc = new jsPDF({
    unit: "mm",
    format: [ANCHO, alto],
    orientation: alto >= ANCHO ? "portrait" : "landscape",
  });
  pintar(doc, d);
  return doc.output("blob");
}

type Doc = InstanceType<(typeof import("jspdf"))["jsPDF"]>;

function pintar(doc: Doc, d: TicketPDFData): number {
  let y = MARGEN + 3;
  const centro = ANCHO / 2;
  const derecha = ANCHO - MARGEN;
  // El cuerpo de la última línea escrita. El texto se escribe sobre su línea
  // base y crece hacia arriba: una línea más grande que la anterior necesita
  // bajar lo que crece de más, o se monta sobre ella (le pasaba al TOTAL).
  let cuerpoAnterior = Number.POSITIVE_INFINITY;
  const hacerSitio = (tam: number) => {
    if (tam > cuerpoAnterior) y += (tam - cuerpoAnterior) * MM_POR_PUNTO * ALTURA_MAYUSCULA;
    cuerpoAnterior = tam;
  };

  const linea = (
    texto: string,
    tam: number,
    negrita = false,
    alinear: "left" | "center" = "center",
  ) => {
    doc.setFont("helvetica", negrita ? "bold" : "normal");
    doc.setFontSize(tam);
    const partes = doc.splitTextToSize(texto, UTIL) as string[];
    for (const p of partes) {
      hacerSitio(tam);
      doc.text(p, alinear === "center" ? centro : MARGEN, y, { align: alinear });
      y += tam * 0.42;
    }
  };
  const separador = () => {
    y += 1;
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(MARGEN, y, derecha, y);
    doc.setLineDashPattern([], 0);
    y += 4;
    // Los 4 mm de debajo de la raya ya dejan sitio a la línea que siga.
    cuerpoAnterior = Number.POSITIVE_INFINITY;
  };
  const par = (izq: string, der: string, tam = 8, negrita = false) => {
    doc.setFont("helvetica", negrita ? "bold" : "normal");
    doc.setFontSize(tam);
    hacerSitio(tam);
    doc.text(izq, MARGEN, y);
    doc.text(der, derecha, y, { align: "right" });
    y += tam * 0.45;
  };

  if (d.nombre_comercial) linea(d.nombre_comercial, 11, true);
  linea(d.emisor.nombre || "—", 8);
  linea(`NIF ${d.emisor.cif || "—"}`, 8);
  if (d.emisor.direccion) linea(d.emisor.direccion, 7);
  separador();

  linea(d.titulo ?? "FACTURA SIMPLIFICADA", 9, true);
  par(`Nº ${d.referencia}`, fechaCorta(d.fecha));
  if (d.cliente.nombre) {
    y += 0.5;
    linea(`Cliente: ${d.cliente.nombre}`, 7, false, "left");
    if (d.cliente.nif) linea(`NIF: ${d.cliente.nif}`, 7, false, "left");
    if (d.cliente.direccion) linea(d.cliente.direccion, 7, false, "left");
  }
  separador();

  // Cada línea, con su importe sin IVA: la base congelada al emitir.
  for (const it of d.items) {
    linea(it.descripcion, 8, false, "left");
    par(
      `  ${numeroJusto(it.cantidad)} ${it.unidad} x ${eurUnitario(it.precio_unitario)} (${numeroJusto(it.iva_rate, 2)} %)`,
      eur(importeLineaSinIva(it)),
      7,
    );
    y += 0.5;
  }
  separador();

  // La suma: base, el IVA de cada tipo y el total, como se congelaron.
  const pie = pieDocumentoEmitido(d);
  par("Base =", eur(pie.base), 8);
  for (const r of pie.iva) {
    par(r.tipo == null ? "IVA =" : `IVA ${numeroJusto(r.tipo, 2)} % =`, eur(r.cuota), 8);
  }
  y += 1.5;
  par("TOTAL =", eur(pie.total), 11, true);

  if (d.notas) {
    separador();
    linea(d.notas, 7, false, "left");
  }
  return y;
}
