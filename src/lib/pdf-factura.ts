import { eur, eurUnitario, fechaCorta, numeroJusto } from "@/lib/format";
import { importeLineaSinIva, pieDocumentoEmitido, type DesgloseIva } from "@/dominio/importes";

/** Un logo ya descargado y convertido, listo para incrustar. */
export type LogoPDF = { dataUrl: string; formato: "PNG" | "JPEG" | "WEBP" };

export type FacturaPDFData = {
  /** La referencia visible: 2026/0001, R2026/0001. La compone la base. */
  referencia: string;
  /** Lo que se imprime arriba. FACTURA si no se dice otra cosa. */
  titulo?: string;
  /**
   * Es un ticket (factura simplificada). Cambia la tabla y el pie: cada línea
   * con su importe sin IVA y, debajo, Base / IVA por tipo / TOTAL. Las
   * facturas ordinarias y las rectificativas salen como siempre.
   */
  simplificada?: boolean;
  fecha: string;
  fecha_vencimiento?: string | null;
  emisor: {
    nombre: string;
    cif: string;
    direccion: string;
  };
  cliente: {
    nombre: string;
    nif?: string | null;
    direccion?: string | null;
  };
  items: {
    descripcion: string;
    cantidad: number;
    unidad: string;
    precio_unitario: number;
    iva_rate: number;
    subtotal: number;
    iva: number;
    total: number;
  }[];
  base_imponible: number;
  iva_total: number;
  total: number;
  /** El desglose de IVA que se congeló al emitir. Se imprime tal cual, sin recalcular. */
  desglose?: DesgloseIva[] | null;
  notas?: string | null;
  /**
   * El logo de la tienda o de la marca, congelado en la factura.
   *
   * Si falta, la factura sale sin logo y ya está: un logo que no se pudo
   * descargar no puede impedir emitir ni imprimir un documento fiscal.
   */
  logo?: LogoPDF | null;
};

/**
 * La factura o el ticket en A4: el PDF que se guarda como definitivo, el que
 * va en el ZIP del archivo y el que se manda por correo.
 *
 * Un ticket (`simplificada`) sale como FACTURA SIMPLIFICADA, siempre en A4:
 * cada línea con su importe sin IVA, su base congelada, y debajo la suma:
 * «Base =», una línea «IVA X % =» por cada tipo del desglose congelado y
 * «TOTAL =». Todas las cifras son
 * las congeladas al emitir; aquí no se recalcula ninguna. Una factura
 * ordinaria o rectificativa sale como siempre.
 */
