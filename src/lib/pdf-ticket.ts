import { eur, fechaCorta } from "@/lib/format";
import type { FacturaPDFData } from "@/lib/pdf-factura";

/** Una fila del desglose de IVA congelado en la factura. */
export type DesgloseTicket = { tipo: number; base: number; cuota: number };

export type TicketPDFData = FacturaPDFData & {
  /** El nombre de la tienda o de la marca, encima de la razón social. */
  nombre_comercial?: string | null;
  /** El desglose de IVA que se congeló al emitir. Se imprime tal cual, sin recalcular. */
  desglose?: DesgloseTicket[] | null;
};

const ANCHO = 80;
const MARGEN = 4;
const UTIL = ANCHO - MARGEN * 2;

/**
 * El ticket para la impresora térmica: 80 mm de ancho y el largo que haga
 * falta.
 *
 * Lleva lo que el RD 1619/2012 art. 7 pide a una factura simplificada: número
 * y serie, fecha, razón social y NIF del emisor, qué se vende, el tipo de IVA
 * y el total. Si el cliente dio su nombre, también. El desglose de IVA va
 * siempre: al cliente profesional que lo quiera deducir le hace falta y a los
 * demás no les estorba.
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
  };
  const par = (izq: string, der: string, tam = 8, negrita = false) => {
    doc.setFont("helvetica", negrita ? "bold" : "normal");
    doc.setFontSize(tam);
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

  for (const it of d.items) {
    linea(it.descripcion, 8, false, "left");
    par(
      `  ${it.cantidad} ${it.unidad} x ${eur(it.precio_unitario)} (${it.iva_rate} %)`,
      eur(it.total),
      7,
    );
    y += 0.5;
  }
  separador();

  for (const r of d.desglose ?? []) {
    par(`Base ${r.tipo} %: ${eur(r.base)}`, `IVA ${eur(r.cuota)}`, 7);
  }
  y += 1;
  par("TOTAL", eur(d.total), 11, true);
  y += 1;
  linea("IVA incluido", 7);

  if (d.notas) {
    separador();
    linea(d.notas, 7, false, "left");
  }
  return y;
}
