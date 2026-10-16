import { eur, eurUnitario, fechaCorta, numeroJusto } from "@/lib/format";
import type { LogoPDF } from "@/lib/pdf-factura";
import type { DocumentoPresupuesto, LineaDocumentoPresupuesto } from "@/dominio/presupuestos";
import {
  ALTO_PAGINA as H,
  ANCHO_PAGINA as W,
  MARGEN as M,
  PLANTILLA_POR_DEFECTO,
  normalizarPlantilla,
  rellenarTexto,
  type Alineacion,
  type PlantillaPresupuesto,
  type ValoresPlantilla,
} from "@/dominio/plantilla-presupuesto";
import {
  LINEAS_CON_ACEPTACION,
  TINTA,
  altoLinea,
  anchoDisponible,
  anchosColumnas,
  bajada,
  cajaTexto,
  colorHex,
  coloresDocumento,
  encajarImagen,
  encajarTexto,
  inicioCuerpo,
  juntarConAceptacion,
  maquetaPie,
  subida,
  type Caja,
  type ColumnaCifra,
  type Medir,
  type Partir,
  type RGB,
} from "@/dominio/maqueta-presupuesto";

/**
 * El PDF de un presupuesto, en A4: el de las tiendas y el del textil.
 *
 * Es un documento comercial, no fiscal: lo que tiene que hacer es dejar claro
 * quién ofrece qué, a quién, por cuánto y hasta cuándo. Las cifras llegan ya
 * hechas (`documentoPresupuesto`, en el dominio): aquí no se suma nada, solo se
 * coloca. La tabla va sin IVA, línea a línea, y debajo el resumen de siempre:
 * Base imponible, el IVA de cada tipo y el TOTAL.
 *
 * Qué sale, dónde y con qué textos lo dice la plantilla del ámbito
 * (`plantilla-presupuesto.ts`, editable en Ajustes generales). Con la de por
 * defecto sale el diseño de siempre. Las cuentas de la maqueta (cuánto sitio
 * tiene cada texto, el pie, los anchos de columna, el paso de página) están en
 * `maqueta-presupuesto.ts`.
 */

export { colorHex };

