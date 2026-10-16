import { eur, eurUnitario, fechaCorta, numeroJusto } from "@/lib/format";
import type { LogoPDF } from "@/lib/pdf-factura";
import type { DocumentoPresupuesto } from "@/dominio/presupuestos";
import { PLANTILLA_POR_DEFECTO, type PlantillaPresupuesto } from "@/dominio/plantilla-presupuesto";

/**
 * El PDF de un presupuesto de tienda, en A4.
 *
 * Es un documento comercial, no fiscal: lo que tiene que hacer es dejar claro
 * quién ofrece qué, a quién, por cuánto y hasta cuándo. Las cifras llegan ya
 * hechas (`documentoPresupuesto`, en el dominio): aquí no se suma nada, solo se
 * coloca. La tabla va sin IVA, línea a línea, y debajo el resumen de siempre:
 * Base imponible, el IVA de cada tipo y el TOTAL.
 */

type RGB = [number, number, number];

export type PresupuestoPDFData = {
  /** PRES-DTFC-2026-0001. */
  numero: string;
  /** `yyyy-MM-dd`. */
  fecha: string;
  validez_dias: number;
  /** Las cifras, las líneas y la fecha de caducidad, del dominio. */
  documento: DocumentoPresupuesto;
  emisor: {
    /** El nombre de la tienda: DTF Culture. */
    nombre_comercial: string;
    /** La sociedad que emite: la misma en todas las tiendas. */
    razon_social: string;
    cif: string;
    /** Calle, «CP Ciudad», «Provincia, País»: las líneas que haya. */
    direccion: string[];
    email?: string | null;
    telefono?: string | null;
    /** La web de la tienda, sin https:// delante. */
    web?: string | null;
  };
  cliente: {
    nombre: string;
    empresa?: string | null;
    nif?: string | null;
    direccion: string[];
    email?: string | null;
    telefono?: string | null;
  };
  notas?: string | null;
  logo?: LogoPDF | null;
  /** El color de la tienda (`tiendas.color`), si lo tiene. */
  color?: string | null;
};

// La identidad de DTI: azul marino y azul cielo, los mismos que la aplicación.
const MARINO: RGB = [42, 34, 96];
const CIELO: RGB = [0, 168, 228];
const TEXTO: RGB = [15, 23, 42];
const GRIS: RGB = [100, 116, 139];
const LINEA: RGB = [226, 232, 240];
const FONDO: RGB = [248, 250, 252];
const BLANCO: RGB = [255, 255, 255];

const W = 210;
const H = 297;
const M = 16;
/** Lo que se reserva abajo para el pie de página. */
const PIE = 24;

