import { eur, eurUnitario, fechaCorta, numeroJusto } from "@/lib/format";
import { importeLineaSinIva, pieDocumentoEmitido, type DesgloseIva } from "@/dominio/importes";
import { coloresDocumento, GRIS, TINTA, type RGB } from "@/dominio/maqueta-presupuesto";
import { LETRA, registrarFuentesPdf } from "@/lib/fuentes-pdf";

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
  /**
   * Los colores de la plantilla del ámbito (la del presupuesto de la tienda o
   * de textil). Vacíos o sin plantilla: los de la casa.
   */
  colores?: { principal?: string | null; acento?: string | null } | null;
  /** El nombre de la tienda o de la marca: sale arriba si no hay logo. */
  nombre_comercial?: string | null;
  /** «Transferencia bancaria ES00 …». Sin él, no sale nada. */
  metodo_pago?: string | null;
};

/**
 * La factura o el ticket en A4: el PDF que se guarda como definitivo y el que
 * va en el ZIP del archivo.
 *
 * Lleva la imagen de la casa, pero sobria: es un documento fiscal, no un
 * presupuesto. Del modelo del presupuesto toma el logo, el color principal (en
 * una banda fina arriba, el título, los rótulos de la tabla y la raya del
 * TOTAL) y las letras Inter, que tienen el €. Nada de bloques de color, cintas
 * ni condiciones.
 *
 * Todas las cifras son las congeladas al emitir; aquí no se recalcula ninguna.
 * Un ticket (`simplificada`) sale como FACTURA SIMPLIFICADA: cada línea con su
 * base, y debajo Base, el IVA de cada tipo del desglose congelado y el TOTAL.
 */
const M = 18;
const W = 210;
const LINEA: RGB = [218, 222, 230];
const CEBRA: RGB = [247, 248, 251];