export type PresupuestoPDFData = {
  /** PRES-DTFC-2026-0001. Vacío en la vista previa de un ámbito sin presupuestos. */
  numero: string;
  /** `yyyy-MM-dd`. */
  fecha: string;
  validez_dias: number;
  /** Las cifras, las líneas y la fecha de caducidad, del dominio. */
  documento: DocumentoPresupuesto;
  emisor: {
    /** El nombre de la tienda o de la marca: DTF Culture. */
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
  /** El color de la tienda (`tiendas.color`) o de la marca, si lo tiene. */
  color?: string | null;
};

const GRIS: RGB = [100, 116, 139];
const LINEA: RGB = [226, 232, 240];
const FONDO: RGB = [248, 250, 252];

/** Desde la segunda página, el cuerpo empieza aquí (arriba va a qué presupuesto pertenece). */
const ARRIBA = 26;

const ALINEAR = { izquierda: "left", centro: "center", derecha: "right" } as const;

/**
 * El color de la tienda si el texto blanco se lee bien encima (contraste 4,5:1
 * o más); si no, o si no tiene, el azul marino de la casa. Un color claro en la
 * cabecera de la tabla dejaría las letras blancas ilegibles al imprimir.
 */
export function coloresPresupuesto(css: string | null | undefined): {
  principal: RGB;
  acento: RGB;
} {
  const { principal, acento } = coloresDocumento({ base: css });
  return { principal, acento };
}

/** 3 m · 2 ud · 12,5 m. */
const cantidadConUnidad = (cantidad: number, unidad: string) =>
  `${numeroJusto(cantidad)} ${unidad}`;

/**
 * Lo que valen las variables de los textos de la plantilla ({numero},
 * {razon_social}, {contacto}…) en este presupuesto. El nombre comercial, el que
 * sale en el PDF (el de la plantilla, si lo cambia).
 */
export function valoresPresupuesto(
  d: PresupuestoPDFData,
  nombreComercial: string = d.emisor.nombre_comercial,
): ValoresPlantilla {
  const e = d.emisor;
  return {
    // Sin número solo está la vista previa de un ámbito sin presupuestos.
    numero: d.numero.trim() || "—",
    fecha: fechaCorta(d.fecha),
    fecha_validez: fechaCorta(d.documento.validoHasta),
    validez: `${d.validez_dias} ${d.validez_dias === 1 ? "día" : "días"}`,
    nombre_comercial: nombreComercial,
    razon_social: e.razon_social,
    cif: e.cif,
    direccion: e.direccion.join(", "),
    email: e.email,
    telefono: e.telefono,
    web: e.web,
    contacto: [e.email, e.telefono].filter(Boolean).join(" · "),
  };
}

/** «PRESUPUESTO» → «Presupuesto», para el encabezado de las páginas siguientes. */
const enFrase = (texto: string) => {
  const t = texto.trim();
  return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

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
  // Una plantilla a medio editar o vieja también sirve: se completa.
  const p = normalizarPlantilla(plantilla);
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { principal, acento, sobrePrincipal, textoPrincipal } = coloresDocumento({
    principal: p.colores.principal,
    acento: p.colores.acento,
    base: d.color,
  });
  const doc_ = d.documento;
  const e = d.emisor;
  const nombreComercial =
    p.cabecera.nombre.texto.trim() || e.nombre_comercial.trim() || e.razon_social.trim();
  const valores = valoresPresupuesto(d, nombreComercial);

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const fuente = (estilo: "normal" | "bold", tam: number, c: RGB = TINTA) => {
    doc.setFont("helvetica", estilo);
    doc.setFontSize(tam);
    color(c);
  };
  const medir =
    (estilo: "normal" | "bold"): Medir =>
    (texto, tam) => {
      fuente(estilo, tam);
      return doc.getTextWidth(texto);
    };
  const partir =
    (estilo: "normal" | "bold"): Partir =>
    (texto, ancho, tam) => {
      fuente(estilo, tam);
      return doc.splitTextToSize(texto, ancho) as string[];
    };
  /** El ancho de la línea más larga, con la fuente puesta. */
  const anchoMayor = (lineas: string[]) => Math.max(0, ...lineas.map((l) => doc.getTextWidth(l)));
  /** Un rótulo pequeño en mayúsculas espaciadas: EMISOR, CONDICIONES… Nunca más ancho que `anchoMax`. */
  const rotulo = (texto: string, x: number, y: number, anchoMax = W - 2 * M) => {
    const t = texto.trim().toUpperCase();
    if (!t) return;
    fuente("bold", 7.5, textoPrincipal);
    const ancho = doc.getTextWidth(t);
    if (ancho > anchoMax) doc.setFontSize(Math.max(5, (7.5 * anchoMax) / ancho));
    const espacio = Math.max(0, Math.min(0.35, (anchoMax - doc.getTextWidth(t)) / t.length));
    doc.text(t, x, y, { charSpace: espacio });
  };

  // ---------------------------------------------------------------------------
  // El pie, primero: cuántas líneas lleva decide hasta dónde llega el cuerpo
  // ---------------------------------------------------------------------------
  const pie = p.pie;
  fuente("normal", pie.tamano, GRIS);
  const reservaPaginas = pie.paginas ? Math.max(30, doc.getTextWidth("Página 99 de 99") + 8) : 0;
  const anchoPie = W - 2 * M - (pie.alineacion === "centro" ? 2 : 1) * reservaPaginas;
  const parrafosPie = rellenarTexto(pie.texto, valores);
  const partirPie = (tam: number) => parrafosPie.flatMap((l) => partir("normal")(l, anchoPie, tam));
  // Hasta tres líneas: si no caben, letra más pequeña antes que cortar.
  let tamPie = pie.tamano;
  let lineasPie = partirPie(tamPie);
  while (lineasPie.length > 3 && tamPie > 5) {
    tamPie = Math.max(5, tamPie - 0.5);
    lineasPie = partirPie(tamPie);
  }
  const hayPie = lineasPie.length > 0 || pie.paginas;
  const mp = maquetaPie(lineasPie.length, tamPie);
  const limiteAceptacion = mp.raya - 5;

  // ---------------------------------------------------------------------------
  // Cabecera: cada elemento donde diga la plantilla. Lo que se dibuja estorba
  // a lo que viene después, que se encoge o se parte para no pisarlo.
  // ---------------------------------------------------------------------------
  const cab = p.cabecera;
  const dibujado: Caja[] = [];

  let hayLogo = false;
  if (cab.logo.mostrar && d.logo) {
    try {
      const props = doc.getImageProperties(d.logo.dataUrl);
      const caja = encajarImagen(cab.logo, { ancho: props.width, alto: props.height });
      doc.addImage(
        d.logo.dataUrl,
        d.logo.formato,
        caja.x0,
        caja.y0,
        caja.x1 - caja.x0,
        caja.y1 - caja.y0,
      );
      dibujado.push(caja);
      hayLogo = true;
    } catch {
      // Un logo ilegible no impide sacar el presupuesto: sale el nombre.
    }
  }

  if (cab.datos.mostrar) {
    const { x, y, ancho } = cab.datos;
    // Una etiqueta vacía quita su fila.
    const filas = (
      [
        [cab.datos.etiquetaNumero, d.numero.trim() || "—"],
        [cab.datos.etiquetaFecha, fechaCorta(d.fecha)],
        [cab.datos.etiquetaValidez, fechaCorta(doc_.validoHasta)],
      ] as const
    ).filter(([etiqueta]) => etiqueta.trim());
    filas.forEach(([etiqueta, valor], i) => {
      fuente("normal", 8.5, GRIS);
      doc.text(etiqueta.trim(), x, y + i * 5.5);
      fuente("bold", 9.5);
      doc.text(valor, x + ancho, y + i * 5.5, { align: "right" });
    });
    if (filas.length) {
      dibujado.push({
        x0: x,
        y0: y - subida(9.5),
        x1: x + ancho,
        y1: y + (filas.length - 1) * 5.5 + bajada(9.5),
      });
    }
  }

  /** Un texto de la cabecera, encajado en el sitio que le queda. */
  const textoCabecera = (
    t: { x: number; y: number; tamano: number; alineacion: Alineacion },
    texto: string,
    estilo: "normal" | "bold",
    c: RGB,
    opciones: { minimoUnaLinea: number; maxLineas: number; lineasPrevistas: number },
  ) => {
    const banda = {
      y0: t.y - subida(t.tamano),
      y1: t.y + (opciones.lineasPrevistas - 1) * altoLinea(t.tamano) + bajada(t.tamano),
    };
    const ancho = anchoDisponible(t, banda, dibujado);
    const { tamano, lineas } = encajarTexto(
      texto,
      ancho,
      { tamano: t.tamano, minimo: 6, ...opciones },
      medir(estilo),
      partir(estilo),
    );
    if (!lineas.length) return;
    fuente(estilo, tamano, c);
    doc.text(lineas, t.x, t.y, { align: ALINEAR[t.alineacion] });
    dibujado.push(cajaTexto(t.x, t.y, anchoMayor(lineas), lineas.length, tamano, t.alineacion));
  };

  if (cab.titulo.mostrar && cab.titulo.texto.trim()) {
    textoCabecera(cab.titulo, cab.titulo.texto, "bold", textoPrincipal, {
      minimoUnaLinea: 6,
      maxLineas: 1,
      lineasPrevistas: 1,
    });
  }

  if (cab.texto.mostrar) {
    // El texto libre no se encoge: se parte en las líneas que haga falta.
    const t = cab.texto;
    const parrafos = rellenarTexto(t.texto, valores);
    if (parrafos.length) {
      const banda = {
        y0: t.y - subida(t.tamano),
        y1: t.y + parrafos.length * altoLinea(t.tamano) + bajada(t.tamano),
      };
      const ancho = anchoDisponible(t, banda, dibujado);
      const lineas = parrafos.flatMap((l) => partir("normal")(l, ancho, t.tamano));
      fuente("normal", t.tamano, GRIS);
      doc.text(lineas, t.x, t.y, { align: ALINEAR[t.alineacion] });
      dibujado.push(cajaTexto(t.x, t.y, anchoMayor(lineas), lineas.length, t.tamano, t.alineacion));
    }
  }

  const n = cab.nombre;
  if (n.mostrar === "siempre" || (n.mostrar === "auto" && !hayLogo)) {
    // Nunca cortado: primero más pequeño, luego en dos líneas.
    textoCabecera(n, nombreComercial, "bold", textoPrincipal, {
      minimoUnaLinea: (n.tamano * 2) / 3,
      maxLineas: 2,
      lineasPrevistas: 2,
    });
  }

  if (cab.linea) {
    doc.setDrawColor(acento[0], acento[1], acento[2]);
    doc.setLineWidth(0.8);
    doc.line(M, cab.alto, W - M, cab.alto);
  }
  let y = inicioCuerpo(cab.alto, dibujado);

  // ---------------------------------------------------------------------------
  // Emisor y cliente, en dos cajas iguales (o una a todo lo ancho)
  // ---------------------------------------------------------------------------
  const pa = p.partes;
  const c = d.cliente;
  // Una caja oculta deja todo el ancho a la otra.
  const cajas = (
    pa.emisorPrimero ? (["emisor", "cliente"] as const) : (["cliente", "emisor"] as const)
  ).filter((k) => pa[k].mostrar);

  if (cajas.length) {
    const anchoCaja = cajas.length === 2 ? (W - 2 * M - 6) / 2 : W - 2 * M;
    const anchoTexto = anchoCaja - 9;
    // Cada parte se mide con la fuente con la que se dibuja.
    const partirEn = (estilo: "normal" | "bold", tam: number, lineas: unknown[]) =>
      lineas
        .map((l) => (typeof l === "string" ? l.trim() : ""))
        .filter(Boolean)
        .flatMap((l) => partir(estilo)(l, anchoTexto, tam));

    const contactoEmisor = [pa.emisor.email && e.email, pa.emisor.telefono && e.telefono]
      .filter(Boolean)
      .join(" · ");
    const bloques = {
      emisor: {
        titulo: pa.emisor.titulo,
        titular: partirEn("bold", 10, [nombreComercial]),
        resto: partirEn("normal", 9, [
          pa.emisor.razonSocial && e.razon_social !== nombreComercial ? e.razon_social : null,
          pa.emisor.cif && e.cif ? `CIF: ${e.cif}` : null,
          ...(pa.emisor.direccion ? e.direccion : []),
          contactoEmisor,
          pa.emisor.web ? e.web : null,
        ]),
      },
      cliente: {
        titulo: pa.cliente.titulo,
        titular: partirEn("bold", 10, [c.nombre.trim() || "—"]),
        resto: partirEn("normal", 9, [
          pa.cliente.empresa && c.empresa && c.empresa !== c.nombre ? c.empresa : null,
          pa.cliente.nif && c.nif ? `NIF/CIF: ${c.nif}` : null,
          ...(pa.cliente.direccion ? c.direccion : []),
          pa.cliente.email ? c.email : null,
          pa.cliente.telefono ? c.telefono : null,
        ]),
      },
    };

    const altoTitular = 4.7;
    const altoResto = 4.3;
    const conTitulo = cajas.some((k) => bloques[k].titulo.trim());
    const primeraLinea = conTitulo ? 11.5 : 6.5;
    // Hasta la última línea base de la caja más llena, y 6,4 mm de aire debajo.
    const ultimaLinea = Math.max(
      ...cajas.map((k) => {
        const { titular, resto } = bloques[k];
        const avance = titular.length * altoTitular + resto.length * altoResto;
        return avance - (resto.length ? altoResto : altoTitular);
      }),
    );
    const altoCaja = primeraLinea + ultimaLinea + 6.4;
    cajas.forEach((k, i) => {
      const x = M + i * (anchoCaja + 6);
      const b = bloques[k];
      doc.setFillColor(FONDO[0], FONDO[1], FONDO[2]);
      doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, anchoCaja, altoCaja, 1.8, 1.8, "FD");
      rotulo(b.titulo, x + 4.5, y + 6, anchoTexto);
      let yy = y + primeraLinea;
      fuente("bold", 10);
      b.titular.forEach((l) => {
        doc.text(l, x + 4.5, yy);
        yy += altoTitular;
      });
      fuente("normal", 9);
      b.resto.forEach((l) => {
        doc.text(l, x + 4.5, yy);
        yy += altoResto;
      });
    });
    y += altoCaja + 8;
  }

  // ---------------------------------------------------------------------------
  // Las líneas, sin IVA: la columna Importe suma la base imponible
  // ---------------------------------------------------------------------------
  const tb = p.tabla;
  type Columna = { clave: "descripcion" | ColumnaCifra; titulo: string };
  const columnas = (
    [
      { clave: "descripcion", titulo: tb.descripcion },
      tb.mostrarCantidad && { clave: "cantidad", titulo: tb.cantidad },
      tb.mostrarPrecio && { clave: "precio", titulo: tb.precio },
      tb.mostrarIva && { clave: "iva", titulo: tb.iva },
      { clave: "importe", titulo: tb.importe },
    ] as (Columna | false)[]
  ).filter((col): col is Columna => !!col);

  const precioJunto = (l: LineaDocumentoPresupuesto) =>
    `${eurUnitario(l.precio_unitario)}/${l.unidad}`;
  const cifras: Record<ColumnaCifra, (l: LineaDocumentoPresupuesto) => string> = {
    cantidad: (l) => cantidadConUnidad(l.cantidad, l.unidad),
    precio: precioJunto,
    iva: (l) => `${numeroJusto(l.iva_rate, 2)} %`,
    importe: (l) => eur(l.importe),
  };
  // Lo que necesita cada columna para que nada se parta a media palabra: su
  // cifra más ancha y la palabra más larga de su título, con el relleno.
  const relleno = 6.5;
  const necesarios: Partial<Record<ColumnaCifra, number>> = {};
  for (const col of columnas) {
    if (col.clave === "descripcion") continue;
    const k = col.clave;
    const cuerpo = medir(k === "importe" ? "bold" : "normal");
    const titulo = medir("bold");
    necesarios[k] =
      Math.max(
        0,
        ...doc_.lineas.map((l) => cuerpo(cifras[k](l), 9)),
        ...col.titulo.split(/\s+/).map((palabra) => titulo(palabra, 8.5)),
      ) + relleno;
  }
  const anchos = anchosColumnas(necesarios, W - 2 * M);
  // Si ni con la columna ancha cabe «1.234,5678 €/unidades», se parte por la
  // barra y no por la mitad de la unidad.
  const precio = (l: LineaDocumentoPresupuesto) => {
    const junto = precioJunto(l);
    return medir("normal")(junto, 9) + relleno > (anchos.precio ?? 0)
      ? `${eurUnitario(l.precio_unitario)} / ${l.unidad}`
      : junto;
  };

  const anchoDe = (col: Columna) =>
    col.clave === "descripcion" ? anchos.descripcion : anchos[col.clave];

  autoTable(doc, {
    startY: y,
    // El ancho también en cada celda de la cabecera: sin líneas (la vista
    // previa de un ámbito vacío), autoTable no mira `columnStyles` y reparte
    // el sitio a su manera.
    head: [columnas.map((col) => ({ content: col.titulo, styles: { cellWidth: anchoDe(col) } }))],
    body: doc_.lineas.map((l) =>
      columnas.map((col) =>
        col.clave === "descripcion"
          ? l.descripcion
          : col.clave === "precio"
            ? precio(l)
            : cifras[col.clave](l),
      ),
    ),
    theme: "plain",
    showHead: "everyPage",
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: TINTA,
      cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
      lineColor: LINEA,
      lineWidth: { bottom: 0.2 },
      valign: "middle",
    },
    headStyles: {
      fillColor: principal,
      textColor: sobrePrincipal,
      fontStyle: "bold",
      fontSize: 8.5,
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: FONDO },
    columnStyles: Object.fromEntries(
      columnas.map((col, i) => [
        i,
        col.clave === "descripcion"
          ? { cellWidth: anchoDe(col) }
          : {
              halign: "right" as const,
              cellWidth: anchoDe(col),
              ...(col.clave === "importe" ? { fontStyle: "bold" as const } : {}),
            },
      ]),
    ),
    didParseCell: (h) => {
      // La cabecera de las columnas de cifras, alineada con sus cifras.
      if (h.section === "head" && h.column.index > 0) h.cell.styles.halign = "right";
    },
    margin: { left: M, right: M, top: ARRIBA, bottom: H - mp.finTabla },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  /** Si lo que viene no cabe en lo que queda de página, a la siguiente. */
  const sitio = (alto: number, limite = mp.finCuerpo) => {
    if (y + alto > limite) {
      doc.addPage();
      y = ARRIBA;
    }
  };
  const altoUtil = mp.finCuerpo - ARRIBA;

  // ---------------------------------------------------------------------------
  // Lo que va después del resumen, en el orden de la plantilla
  // ---------------------------------------------------------------------------
  type Seccion = { tipo: "bloque" | "aceptacion"; titulo: string; lineas: string[] };
  const parrafos = (lineas: string[]) => lineas.flatMap((l) => partir("normal")(l, W - 2 * M, 9));
  // La caja de aceptación: título, texto y, si tienen etiqueta, fecha y firma.
  const ac = p.aceptacion;
  const ranuras = [
    { etiqueta: ac.etiquetaFecha.trim(), fin: M + 62 },
    { etiqueta: ac.etiquetaFirma.trim(), fin: W - M - 6 },
  ].filter((r) => r.etiqueta);
  const secciones: Seccion[] = p.orden.flatMap((s): Seccion[] => {
    if (s === "observaciones") {
      const notas = d.notas?.trim();
      return p.observaciones.mostrar && notas
        ? [
            {
              tipo: "bloque",
              titulo: p.observaciones.titulo,
              lineas: parrafos(notas.split(/\r?\n/)),
            },
          ]
        : [];
    }
    if (s === "condiciones") {
      const lineas = p.condiciones.mostrar
        ? parrafos(rellenarTexto(p.condiciones.texto, valores))
        : [];
      return lineas.length ? [{ tipo: "bloque", titulo: p.condiciones.titulo, lineas }] : [];
    }
    if (!ac.mostrar) return [];
    const lineas = rellenarTexto(ac.texto, valores).flatMap((l) =>
      partir("normal")(l, W - 2 * M - 9, 8.5),
    );
    // Sin título, sin texto y sin dónde firmar no queda nada que enseñar.
    return ac.titulo.trim() || lineas.length || ranuras.length
      ? [{ tipo: "aceptacion", titulo: ac.titulo, lineas }]
      : [];
  });

  const cajaAceptacion = (s: Seccion) => {
    const conTitulo = !!s.titulo.trim();
    const primera = conTitulo ? 11.5 : 6.5;
    const ultimoTexto = s.lineas.length ? primera + (s.lineas.length - 1) * 4.2 : conTitulo ? 6 : 0;
    const firma = ultimoTexto + 9.5;
    return { primera, firma, alto: (ranuras.length ? firma : ultimoTexto) + 5 };
  };

  const altoBloque = (s: Seccion) => (s.titulo.trim() ? 5.5 : 0) + s.lineas.length * 4.4 + 5;

  /** Un bloque con rótulo y párrafos, que pasa de página línea a línea si es largo. */
  const bloque = (s: Seccion, reserva: number) => {
    const conTitulo = !!s.titulo.trim();
    const alto = altoBloque(s);
    if (reserva && juntarConAceptacion(alto, reserva, altoUtil)) {
      // Corto: pasa de página entero con la caja de aceptación.
      sitio(alto + reserva, limiteAceptacion);
    } else {
      sitio((conTitulo ? 7 : 0) + Math.min(s.lineas.length, 3) * 4.4);
    }
    if (conTitulo) {
      rotulo(s.titulo, M, y);
      y += 5.5;
    }
    s.lineas.forEach((l, i) => {
      const quedan = s.lineas.length - i;
      if (
        reserva &&
        quedan === LINEAS_CON_ACEPTACION &&
        y + quedan * 4.4 + 5 + reserva > limiteAceptacion
      ) {
        // Largo: sus últimas líneas pasan con la caja, que nunca va sola.
        doc.addPage();
        y = ARRIBA;
      } else {
        sitio(4.4);
      }
      fuente("normal", 9);
      doc.text(l, M, y);
      y += 4.4;
    });
    y += 5;
  };

  const aceptacion = (s: Seccion) => {
    const m = cajaAceptacion(s);
    // Su alto de verdad, y puede llegar hasta cerca de la raya del pie.
    sitio(m.alto, limiteAceptacion);
    doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, W - 2 * M, m.alto, 1.8, 1.8, "S");
    rotulo(s.titulo, M + 4.5, y + 6, W - 2 * M - 9);
    fuente("normal", 8.5, GRIS);
    s.lineas.forEach((l, i) => doc.text(l, M + 4.5, y + m.primera + i * 4.2));
    // Cada etiqueta con su raya para escribir; la de la firma, hasta el final.
    let x = M + 4.5;
    for (const r of ranuras) {
      fuente("normal", 8.5, GRIS);
      doc.text(r.etiqueta, x, y + m.firma);
      const desde = x + doc.getTextWidth(r.etiqueta) + 3;
      const hasta = Math.min(W - M - 6, Math.max(desde + 20, r.fin));
      doc.setDrawColor(GRIS[0], GRIS[1], GRIS[2]);
      doc.setLineWidth(0.2);
      doc.line(desde, y + m.firma, hasta, y + m.firma);
      x = Math.max(M + 72, hasta + 10);
    }
    y += m.alto + 6;
  };

  // ---------------------------------------------------------------------------
  // Resumen: metros a la izquierda; Base imponible, IVA y TOTAL a la derecha
  // ---------------------------------------------------------------------------
  const rs = p.resumen;
  const filasIva = doc_.iva.map((r) => ({
    etiqueta: r.tipo == null ? rs.iva.trim() : `${rs.iva} ${numeroJusto(r.tipo, 2)} %`.trim(),
    valor: eur(r.cuota),
  }));
  const altoResumen = 7 + 6 * (1 + filasIva.length) + 13;
  const consumoResumen = 24 + 6 * (1 + filasIva.length);
  const primera = secciones[0];
  if (primera?.tipo === "aceptacion") {
    const reserva = cajaAceptacion(primera).alto;
    if (juntarConAceptacion(consumoResumen, reserva, altoUtil)) {
      sitio(consumoResumen + reserva, limiteAceptacion);
    }
  }
  sitio(altoResumen);

  if (rs.mostrarMetros && doc_.metros > 0) {
    rotulo(rs.metros, M, y + 4, 70);
    fuente("bold", 13, textoPrincipal);
    doc.text(`${numeroJusto(doc_.metros)} m`, M, y + 11);
  }

  // Ancho para la etiqueta más larga y su cifra.
  const filasResumen = [{ etiqueta: rs.base, valor: eur(doc_.base) }, ...filasIva];
  const etiquetaMayor = Math.max(...filasResumen.map((f) => medir("normal")(f.etiqueta, 9.5)));
  const cifraMayor = Math.max(...filasResumen.map((f) => medir("bold")(f.valor, 9.5)));
  const total = eur(doc_.total);
  const anchoTotal = medir("bold")(rs.total, 10.5) + medir("bold")(total, 13) + 14;
  const anchoResumen = Math.min(
    W - 2 * M - 80,
    Math.max(78, etiquetaMayor + cifraMayor + 12, anchoTotal),
  );
  const xr = W - M - anchoResumen;
  let yr = y + 4;
  for (const f of filasResumen) {
    fuente("normal", 9.5, GRIS);
    doc.text(f.etiqueta, xr + 3, yr);
    fuente("bold", 9.5);
    doc.text(f.valor, W - M - 3, yr, { align: "right" });
    yr += 6;
  }
  doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
  doc.setLineWidth(0.3);
  doc.line(xr, yr - 3, W - M, yr - 3);
  doc.setFillColor(principal[0], principal[1], principal[2]);
  doc.roundedRect(xr, yr - 0.5, anchoResumen, 11, 1.5, 1.5, "F");
  fuente("bold", 10.5, sobrePrincipal);
  doc.text(rs.total, xr + 4, yr + 6.6);
  fuente("bold", 13, sobrePrincipal);
  doc.text(total, W - M - 4, yr + 6.8, { align: "right" });
  y = yr + 11 + 9;

  // ---------------------------------------------------------------------------
  // Observaciones, condiciones y aceptación, en el orden de la plantilla
  // ---------------------------------------------------------------------------
  secciones.forEach((s, i) => {
    if (s.tipo === "aceptacion") return aceptacion(s);
    const siguiente = secciones[i + 1];
    bloque(s, siguiente?.tipo === "aceptacion" ? cajaAceptacion(siguiente).alto : 0);
  });

  // ---------------------------------------------------------------------------
  // En cada página: el pie y el número de página; desde la segunda, arriba, a
  // qué presupuesto pertenece
  // ---------------------------------------------------------------------------
  const paginas = doc.getNumberOfPages();
  const xPie = pie.alineacion === "centro" ? W / 2 : pie.alineacion === "derecha" ? W - M : M;
  const referencia = [enFrase(cab.titulo.texto) || "Presupuesto", d.numero.trim()]
    .filter(Boolean)
    .join(" ");
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    if (hayPie) {
      doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
      doc.setLineWidth(0.3);
      doc.line(M, mp.raya, W - M, mp.raya);
    }
    fuente("normal", tamPie, GRIS);
    if (lineasPie.length) {
      doc.text(lineasPie, xPie, mp.primeraLinea, { align: ALINEAR[pie.alineacion] });
    }
    if (pie.paginas) {
      // El número de página, en el lado contrario al texto.
      const izquierda = pie.alineacion === "derecha";
      doc.text(`Página ${i} de ${paginas}`, izquierda ? M : W - M, mp.primeraLinea, {
        align: izquierda ? "left" : "right",
      });
    }
    if (i > 1) {
      fuente("bold", 8.5, textoPrincipal);
      doc.text(referencia, M, 16);
      const libre = W - 2 * M - doc.getTextWidth(referencia) - 8;
      const nombre = encajarTexto(
        nombreComercial,
        libre,
        { tamano: 8.5, minimoUnaLinea: 6, minimo: 6, maxLineas: 1 },
        medir("normal"),
        partir("normal"),
      );
      fuente("normal", nombre.tamano, GRIS);
      doc.text(nombre.lineas, W - M, 16, { align: "right" });
    }
  }

  return doc.output("blob");
}