/** «#2a2260» o «#22a» a RGB; null si no es un color en hexadecimal. */
export function colorHex(css: string | null | undefined): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((css ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/**
 * El color de la tienda si el texto blanco se lee bien encima (contraste 4,5:1
 * o más); si no, o si no tiene, el azul marino de la casa. Un color claro en la
 * cabecera de la tabla dejaría las letras blancas ilegibles al imprimir.
 */
export function coloresPresupuesto(css: string | null | undefined): {
  principal: RGB;
  acento: RGB;
} {
  const c = colorHex(css);
  if (c) {
    const lin = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const luminancia = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    if (1.05 / (luminancia + 0.05) >= 4.5) return { principal: c, acento: c };
  }
  return { principal: MARINO, acento: CIELO };
}

/** 3 m · 2 ud · 12,5 m. */
const cantidadConUnidad = (cantidad: number, unidad: string) =>
  `${numeroJusto(cantidad)} ${unidad}`;

/**
 * Lo que necesita el editor de plantillas para enseñar la vista previa: los
 * datos del último presupuesto del ámbito (o sin líneas, si no hay ninguno),
 * sin logo, y la identidad de la tienda o de la marca para que el editor le
 * aplique la plantilla (`resolverIdentidad`).
 */
export type VistaPreviaPresupuesto = {
  datos: PresupuestoPDFData;
  base: { nombre: string | null; logo_url: string | null; color: string | null };
  /** El número del presupuesto que se enseña; null si no hay ninguno todavía. */
  numero: string | null;
};

export async function generarPresupuestoPDF(
  d: PresupuestoPDFData,
  plantilla: PlantillaPresupuesto = PLANTILLA_POR_DEFECTO,
): Promise<Blob> {
  void plantilla; // La usa el maquetador con plantilla (siguiente paso).
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { principal, acento } = coloresPresupuesto(d.color);
  const doc_ = d.documento;

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const fuente = (estilo: "normal" | "bold", tam: number, c: RGB = TEXTO) => {
    doc.setFont("helvetica", estilo);
    doc.setFontSize(tam);
    color(c);
  };
  /** Un rótulo pequeño en mayúsculas espaciadas: EMISOR, CONDICIONES… */
  const rotulo = (texto: string, x: number, y: number) => {
    fuente("bold", 7.5, principal);
    doc.text(texto.toUpperCase(), x, y, { charSpace: 0.35 });
  };

  // ---------------------------------------------------------------------------
  // Cabecera: logo a la izquierda; PRESUPUESTO, número y fechas a la derecha
  // ---------------------------------------------------------------------------
  let altoLogo = 0;
  if (d.logo) {
    try {
      const props = doc.getImageProperties(d.logo.dataUrl);
      const escala = Math.min(52 / props.width, 22 / props.height);
      altoLogo = props.height * escala;
      doc.addImage(d.logo.dataUrl, d.logo.formato, M, 14, props.width * escala, altoLogo);
    } catch {
      // Un logo ilegible no impide sacar el presupuesto: sale el nombre.
      altoLogo = 0;
    }
  }
  if (!altoLogo) {
    fuente("bold", 18, principal);
    const nombre = doc.splitTextToSize(d.emisor.nombre_comercial || d.emisor.razon_social, 95);
    doc.text(nombre[0] ?? "", M, 24);
    altoLogo = 12;
  }

  fuente("bold", 24, principal);
  doc.text("PRESUPUESTO", W - M, 23, { align: "right" });

  const datos: [string, string][] = [
    ["Número", d.numero],
    ["Fecha", fechaCorta(d.fecha)],
    ["Válido hasta", fechaCorta(doc_.validoHasta)],
  ];
  datos.forEach(([etiqueta, valor], i) => {
    const y = 31 + i * 5.5;
    fuente("normal", 8.5, GRIS);
    doc.text(etiqueta, W - M - 66, y);
    fuente("bold", 9.5);
    doc.text(valor, W - M, y, { align: "right" });
  });

  let y = Math.max(14 + altoLogo, 31 + 2 * 5.5) + 6;
  doc.setDrawColor(acento[0], acento[1], acento[2]);
  doc.setLineWidth(0.8);
  doc.line(M, y, W - M, y);

  // ---------------------------------------------------------------------------
  // Emisor y cliente, en dos cajas iguales
  // ---------------------------------------------------------------------------
  y += 7;
  const anchoCaja = (W - 2 * M - 6) / 2;
  const anchoTexto = anchoCaja - 9;
  doc.setFontSize(9);
  const partir = (lineas: (string | null | undefined)[]) =>
    lineas
      .map((l) => (typeof l === "string" ? l.trim() : ""))
      .filter(Boolean)
      .flatMap((l) => doc.splitTextToSize(l, anchoTexto) as string[]);

  const e = d.emisor;
  const contactoEmisor = [e.email, e.telefono].filter(Boolean).join(" · ");
  const emisor = {
    titular: partir([e.nombre_comercial || e.razon_social]),
    resto: partir([
      e.nombre_comercial && e.razon_social !== e.nombre_comercial ? e.razon_social : null,
      e.cif ? `CIF: ${e.cif}` : null,
      ...e.direccion,
      contactoEmisor,
      e.web,
    ]),
  };
  const c = d.cliente;
  const cliente = {
    titular: partir([c.nombre || "—"]),
    resto: partir([
      c.empresa && c.empresa !== c.nombre ? c.empresa : null,
      c.nif ? `NIF/CIF: ${c.nif}` : null,
      ...c.direccion,
      c.email,
      c.telefono,
    ]),
  };

  const altoLinea = 4.3;
  const lineasCaja = Math.max(
    emisor.titular.length + emisor.resto.length,
    cliente.titular.length + cliente.resto.length,
  );
  const altoCaja = 12 + lineasCaja * altoLinea + 2;
  [
    { x: M, titulo: "Emisor", bloque: emisor },
    { x: M + anchoCaja + 6, titulo: "Cliente", bloque: cliente },
  ].forEach(({ x, titulo, bloque }) => {
    doc.setFillColor(FONDO[0], FONDO[1], FONDO[2]);
    doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, anchoCaja, altoCaja, 1.8, 1.8, "FD");
    rotulo(titulo, x + 4.5, y + 6);
    let yy = y + 11.5;
    fuente("bold", 10);
    bloque.titular.forEach((l) => {
      doc.text(l, x + 4.5, yy);
      yy += altoLinea + 0.4;
    });
    fuente("normal", 9);
    bloque.resto.forEach((l) => {
      doc.text(l, x + 4.5, yy);
      yy += altoLinea;
    });
  });
  y += altoCaja + 8;

  // ---------------------------------------------------------------------------
  // Las líneas, sin IVA: la columna Importe suma la base imponible
  // ---------------------------------------------------------------------------
  autoTable(doc, {
    startY: y,
    head: [["Descripción", "Cantidad", "Precio unit.", "IVA", "Importe"]],
    body: doc_.lineas.map((l) => [
      l.descripcion,
      cantidadConUnidad(l.cantidad, l.unidad),
      `${eurUnitario(l.precio_unitario)}/${l.unidad}`,
      `${numeroJusto(l.iva_rate, 2)} %`,
      eur(l.importe),
    ]),
    theme: "plain",
    showHead: "everyPage",
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: TEXTO,
      cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
      lineColor: LINEA,
      lineWidth: { bottom: 0.2 },
      valign: "middle",
    },
    headStyles: {
      fillColor: principal,
      textColor: BLANCO,
      fontStyle: "bold",
      fontSize: 8.5,
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: FONDO },
    columnStyles: {
      1: { halign: "right", cellWidth: 25 },
      2: { halign: "right", cellWidth: 28 },
      3: { halign: "right", cellWidth: 16 },
      4: { halign: "right", cellWidth: 28, fontStyle: "bold" },
    },
    didParseCell: (h) => {
      // La cabecera de las columnas de cifras, alineada con sus cifras.
      if (h.section === "head" && h.column.index > 0) h.cell.styles.halign = "right";
    },
    margin: { left: M, right: M, top: 26, bottom: PIE + 4 },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  /** Si lo que viene no cabe en lo que queda de página, a la siguiente. */
  const sitio = (alto: number) => {
    if (y + alto > H - PIE) {
      doc.addPage();
      y = 26;
    }
  };

  // ---------------------------------------------------------------------------
  // Resumen: metros a la izquierda; Base imponible, IVA y TOTAL a la derecha
  // ---------------------------------------------------------------------------
  const filasIva = doc_.iva.length;
  const altoResumen = 7 + 6 * (1 + filasIva) + 13;
  sitio(altoResumen);

  if (doc_.metros > 0) {
    rotulo("Metros totales", M, y + 4);
    fuente("bold", 13, principal);
    doc.text(`${numeroJusto(doc_.metros)} m`, M, y + 11);
  }

  const anchoResumen = 78;
  const xr = W - M - anchoResumen;
  let yr = y + 4;
  const filaResumen = (etiqueta: string, valor: string) => {
    fuente("normal", 9.5, GRIS);
    doc.text(etiqueta, xr + 3, yr);
    fuente("bold", 9.5);
    doc.text(valor, W - M - 3, yr, { align: "right" });
    yr += 6;
  };
  filaResumen("Base imponible", eur(doc_.base));
  doc_.iva.forEach((r) =>
    filaResumen(r.tipo == null ? "IVA" : `IVA ${numeroJusto(r.tipo, 2)} %`, eur(r.cuota)),
  );
  doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
  doc.setLineWidth(0.3);
  doc.line(xr, yr - 3, W - M, yr - 3);
  doc.setFillColor(principal[0], principal[1], principal[2]);
  doc.roundedRect(xr, yr - 0.5, anchoResumen, 11, 1.5, 1.5, "F");
  fuente("bold", 10.5, BLANCO);
  doc.text("TOTAL", xr + 4, yr + 6.6);
  fuente("bold", 13, BLANCO);
  doc.text(eur(doc_.total), W - M - 4, yr + 6.8, { align: "right" });
  y = yr + 11 + 9;

  // ---------------------------------------------------------------------------
  // Observaciones, condiciones y aceptación
  // ---------------------------------------------------------------------------
  /** Un bloque con rótulo y párrafos, que pasa de página línea a línea si es largo. */
  const bloque = (titulo: string, parrafos: string[]) => {
    fuente("normal", 9);
    const lineas = parrafos.flatMap((p) => doc.splitTextToSize(p, W - 2 * M) as string[]);
    if (!lineas.length) return;
    sitio(7 + Math.min(lineas.length, 3) * 4.4);
    rotulo(titulo, M, y);
    y += 5.5;
    fuente("normal", 9);
    for (const l of lineas) {
      sitio(4.4);
      fuente("normal", 9);
      doc.text(l, M, y);
      y += 4.4;
    }
    y += 5;
  };

  if (d.notas?.trim()) bloque("Observaciones", d.notas.trim().split(/\r?\n/));

  const contacto = [e.email, e.telefono].filter(Boolean).join(" · ");
  bloque("Condiciones", [
    `Validez: hasta el ${fechaCorta(doc_.validoHasta)}, ${d.validez_dias} ${
      d.validez_dias === 1 ? "día" : "días"
    } desde la fecha del presupuesto.`,
    "Precios e importes de las líneas sin IVA. El IVA se suma en el resumen, por tipo.",
    ...(contacto ? [`Para aceptarlo o resolver cualquier duda: ${contacto}.`] : []),
  ]);

  // La conformidad del cliente: fecha y firma.
  const altoAceptacion = 30;
  sitio(altoAceptacion);
  doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
  doc.setLineWidth(0.2);
  doc.roundedRect(M, y, W - 2 * M, altoAceptacion - 4, 1.8, 1.8, "S");
  rotulo("Aceptación del cliente", M + 4.5, y + 6);
  fuente("normal", 8.5, GRIS);
  doc.text(`Conforme con el presupuesto ${d.numero} y sus condiciones.`, M + 4.5, y + 11.5);
  const yFirma = y + 21;
  doc.setDrawColor(GRIS[0], GRIS[1], GRIS[2]);
  doc.setLineWidth(0.2);
  fuente("normal", 8.5, GRIS);
  doc.text("Fecha", M + 4.5, yFirma);
  doc.line(M + 16, yFirma, M + 62, yFirma);
  doc.text("Firma y sello", M + 72, yFirma);
  doc.line(M + 94, yFirma, W - M - 6, yFirma);

  // ---------------------------------------------------------------------------
  // En cada página: el pie con la sociedad y el número de página; desde la
  // segunda, arriba, a qué presupuesto pertenece
  // ---------------------------------------------------------------------------
  const paginas = doc.getNumberOfPages();
  const sociedad = [e.razon_social, e.cif ? `CIF ${e.cif}` : null, e.direccion.join(", ")]
    .filter(Boolean)
    .join(" · ");
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
    doc.setLineWidth(0.3);
    doc.line(M, H - 15, W - M, H - 15);
    fuente("normal", 7, GRIS);
    const pie = doc.splitTextToSize(sociedad, W - 2 * M - 30) as string[];
    doc.text(pie.slice(0, 2), M, H - 10.5);
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 10.5, { align: "right" });
    if (i > 1) {
      fuente("bold", 8.5, principal);
      doc.text(`Presupuesto ${d.numero}`, M, 16);
      fuente("normal", 8.5, GRIS);
      doc.text(e.nombre_comercial || e.razon_social, W - M, 16, { align: "right" });
    }
  }

  return doc.output("blob");
}