export async function generarFacturaPDF(d: FacturaPDFData): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await registrarFuentesPdf(doc);
  const H = doc.internal.pageSize.getHeight();
  const color = coloresDocumento(d.colores ?? {});
  const principal = color.titulos;
  const tinta = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const letra = (nombre: string, estilo: "normal" | "bold", tam: number) => {
    doc.setFont(nombre, estilo);
    doc.setFontSize(tam);
  };
  const raya = (c: RGB, grosor: number, x1: number, y1: number, x2: number, y2: number) => {
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(grosor);
    doc.line(x1, y1, x2, y2);
  };
  // Un rótulo pequeño en mayúsculas espaciadas: EMISOR, CLIENTE, MÉTODO DE PAGO.
  const rotulo = (t: string, x: number, y: number, c: RGB = GRIS) => {
    letra(LETRA.texto, "bold", 7.5);
    tinta(c);
    doc.text(t.toUpperCase(), x, y, { charSpace: 0.35 });
  };

  // La banda fina de arriba, en todas las páginas (se pinta al final).
  const banda = () => {
    doc.setFillColor(color.banda[0], color.banda[1], color.banda[2]);
    doc.rect(0, 0, W, 3, "F");
  };

  // --- Cabecera: logo (o nombre) a la izquierda; título y datos a la derecha.
  const yCab = 14;
  let altoLogo = 0;
  if (d.logo) {
    try {
      const props = doc.getImageProperties(d.logo.dataUrl);
      const escala = Math.min(48 / props.width, 20 / props.height);
      altoLogo = props.height * escala;
      doc.addImage(d.logo.dataUrl, d.logo.formato, M, yCab, props.width * escala, altoLogo);
    } catch {
      // Un logo ilegible no tumba la factura.
      altoLogo = 0;
    }
  }
  if (!altoLogo) {
    letra(LETRA.texto, "bold", 14);
    tinta(principal);
    doc.text(d.nombre_comercial || d.emisor.nombre || "", M, yCab + 6);
    altoLogo = 8;
  }

  const titulo = (d.titulo ?? (d.simplificada ? "FACTURA SIMPLIFICADA" : "FACTURA")).toUpperCase();
  letra(LETRA.texto, "bold", 17);
  tinta(principal);
  doc.text(titulo, W - M, yCab + 6, { align: "right", charSpace: 0.6 });
  const datos: [string, string][] = [
    ["Número", d.referencia],
    ["Fecha", fechaCorta(d.fecha)],
  ];
  if (d.fecha_vencimiento) datos.push(["Vencimiento", fechaCorta(d.fecha_vencimiento)]);
  let yDatos = yCab + 13;
  for (const [etiqueta, valor] of datos) {
    letra(LETRA.texto, "normal", 8.5);
    tinta(GRIS);
    doc.text(etiqueta, W - M - 38, yDatos);
    letra(LETRA.cifras, "normal", 9);
    tinta(TINTA);
    doc.text(valor, W - M, yDatos, { align: "right" });
    yDatos += 5;
  }

  let y = Math.max(yCab + altoLogo, yDatos - 2) + 6;
  raya(LINEA, 0.3, M, y, W - M, y);
  y += 8;

  // --- Emisor y cliente, a dos columnas.
  const ancho = (W - 2 * M - 10) / 2;
  const xCli = M + ancho + 10;
  rotulo("Emisor", M, y);
  rotulo("Cliente", xCli, y);
  y += 5.5;
  const bloque = (
    x: number,
    nombre: string,
    nif: string | null | undefined,
    dir: string | null | undefined,
  ) => {
    let yy = y;
    letra(LETRA.texto, "bold", 10);
    tinta(TINTA);
    const n = doc.splitTextToSize(nombre || "—", ancho) as string[];
    doc.text(n, x, yy);
    yy += n.length * 4.6;
    letra(LETRA.texto, "normal", 9);
    tinta(GRIS);
    if (nif) {
      doc.text(`NIF ${nif}`, x, yy);
      yy += 4.4;
    }
    const lineas = (dir ?? "")
      .split(/\n/)
      .flatMap((l) => (l.trim() ? (doc.splitTextToSize(l.trim(), ancho) as string[]) : []));
    if (lineas.length) {
      doc.text(lineas, x, yy);
      yy += lineas.length * 4.4;
    }
    return yy;
  };
  const finEmisor = bloque(M, d.emisor.nombre, d.emisor.cif, d.emisor.direccion);
  const finCliente = bloque(xCli, d.cliente.nombre, d.cliente.nif, d.cliente.direccion);
  y = Math.max(finEmisor, finCliente) + 6;

  // --- Las líneas.
  const cabeza = d.simplificada
    ? [["Descripción", "Cantidad", "Precio", "IVA", "Base"]]
    : [["Descripción", "Cantidad", "Precio", "IVA", "Base", "Total"]];
  const filas = d.items.map((it) => {
    const comun = [
      it.descripcion,
      `${numeroJusto(it.cantidad)} ${it.unidad}`.trim(),
      eurUnitario(it.precio_unitario),
      `${numeroJusto(it.iva_rate, 2)}\u00A0%`,
    ];
    return d.simplificada
      ? [...comun, eur(importeLineaSinIva(it))]
      : [...comun, eur(it.subtotal), eur(it.total)];
  });
  autoTable(doc, {
    startY: y,
    head: cabeza,
    body: filas,
    theme: "plain",
    margin: { left: M, right: M, top: 16, bottom: 22 },
    styles: {
      font: LETRA.texto,
      fontSize: 8.8,
      textColor: TINTA,
      cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 },
      lineColor: LINEA,
    },
    headStyles: {
      font: LETRA.texto,
      fontStyle: "bold",
      fontSize: 7.5,
      textColor: principal,
      cellPadding: { top: 2, bottom: 2.4, left: 2, right: 2 },
    },
    alternateRowStyles: { fillColor: CEBRA },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 22 },
      2: { halign: "right", cellWidth: 24 },
      3: { halign: "right", cellWidth: 15 },
      4: { halign: "right", cellWidth: 24, font: LETRA.cifras },
      5: { halign: "right", cellWidth: 24, font: LETRA.cifras },
    },
    didParseCell: (c) => {
      if (c.section === "head") {
        c.cell.text = c.cell.text.map((t) => t.toUpperCase());
        if (c.column.index > 0) c.cell.styles.halign = "right";
      }
    },
    didDrawCell: (c) => {
      // Raya de color bajo los rótulos; gris fina entre filas.
      const { x, y: yc, width, height } = c.cell;
      if (c.section === "head") raya(principal, 0.5, x, yc + height, x + width, yc + height);
      else raya(LINEA, 0.2, x, yc + height, x + width, yc + height);
    },
  });

  // --- Totales a la derecha; método de pago y notas a la izquierda. Tienen que
  // caber enteros: si no, pasan a otra página.
  const pie = pieDocumentoEmitido(d);
  const lineasIva =
    d.simplificada || (d.desglose?.length ?? 0) > 1
      ? pie.iva
      : [{ tipo: d.desglose?.[0]?.tipo ?? null, cuota: d.iva_total }];
  const anchoTot = 72;
  const xTot = W - M - anchoTot;
  const anchoIzq = xTot - M - 10;
  letra(LETRA.texto, "normal", 9);
  const notas: string[] = d.notas ? (doc.splitTextToSize(d.notas, anchoIzq) as string[]) : [];
  const pago: string[] = d.metodo_pago
    ? (doc.splitTextToSize(d.metodo_pago, anchoIzq) as string[])
    : [];
  const altoTot = 6 * (1 + lineasIva.length) + 12;
  const altoIzq =
    (pago.length ? 6 + pago.length * 4.6 + 4 : 0) + (notas.length ? 6 + notas.length * 4.2 : 0);
  let yFin = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  if (yFin + Math.max(altoTot, altoIzq) > H - 24) {
    doc.addPage();
    yFin = 22;
  }

  let yT = yFin;
  const filaTot = (etiqueta: string, valor: number) => {
    letra(LETRA.texto, "normal", 9);
    tinta(GRIS);
    doc.text(etiqueta, xTot, yT);
    letra(LETRA.cifras, "normal", 9.5);
    tinta(TINTA);
    doc.text(eur(valor), W - M, yT, { align: "right" });
    yT += 6;
  };
  filaTot("Base imponible", pie.base);
  for (const r of lineasIva)
    filaTot(r.tipo == null ? "IVA" : `IVA ${numeroJusto(r.tipo, 2)}\u00A0%`, r.cuota);
  raya(principal, 0.6, xTot, yT - 2.5, W - M, yT - 2.5);
  yT += 4;
  letra(LETRA.texto, "bold", 11);
  tinta(principal);
  doc.text("TOTAL", xTot, yT);
  letra(LETRA.texto, "bold", 13);
  doc.text(eur(pie.total), W - M, yT, { align: "right" });

  let yI = yFin;
  if (pago.length) {
    rotulo("Método de pago", M, yI);
    yI += 5;
    letra(LETRA.texto, "bold", 9.5);
    tinta(TINTA);
    doc.text(pago, M, yI);
    yI += pago.length * 4.6 + 5;
  }
  if (notas.length) {
    rotulo("Notas", M, yI);
    yI += 5;
    letra(LETRA.texto, "normal", 9);
    tinta(TINTA);
    doc.text(notas, M, yI);
  }

  // --- Pie de cada página: la sociedad y el número de página.
  const paginas = doc.getNumberOfPages();
  const pieEmisor = [
    d.emisor.nombre,
    d.emisor.cif && `NIF ${d.emisor.cif}`,
    (d.emisor.direccion ?? "").replace(/\s*\n\s*/g, ", "),
  ]
    .filter(Boolean)
    .join(" · ");
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    banda();
    raya(LINEA, 0.3, M, H - 14, W - M, H - 14);
    letra(LETRA.texto, "normal", 7.5);
    tinta(GRIS);
    doc.text(doc.splitTextToSize(pieEmisor, W - 2 * M - 30)[0] ?? "", M, H - 9);
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 9, { align: "right" });
  }

  return doc.output("blob");
}