export async function generarFacturaPDF(d: FacturaPDFData): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  let y = 18;

  // El logo, encajado en 40 x 18 mm sin deformarlo. Cada tienda tiene el suyo;
  // la identidad fiscal de abajo es siempre la misma sociedad.
  if (d.logo) {
    try {
      const props = doc.getImageProperties(d.logo.dataUrl);
      const escala = Math.min(40 / props.width, 18 / props.height);
      const ancho = props.width * escala;
      const alto = props.height * escala;
      doc.addImage(d.logo.dataUrl, d.logo.formato, 15, 12, ancho, alto);
      y = 12 + alto + 8;
    } catch {
      // Un logo ilegible no tumba la factura.
    }
  }

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(d.titulo ?? "FACTURA", 15, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Nº ${d.referencia}`, W - 15, 18, { align: "right" });
  doc.text(`Fecha: ${fechaCorta(d.fecha)}`, W - 15, 23, { align: "right" });
  if (d.fecha_vencimiento) {
    doc.text(`Vence: ${fechaCorta(d.fecha_vencimiento)}`, W - 15, 28, { align: "right" });
  }

  y += 18;
  doc.setFont("helvetica", "bold");
  doc.text("Emisor", 15, y);
  doc.text("Cliente", W / 2 + 5, y);
  doc.setFont("helvetica", "normal");
  y += 5;
  doc.text(d.emisor.nombre || "—", 15, y);
  doc.text(d.cliente.nombre || "—", W / 2 + 5, y);
  y += 5;
  doc.text(`CIF/NIF: ${d.emisor.cif || "—"}`, 15, y);
  doc.text(`NIF: ${d.cliente.nif || "—"}`, W / 2 + 5, y);
  y += 5;
  const dirEmisor = doc.splitTextToSize(d.emisor.direccion || "—", 85);
  const dirCliente = doc.splitTextToSize(d.cliente.direccion || "—", 85);
  doc.text(dirEmisor, 15, y);
  doc.text(dirCliente, W / 2 + 5, y);
  y += Math.max(dirEmisor.length, dirCliente.length) * 5 + 6;

  autoTable(doc, {
    startY: y,
    ...(d.simplificada
      ? {
          // El ticket: cada línea con su importe sin IVA, la base congelada.
          head: [["Descripción", "Cant.", "Ud.", "P. unit.", "IVA", "Base"]],
          body: d.items.map((it) => [
            it.descripcion,
            numeroJusto(it.cantidad),
            it.unidad,
            eurUnitario(it.precio_unitario),
            `${numeroJusto(it.iva_rate, 2)} %`,
            eur(importeLineaSinIva(it)),
          ]),
        }
      : {
          head: [["Descripción", "Cant.", "Ud.", "P. unit.", "IVA %", "Subtotal", "Total"]],
          body: d.items.map((it) => [
            it.descripcion,
            it.cantidad.toString(),
            it.unidad,
            eur(it.precio_unitario),
            `${it.iva_rate}%`,
            eur(it.subtotal),
            eur(it.total),
          ]),
        }),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      1: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
    margin: { left: 15, right: 15 },
  });

  // Los totales y las notas (donde va, por ejemplo, la fecha de la operación)
  // tienen que caber enteros: si la tabla acaba al pie de la página, pasan a
  // una nueva en vez de salirse por abajo.
  //
  // El ticket lleva una línea de IVA por cada tipo del desglose; la factura,
  // una sola. El TOTAL va 6 mm por debajo de la última: 11 mm en una factura,
  // y lo que haga falta en un ticket con varios tipos.
  const pie = d.simplificada ? pieDocumentoEmitido(d) : null;
  const yTotal = 5 * (pie ? pie.iva.length : 1) + 6;
  const alto = doc.internal.pageSize.getHeight();
  doc.setFontSize(9);
  const notasLines: string[] = d.notas ? doc.splitTextToSize(d.notas, 180) : [];
  const necesario = yTotal + 1 + (notasLines.length ? 17 + notasLines.length * 4 : 0);
  let finalY = (doc as any).lastAutoTable.finalY + 6;
  if (finalY + necesario > alto - 10) {
    doc.addPage();
    finalY = 20;
  }
  doc.setFontSize(10);
  const xR = W - 15;
  doc.setFont("helvetica", "normal");
  if (pie) {
    // La suma del ticket: base, el IVA de cada tipo y el total, como se
    // congelaron.
    doc.text("Base =", xR - 50, finalY);
    doc.text(eur(pie.base), xR, finalY, { align: "right" });
    pie.iva.forEach((r, i) => {
      const yIva = finalY + 5 * (i + 1);
      doc.text(r.tipo == null ? "IVA =" : `IVA ${numeroJusto(r.tipo, 2)} % =`, xR - 50, yIva);
      doc.text(eur(r.cuota), xR, yIva, { align: "right" });
    });
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL =", xR - 50, finalY + yTotal);
    doc.text(eur(pie.total), xR, finalY + yTotal, { align: "right" });
  } else {
    doc.text("Base imponible:", xR - 50, finalY);
    doc.text(eur(d.base_imponible), xR, finalY, { align: "right" });
    doc.text("IVA:", xR - 50, finalY + 5);
    doc.text(eur(d.iva_total), xR, finalY + 5, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL:", xR - 50, finalY + yTotal);
    doc.text(eur(d.total), xR, finalY + yTotal, { align: "right" });
  }

  if (notasLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Notas:", 15, finalY + yTotal + 11);
    doc.text(notasLines, 15, finalY + yTotal + 16);
  }

  return doc.output("blob");
}
