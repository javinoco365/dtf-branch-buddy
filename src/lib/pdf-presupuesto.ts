import { eur, eurUnitario, fechaCorta, numeroJusto } from "@/lib/format";
import type { LogoPDF } from "@/lib/pdf-factura";
import { LETRA, registrarFuentesPdf } from "@/lib/fuentes-pdf";
import type { DocumentoPresupuesto, LineaDocumentoPresupuesto } from "@/dominio/presupuestos";
import {
  ALTO_CINTA,
  ALTO_PAGINA as H,
  ANCHO_PAGINA as W,
  MARGEN as M,
  PLANTILLA_POR_DEFECTO,
  normalizarPlantilla,
  rellenarTexto,
  type PlantillaPresupuesto,
  type ValoresPlantilla,
} from "@/dominio/plantilla-presupuesto";
import {
  ALTO_PASTILLA,
  ANCHO_REF,
  BLANCO,
  GRIS,
  MM_POR_PUNTO,
  SOMBRA_PASTILLA,
  TINTA,
  altoLinea,
  anchosColumnas,
  colorHex,
  coloresDocumento,
  inicioTexto,
  maquetaPie,
  partirConMedida,
  referenciaPaginas,
  repartirEnDosColumnas,
  subida,
  unitarioConIva,
  type ColumnaCifra,
  type Medir,
  type Partir,
  type RGB,
} from "@/dominio/maqueta-presupuesto";
import {
  ESPACIADO_ROTULO,
  RAYA_ANTETITULO,
  maquetarCabecera,
  textosDatos,
  type EstiloLetra,
  type MedidasTexto,
} from "@/dominio/maqueta-cabecera";
import { maquetarImagenes } from "@/dominio/imagenes-presupuesto";

/**
 * El PDF de un presupuesto, en A4: el de las tiendas y el del textil.
 *
 * Es un documento comercial, no fiscal: lo que tiene que hacer es dejar claro
 * quién ofrece qué, a quién, por cuánto y hasta cuándo. Las cifras llegan ya
 * hechas (`documentoPresupuesto`, en el dominio): aquí no se suma nada, solo se
 * coloca. La tabla va sin IVA, línea a línea, y al lado el resumen de siempre:
 * Base imponible, el IVA de cada tipo y el TOTAL.
 *
 * El diseño es el modelo de la casa: banda oscura con el logo, el título y los
 * datos en pastillas; la cinta de lemas; emisor y cliente en dos cajas; la
 * tabla «Detalle del pedido»; el TOTAL en una caja naranja; la aceptación del
 * cliente; las condiciones a dos columnas, y la banda del pie. Los textos, las
 * posiciones de la cabecera y los colores los dice la plantilla del ámbito
 * (`plantilla-presupuesto.ts`, editable en Ajustes generales). Las cuentas de
 * la maqueta están en `maqueta-presupuesto.ts` y `maqueta-cabecera.ts`.
 */

export { colorHex };

/** Una imagen del presupuesto (el diseño, la prenda), lista para incrustar. */
export type ImagenPDF = {
  dataUrl: string;
  formato: "JPEG" | "PNG" | "WEBP";
  /** En píxeles: solo cuenta la proporción. */
  ancho: number;
  alto: number;
};

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
  /** Las imágenes guardadas con el presupuesto: van después de las observaciones. */
  imagenes?: ImagenPDF[];
  logo?: LogoPDF | null;
  /**
   * El color de la tienda o de la marca. El modelo de la casa no lo usa: los
   * colores salen de la plantilla o, si los deja vacíos, son los de la casa.
   */
  color?: string | null;
};

/** El espacio de más entre letras de Anton: en los títulos, y en la cinta y la tabla. */
const ESPACIADO_TITULOS = 0.12;
const ESPACIADO_CINTA = 0.16;

/** El borde de las cajas y su redondeo. */
const BORDE = 0.5;
const RADIO = 2.5;
/** Lo que se ve de la sombra de las cajas. */
const SOMBRA = 2.2;
/** Las rayas entre filas de la tabla y del resumen. */
const RAYA: RGB = [216, 221, 233];
const FONDO_CLIENTE: RGB = [246, 249, 251];
const FONDO_NOTAS: RGB = [237, 240, 246];

/** Desde la segunda página: una banda fina arriba y el cuerpo desde aquí. */
const ALTO_BANDA_SEGUIDA = 14;
const ARRIBA = 22;

/** El ancho de la columna del resumen y la aceptación, a la derecha. */
const ANCHO_RESUMEN = 82;
/** La columna de las observaciones, a la izquierda del resumen. */
const ANCHO_NOTAS = 66;

/** 3 m · 20 ud. */
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

/** Los lemas de la cinta, en mayúsculas y sin los que se quedan vacíos. */
export function lemasCinta(texto: string, valores: ValoresPlantilla): string[] {
  return rellenarTexto(texto, valores).map((l) => l.toUpperCase());
}

export async function generarPresupuestoPDF(
  d: PresupuestoPDFData,
  plantilla: PlantillaPresupuesto = PLANTILLA_POR_DEFECTO,
): Promise<Blob> {
  // Una plantilla a medio editar o vieja también sirve: se completa.
  const p = normalizarPlantilla(plantilla);
  // El cuerpo llega casi hasta la banda del pie. Si no cabe en una página, se
  // vuelve a componer dejando sitio encima de la banda para «Página 1 de 2».
  const doc = await componer(d, p, false);
  if (p.pie.paginas && doc.getNumberOfPages() > 1) {
    return (await componer(d, p, true)).output("blob");
  }
  return doc.output("blob");
}

async function componer(d: PresupuestoPDFData, p: PlantillaPresupuesto, conNumeros: boolean) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await registrarFuentesPdf(doc);
  const col = coloresDocumento(p.colores);
  const doc_ = d.documento;
  const e = d.emisor;
  const nombreComercial =
    p.cabecera.nombre.texto.trim() || e.nombre_comercial.trim() || e.razon_social.trim();
  const valores = valoresPresupuesto(d, nombreComercial);

  // ---------------------------------------------------------------------------
  // Letras, colores y medidas
  // ---------------------------------------------------------------------------
  type Estilo = EstiloLetra | "cifras";
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const relleno = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const trazo = (c: RGB, ancho: number) => {
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(ancho);
  };
  const fuente = (estilo: Estilo, tam: number, c: RGB = TINTA) => {
    if (estilo === "titular") doc.setFont(LETRA.titular, "normal");
    else if (estilo === "cifras") doc.setFont(LETRA.cifras, "normal");
    else doc.setFont(LETRA.texto, estilo === "normal" ? "normal" : "bold");
    doc.setFontSize(tam);
    color(c);
  };
  const medir =
    (estilo: Estilo): Medir =>
    (texto, tam) => {
      fuente(estilo, tam);
      const ancho = doc.getTextWidth(texto);
      return estilo === "rotulo" ? ancho + ESPACIADO_ROTULO * texto.length : ancho;
    };
  const partir =
    (estilo: Estilo): Partir =>
    (texto, ancho, tam) => {
      if (estilo === "rotulo") return partirConMedida(texto, ancho, tam, medir("rotulo"));
      fuente(estilo, tam);
      return doc.splitTextToSize(texto, ancho) as string[];
    };
  const medidas: MedidasTexto = { medir, partir };
  /** Un texto en mayúsculas espaciadas, colocado a mano: jsPDF no alinea bien con espaciado. */
  const rotulo = (
    texto: string,
    x: number,
    y: number,
    tam: number,
    c: RGB,
    alineacion: "izquierda" | "centro" | "derecha" = "izquierda",
  ) => {
    const x0 = inicioTexto(x, medir("rotulo")(texto, tam), alineacion);
    fuente("rotulo", tam, c);
    doc.text(texto, x0, y, { charSpace: ESPACIADO_ROTULO });
  };
  /** Lo que mide un texto en Anton con `espaciado` mm de más entre letras. */
  const anchoEspaciado = (texto: string, tam: number, espaciado: number) =>
    medir("titular")(texto, tam) + espaciado * texto.length;
  /** Un título en Anton y mayúsculas: la última palabra, en el color de acento. */
  const titulo = (texto: string, x: number, y: number, tam: number) => {
    const palabras = texto.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!palabras.length) return;
    const ultima = palabras.length > 1 ? palabras.pop()! : "";
    const primero = palabras.join(" ");
    fuente("titular", tam, col.titulos);
    doc.text(primero, x, y, { charSpace: ESPACIADO_TITULOS });
    if (ultima) {
      const x2 = x + anchoEspaciado(`${primero} `, tam, ESPACIADO_TITULOS);
      fuente("titular", tam, col.acento);
      doc.text(ultima, x2, y, { charSpace: ESPACIADO_TITULOS });
    }
  };
  /** Una caja con borde de tinta y sombra desplazada. */
  const caja = (x: number, y: number, ancho: number, alto: number, fondo: RGB, sombra: RGB) => {
    relleno(sombra);
    doc.roundedRect(x + SOMBRA, y + SOMBRA, ancho, alto, RADIO, RADIO, "F");
    relleno(fondo);
    trazo(TINTA, BORDE);
    doc.roundedRect(x, y, ancho, alto, RADIO, RADIO, "FD");
  };
  /** Un rectángulo redondeado girado `grados` sobre su centro (la caja del TOTAL). */
  const cajaGirada = (
    x: number,
    y: number,
    ancho: number,
    alto: number,
    grados: number,
    estilo: "F" | "FD",
  ) => {
    const r = Math.min(RADIO + 0.5, alto / 2);
    const k = 0.5523 * r;
    const cx = x + ancho / 2;
    const cy = y + alto / 2;
    const a = (grados * Math.PI) / 180;
    const girar = (px: number, py: number): [number, number] => {
      const dx = px - cx;
      const dy = py - cy;
      return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    const x1 = x + ancho;
    const y1 = y + alto;
    // El contorno en puntos absolutos: rectas y cuartos de círculo (Bézier).
    const tramos: (
      ["l", number, number] | ["c", number, number, number, number, number, number]
    )[] = [
      ["l", x1 - r, y],
      ["c", x1 - r + k, y, x1, y + r - k, x1, y + r],
      ["l", x1, y1 - r],
      ["c", x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1],
      ["l", x + r, y1],
      ["c", x + r - k, y1, x, y1 - r + k, x, y1 - r],
      ["l", x, y + r],
      ["c", x, y + r - k, x + r - k, y, x + r, y],
    ];
    const inicio = girar(x + r, y);
    let actual = inicio;
    const relativos = tramos.map((t) => {
      if (t[0] === "l") {
        const fin = girar(t[1], t[2]);
        const seg = [fin[0] - actual[0], fin[1] - actual[1]];
        actual = fin;
        return seg;
      }
      const c1 = girar(t[1], t[2]);
      const c2 = girar(t[3], t[4]);
      const fin = girar(t[5], t[6]);
      const seg = [
        c1[0] - actual[0],
        c1[1] - actual[1],
        c2[0] - actual[0],
        c2[1] - actual[1],
        fin[0] - actual[0],
        fin[1] - actual[1],
      ];
      actual = fin;
      return seg;
    });
    doc.lines(relativos, inicio[0], inicio[1], [1, 1], estilo, true);
  };
  /** Una estrella de cinco puntas centrada en (cx, cy): la que separa los lemas. */
  const estrella = (cx: number, cy: number, radio: number, c: RGB) => {
    const puntos: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? radio * 0.42 : radio;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      puntos.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    const relativos = puntos.slice(1).map((q, i) => [q[0] - puntos[i][0], q[1] - puntos[i][1]]);
    relleno(c);
    doc.lines(relativos, puntos[0][0], puntos[0][1], [1, 1], "F", true);
  };
  /** La marca de una condición: un visto. */
  const visto = (x: number, base: number, c: RGB) => {
    trazo(c, 0.55);
    doc.setLineCap("round");
    doc.setLineJoin("round");
    doc.lines(
      [
        [0.9, 0.9],
        [1.7, -2.1],
      ],
      x,
      base - 1.4,
      [1, 1],
      "S",
      false,
    );
    doc.setLineCap("butt");
    doc.setLineJoin("miter");
  };

  // ---------------------------------------------------------------------------
  // El pie, primero: su alto decide hasta dónde llega el cuerpo
  // ---------------------------------------------------------------------------
  const pie = p.pie;
  const tituloPie = rellenarTexto(pie.titulo, valores).join(" ").toUpperCase();
  const anchoTituloPie = tituloPie
    ? medir("titular")(tituloPie, 11) + ESPACIADO_TITULOS * tituloPie.length
    : 0;
  const xTextoPie = M + (anchoTituloPie ? anchoTituloPie + 8 : 0);
  const anchoPie = W - M - xTextoPie;
  const parrafosPie = rellenarTexto(pie.texto, valores);
  const partirPie = (tam: number) => parrafosPie.flatMap((l) => partir("normal")(l, anchoPie, tam));
  // Hasta dos líneas: si no caben, letra más pequeña antes que cortar.
  let tamPie = pie.tamano;
  let lineasPie = partirPie(tamPie);
  while (lineasPie.length > 2 && tamPie > 5) {
    tamPie = Math.max(5, tamPie - 0.5);
    lineasPie = partirPie(tamPie);
  }
  const pieMaquetado = maquetaPie(lineasPie.length, tamPie);
  const mp = conNumeros ? { ...pieMaquetado, finCuerpo: pieMaquetado.finCuerpo - 4 } : pieMaquetado;

  // ---------------------------------------------------------------------------
  // Cabecera: la banda, la cinta y cada elemento donde diga la plantilla
  // ---------------------------------------------------------------------------
  const cab = p.cabecera;
  relleno(col.banda);
  doc.rect(0, 0, W, cab.alto, "F");

  if (cab.cinta.mostrar) {
    relleno(col.acento);
    doc.rect(0, cab.alto, W, ALTO_CINTA, "F");
    const lemas = lemasCinta(cab.cinta.texto, valores);
    if (lemas.length) {
      // Los lemas, separados por estrellas, de un lado a otro: se repiten
      // mientras quepan enteros, como una cinta.
      const tam = 9;
      const base = cab.alto + 5.7;
      const hueco = 2.7;
      const anchoEstrella = 3.3;
      const fin = W - M - 2.5;
      let x = M + 2.5;
      for (let i = 0; i < 40; i++) {
        const lema = lemas[i % lemas.length];
        const ancho = anchoEspaciado(lema, tam, ESPACIADO_CINTA);
        if (i > 0) {
          if (x + 2 * hueco + anchoEstrella + ancho > fin) break;
          estrella(x + hueco + anchoEstrella / 2, base - 1.35, 1.35, col.sobreAcento);
          x += 2 * hueco + anchoEstrella;
        }
        fuente(
          "titular",
          i === 0 && ancho > fin - x ? (tam * (fin - x)) / ancho : tam,
          col.sobreAcento,
        );
        doc.text(lema, x, base, { charSpace: ESPACIADO_CINTA });
        x += ancho;
      }
    }
  }

  // Lo que sale y dónde: lo mismo que enseña el diseñador del editor.
  let logoImagen: { ancho: number; alto: number } | null = null;
  if (cab.logo.mostrar && d.logo) {
    try {
      const props = doc.getImageProperties(d.logo.dataUrl);
      logoImagen = { ancho: props.width, alto: props.height };
    } catch {
      // Un logo ilegible no impide sacar el presupuesto: sale el nombre.
    }
  }
  const datos = textosDatos(cab, {
    numero: d.numero.trim() || "—",
    fecha: fechaCorta(d.fecha),
    validez: fechaCorta(doc_.validoHasta),
  });
  const maqueta = maquetarCabecera(
    cab,
    {
      logo: logoImagen,
      datos: datos.map((x) => x.texto),
      parrafos: rellenarTexto(cab.texto.texto, valores),
      nombre: nombreComercial,
    },
    medidas,
  );

  if (maqueta.logo && d.logo) {
    const l = maqueta.logo;
    doc.addImage(d.logo.dataUrl, d.logo.formato, l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0);
  }

  if (maqueta.datos) {
    const m = maqueta.datos;
    m.pastillas.forEach((pa, i) => {
      const r = ALTO_PASTILLA / 2;
      relleno(col.acento);
      doc.roundedRect(
        pa.x + SOMBRA_PASTILLA,
        pa.y + SOMBRA_PASTILLA,
        pa.ancho,
        ALTO_PASTILLA,
        r,
        r,
        "F",
      );
      const validez = datos[i].validez;
      relleno(validez ? col.destacado : BLANCO);
      trazo(TINTA, 0.35);
      doc.roundedRect(pa.x, pa.y, pa.ancho, ALTO_PASTILLA, r, r, "FD");
      fuente("bold", m.tamano, validez ? col.sobreDestacado : TINTA);
      doc.text(pa.texto, pa.x + pa.ancho / 2, pa.y + ALTO_PASTILLA / 2 + subida(m.tamano) / 2, {
        align: "center",
      });
    });
  }

  if (maqueta.titulo) {
    const t = maqueta.titulo;
    fuente("titular", t.tamano, col.sobreBanda);
    doc.text(t.lineas, t.x, t.y, {
      align:
        cab.titulo.alineacion === "centro"
          ? "center"
          : cab.titulo.alineacion === "derecha"
            ? "right"
            : "left",
    });
  }

  if (maqueta.texto) {
    const t = maqueta.texto;
    t.lineas.forEach((l, i) => {
      rotulo(l, t.x, t.y + i * altoLinea(t.tamano), t.tamano, col.acento, cab.texto.alineacion);
    });
    // La raya, delante de la primera línea.
    const x0 = inicioTexto(t.x, medir("rotulo")(t.lineas[0], t.tamano), cab.texto.alineacion);
    trazo(col.destacado, 0.5);
    const yRaya = t.y - subida(t.tamano) / 2;
    doc.line(
      x0 - RAYA_ANTETITULO.hueco - RAYA_ANTETITULO.largo,
      yRaya,
      x0 - RAYA_ANTETITULO.hueco,
      yRaya,
    );
  }

  if (maqueta.nombre) {
    const t = maqueta.nombre;
    fuente("titular", t.tamano, col.sobreBanda);
    doc.text(t.lineas, t.x, t.y, {
      align:
        cab.nombre.alineacion === "centro"
          ? "center"
          : cab.nombre.alineacion === "derecha"
            ? "right"
            : "left",
    });
  }

  let y = maqueta.inicio;
  /** Si lo que viene no cabe en lo que queda de página, a la siguiente. */
  const sitio = (alto: number) => {
    if (y + alto > mp.finCuerpo) {
      doc.addPage();
      y = ARRIBA;
    }
  };

  // ---------------------------------------------------------------------------
  // Emisor y cliente, en dos cajas iguales (o una a todo lo ancho)
  // ---------------------------------------------------------------------------
  const pa = p.partes;
  const c = d.cliente;
  const cajas = (
    pa.emisorPrimero ? (["emisor", "cliente"] as const) : (["cliente", "emisor"] as const)
  ).filter((k) => pa[k].mostrar);

  if (cajas.length) {
    const anchoCaja = cajas.length === 2 ? (W - 2 * M - 6) / 2 : W - 2 * M;
    const anchoTexto = anchoCaja - 10;
    const TAM = 9.6;
    const paso = 5.15;
    /** Una línea con su etiqueta gris delante (CIF) o sin ella. */
    type Linea = { etiqueta?: string; texto: string };
    const partirLineas = (lineas: (Linea | null | false | undefined)[]): Linea[] =>
      lineas.flatMap((l) => {
        if (!l || !l.texto.trim()) return [];
        const delante = l.etiqueta ? medir("normal")(`${l.etiqueta} `, TAM) : 0;
        const trozos = partir("normal")(l.texto.trim(), anchoTexto - delante, TAM);
        return trozos.map((t, i) => (i === 0 ? { etiqueta: l.etiqueta, texto: t } : { texto: t }));
      });
    const juntar = (...partes: (string | null | undefined | false)[]) =>
      partes.filter((x): x is string => !!x && !!x.trim()).join(" · ");

    const nombreEmisor = nombreComercial.toUpperCase();
    const bloques = {
      emisor: {
        titulo: pa.emisor.titulo,
        fondo: BLANCO,
        titular: partir("bold")(
          juntar(
            nombreEmisor,
            pa.emisor.razonSocial && e.razon_social.trim().toUpperCase() !== nombreEmisor
              ? e.razon_social
              : null,
          ),
          anchoTexto,
          10,
        ),
        resto: partirLineas([
          pa.emisor.cif && e.cif ? { etiqueta: "CIF", texto: e.cif } : null,
          pa.emisor.direccion && { texto: juntar(...e.direccion) },
          { texto: juntar(pa.emisor.telefono && e.telefono, pa.emisor.email && e.email) },
          pa.emisor.web && e.web ? { texto: e.web } : null,
        ]),
      },
      cliente: {
        titulo: pa.cliente.titulo,
        fondo: FONDO_CLIENTE,
        titular: partir("bold")(c.nombre.trim() || "—", anchoTexto, 10),
        resto: partirLineas([
          pa.cliente.empresa && c.empresa && c.empresa !== c.nombre ? { texto: c.empresa } : null,
          pa.cliente.nif && c.nif ? { etiqueta: "CIF", texto: c.nif } : null,
          pa.cliente.direccion && { texto: juntar(...c.direccion) },
          { texto: juntar(pa.cliente.telefono && c.telefono, pa.cliente.email && c.email) },
        ]),
      },
    };

    const conTitulo = cajas.some((k) => bloques[k].titulo.trim());
    const primera = conTitulo ? 15.3 : 8;
    const ultima = Math.max(
      ...cajas.map((k) => {
        const b = bloques[k];
        return (
          (b.titular.length - 1) * 4.6 + (b.resto.length ? 5.4 + (b.resto.length - 1) * paso : 0)
        );
      }),
    );
    const altoCaja = Math.max(36.7, primera + ultima + 5.7);
    sitio(altoCaja + SOMBRA);
    cajas.forEach((k, i) => {
      const x = M + i * (anchoCaja + 6);
      const b = bloques[k];
      caja(x, y, anchoCaja, altoCaja, b.fondo, col.titulos);
      if (b.titulo.trim()) {
        fuente("titular", 11, col.titulos);
        doc.text(b.titulo.trim().toUpperCase(), x + 5, y + 8.6, { charSpace: ESPACIADO_TITULOS });
      }
      let yy = y + primera;
      fuente("bold", 10);
      b.titular.forEach((l, j) => {
        doc.text(l, x + 5, yy);
        if (j < b.titular.length - 1) yy += 4.6;
      });
      yy += 5.4;
      b.resto.forEach((l) => {
        let xx = x + 5;
        if (l.etiqueta) {
          fuente("normal", TAM, GRIS);
          doc.text(l.etiqueta, xx, yy);
          xx += medir("normal")(`${l.etiqueta} `, TAM);
        }
        fuente("normal", TAM);
        doc.text(l.texto, xx, yy);
        yy += paso;
      });
    });
    y += altoCaja + SOMBRA;
  }

  // ---------------------------------------------------------------------------
  // Detalle del pedido: las líneas, sin IVA; la columna Importe suma la base
  // ---------------------------------------------------------------------------
  const tb = p.tabla;
  const TAM_TABLA = 9.6;
  const conTituloTabla = !!tb.titulo.trim();
  sitio((conTituloTabla ? 11.3 : 0) + 10 + 14);
  if (conTituloTabla) {
    y += 9.1;
    titulo(tb.titulo, M, y, 15);
    y += 3.9;
  } else {
    y += 4;
  }

  type Clave = "ref" | "descripcion" | ColumnaCifra;
  type Columna = { clave: Clave; titulo: string };
  const columnas = (
    [
      tb.mostrarRef && { clave: "ref", titulo: tb.ref },
      { clave: "descripcion", titulo: tb.descripcion },
      tb.mostrarCantidad && { clave: "cantidad", titulo: tb.cantidad },
      tb.mostrarPrecio && { clave: "precio", titulo: tb.precio },
      tb.mostrarIva && { clave: "iva", titulo: tb.iva },
      { clave: "importe", titulo: tb.importe },
    ] as (Columna | false)[]
  ).filter((x): x is Columna => !!x);

  const cifras: Record<ColumnaCifra, (l: LineaDocumentoPresupuesto) => string> = {
    cantidad: (l) => cantidadConUnidad(l.cantidad, l.unidad),
    precio: (l) => eurUnitario(l.precio_unitario),
    iva: (l) => `${numeroJusto(l.iva_rate, 2)} %`,
    importe: (l) => eur(l.importe),
  };
  // Lo que necesita cada columna para que nada se parta a media palabra: su
  // cifra más ancha y la palabra más larga de su título, con el relleno.
  const RELLENO = 7.2;
  const anchoTabla = W - 2 * M - 2 * BORDE;
  const necesarios: Partial<Record<ColumnaCifra, number>> = {};
  for (const x of columnas) {
    if (x.clave === "descripcion" || x.clave === "ref") continue;
    const k = x.clave;
    necesarios[k] =
      Math.max(
        0,
        ...doc_.lineas.map((l) => medir("cifras")(cifras[k](l), TAM_TABLA)),
        ...x.titulo
          .toUpperCase()
          .split(/\s+/)
          .map((palabra) => anchoEspaciado(palabra, 9, ESPACIADO_CINTA)),
      ) + RELLENO;
  }
  const anchoRef = tb.mostrarRef ? ANCHO_REF : 0;
  const anchos = { ...anchosColumnas(necesarios, anchoTabla - anchoRef), ref: anchoRef };
  const anchoDe = (x: Columna) => anchos[x.clave] ?? 0;

  /** La descripción: la primera línea en negrita (qué es) y el resto en normal (cómo). */
  const RELLENO_CELDA = { top: 4.2, bottom: 2.4, left: 3.6, right: 3.6 };
  const RELLENO_CABEZA = { top: 3.3, bottom: 2.4, left: 3.6, right: 3.6 };
  const anchoDescripcion = anchos.descripcion - RELLENO_CELDA.left - RELLENO_CELDA.right;
  const descripciones = doc_.lineas.map((l) => {
    const [primera, ...resto] = l.descripcion.split(/\r?\n/).map((x) => x.trim());
    const negrita = partir("bold")(primera || "—", anchoDescripcion, TAM_TABLA);
    const normal = resto
      .filter(Boolean)
      .flatMap((x) => partir("normal")(x, anchoDescripcion, TAM_TABLA));
    return { negrita, normal };
  });

  // Por página, de dónde a dónde va la tabla: para el borde redondeado.
  const tramos = new Map<number, { y0: number; y1: number }>();
  const apuntar = (pagina: number, y0: number, y1: number) => {
    const t = tramos.get(pagina);
    tramos.set(pagina, t ? { y0: Math.min(t.y0, y0), y1: Math.max(t.y1, y1) } : { y0, y1 });
  };
  const xTabla = M + BORDE;
  const ultimaFila = doc_.lineas.length - 1;
  const INTERLINEA_TABLA = 1.4;
  doc.setLineHeightFactor(INTERLINEA_TABLA);

  autoTable(doc, {
    startY: y + BORDE,
    head: [
      columnas.map((x) => ({
        content: x.titulo.toUpperCase(),
        styles: { cellWidth: anchoDe(x) },
      })),
    ],
    body: doc_.lineas.map((l, i) =>
      columnas.map((x) =>
        x.clave === "ref"
          ? String(i + 1).padStart(2, "0")
          : x.clave === "descripcion"
            ? [...descripciones[i].negrita, ...descripciones[i].normal].join("\n")
            : cifras[x.clave](l),
      ),
    ),
    theme: "plain",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: {
      font: LETRA.texto,
      fontStyle: "normal",
      fontSize: TAM_TABLA,
      textColor: TINTA,
      cellPadding: RELLENO_CELDA,
      lineColor: RAYA,
      lineWidth: { bottom: 0.3 },
      valign: "top",
      overflow: "visible",
    },
    headStyles: {
      font: LETRA.titular,
      fontSize: 9,
      textColor: col.sobreBanda,
      fillColor: false,
      lineWidth: 0,
      cellPadding: RELLENO_CABEZA,
    },
    columnStyles: Object.fromEntries(
      columnas.map((x, i) => [
        i,
        x.clave === "descripcion" || x.clave === "ref"
          ? { cellWidth: anchoDe(x) }
          : { halign: "right" as const, cellWidth: anchoDe(x), font: LETRA.cifras },
      ]),
    ),
    didParseCell: (h) => {
      // La cabecera de las columnas de cifras, alineada con sus cifras.
      const clave = columnas[h.column.index]?.clave;
      if (h.section === "head" && clave !== "descripcion" && clave !== "ref") {
        h.cell.styles.halign = "right";
      }
      // La última fila no lleva raya: la cierra el borde.
      if (h.section === "body" && h.row.index === ultimaFila) h.cell.styles.lineWidth = 0;
    },
    willDrawCell: (h) => {
      const pagina = doc.getCurrentPageInfo().pageNumber;
      apuntar(pagina, h.cell.y, h.cell.y + h.cell.height);
      if (h.section === "head" && h.column.index === 0) {
        // La cabecera de la tabla, de lado a lado, con las esquinas de arriba redondeadas.
        const alto = h.row.height;
        relleno(col.banda);
        doc.roundedRect(xTabla, h.cell.y, anchoTabla, alto, RADIO - 0.5, RADIO - 0.5, "F");
        doc.rect(xTabla, h.cell.y + alto / 2, anchoTabla, alto / 2, "F");
      }
      // La cabecera, espaciada, y la descripción, con la primera parte en
      // negrita, se escriben a mano en didDrawCell.
      if (h.section === "head" || columnas[h.column.index]?.clave === "descripcion") {
        h.cell.text = [];
      }
    },
    didDrawCell: (h) => {
      if (h.section === "head") {
        const x = columnas[h.column.index];
        if (!x) return;
        const texto = x.titulo.toUpperCase();
        const derecha = x.clave !== "descripcion" && x.clave !== "ref";
        const ancho = anchoEspaciado(texto, 9, ESPACIADO_CINTA);
        fuente("titular", 9, col.sobreBanda);
        doc.text(
          texto,
          derecha
            ? h.cell.x + h.cell.width - RELLENO_CABEZA.right - ancho + ESPACIADO_CINTA
            : h.cell.x + RELLENO_CABEZA.left,
          h.cell.y + RELLENO_CABEZA.top + 9 * MM_POR_PUNTO * (2 - 1.15),
          { charSpace: ESPACIADO_CINTA },
        );
        return;
      }
      if (h.section !== "body" || columnas[h.column.index]?.clave !== "descripcion") return;
      const dsc = descripciones[h.row.index];
      if (!dsc) return;
      const tamMm = TAM_TABLA * MM_POR_PUNTO;
      const x = h.cell.x + RELLENO_CELDA.left;
      let yy = h.cell.y + RELLENO_CELDA.top + tamMm * (2 - 1.15);
      const paso = tamMm * INTERLINEA_TABLA;
      fuente("bold", TAM_TABLA);
      for (const l of dsc.negrita) {
        doc.text(l, x, yy);
        yy += paso;
      }
      fuente("normal", TAM_TABLA);
      if (dsc.normal.length) yy += 0.6;
      for (const l of dsc.normal) {
        doc.text(l, x, yy);
        yy += paso;
      }
    },
    margin: { left: xTabla, right: M + BORDE, top: ARRIBA, bottom: H - mp.finTabla },
  });
  doc.setLineHeightFactor(1.15);

  const finTabla = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  // El borde de la tabla, en cada página donde haya un trozo.
  for (const [pagina, t] of tramos) {
    doc.setPage(pagina);
    trazo(TINTA, BORDE);
    doc.roundedRect(M, t.y0 - BORDE, W - 2 * M, t.y1 - t.y0 + 2 * BORDE, RADIO, RADIO, "S");
  }
  doc.setPage(doc.getNumberOfPages());
  y = finTabla + BORDE + 5;

  // ---------------------------------------------------------------------------
  // El resumen y la aceptación, a la derecha; las observaciones, a la izquierda
  // ---------------------------------------------------------------------------
  const rs = p.resumen;
  const xr = W - M - ANCHO_RESUMEN;
  const filasResumen = [
    { etiqueta: rs.base, valor: eur(doc_.base) },
    ...doc_.iva.map((r) => ({
      etiqueta:
        r.tipo == null ? rs.iva.trim() : `${rs.iva.trim()} (${numeroJusto(r.tipo, 2)} %)`.trim(),
      valor: eur(r.cuota),
    })),
  ];
  const ALTO_FILA = 9.15;
  const ALTO_TOTAL = 17.2;
  const unitario = rs.mostrarUnitario ? unitarioConIva(doc_) : null;
  const nota = [
    unitario &&
      `${cantidadConUnidad(unitario.cantidad, unitario.unidad)} × ${eurUnitario(unitario.precio)} + ${rs.iva.trim() || "IVA"} · ${eur(unitario.conIva)}/${unitario.unidad} ${rs.iva.trim() || "IVA"} incluido`,
    rs.mostrarMetros && doc_.metros > 0 && `${rs.metros.trim()}: ${numeroJusto(doc_.metros)} m`,
  ]
    .filter(Boolean)
    .join(" · ");
  const altoResumen = filasResumen.length * ALTO_FILA + 4 + ALTO_TOTAL + (nota ? 6.7 : 2.5);

  const ac = p.aceptacion;
  const textoAceptacion = ac.mostrar
    ? rellenarTexto(ac.texto, valores).flatMap((l) => partir("normal")(l, ANCHO_RESUMEN, 8))
    : [];
  const conTituloAceptacion = ac.mostrar && !!ac.titulo.trim();
  const altoAceptacion = ac.mostrar
    ? (conTituloAceptacion ? 9.3 : 0) +
      textoAceptacion.length * altoLinea(8) +
      (ac.etiquetaFirma.trim() ? 3.2 + 17 : 0) +
      (ac.etiquetaFecha.trim() ? 2 + 10.3 : 0) +
      (conTituloAceptacion && !ac.etiquetaFirma.trim() && !ac.etiquetaFecha.trim() ? 2 : 0)
    : 0;

  // Las observaciones van a la izquierda si caben a la altura del resumen; si
  // no, debajo, a todo lo ancho.
  const notas = p.observaciones.mostrar ? (d.notas?.trim() ?? "") : "";
  const TAM_NOTAS = 9;
  const lineasNotasCaja = notas
    ? notas
        .split(/\r?\n/)
        .flatMap((l) => (l.trim() ? partir("normal")(l, ANCHO_NOTAS - 10, TAM_NOTAS) : [""]))
    : [];
  const conTituloNotas = !!p.observaciones.titulo.trim();
  const altoNotas = lineasNotasCaja.length
    ? (conTituloNotas ? 13.6 : 7) + (lineasNotasCaja.length - 1) * 4.4 + 5.5
    : 0;
  const altoDerecha = altoResumen + altoAceptacion;
  const notasALaIzquierda = altoNotas > 0 && altoNotas <= altoDerecha + 20;
  const altoBloque = Math.max(altoDerecha, notasALaIzquierda ? altoNotas + SOMBRA : 0);
  sitio(altoBloque);
  const yBloque = y;

  if (notasALaIzquierda) {
    caja(M, yBloque, ANCHO_NOTAS, altoNotas, FONDO_NOTAS, col.titulos);
    let yy = yBloque + 7;
    if (conTituloNotas) {
      fuente("titular", 11, col.titulos);
      doc.text(p.observaciones.titulo.trim().toUpperCase(), M + 5, yBloque + 8.6, {
        charSpace: ESPACIADO_TITULOS,
      });
      yy = yBloque + 13.6;
    }
    fuente("normal", TAM_NOTAS);
    for (const l of lineasNotasCaja) {
      if (l) doc.text(l, M + 5, yy);
      yy += 4.4;
    }
  }

  // Base imponible y el IVA de cada tipo, con su raya debajo.
  let yr = yBloque;
  for (const f of filasResumen) {
    fuente("normal", TAM_TABLA);
    doc.text(f.etiqueta, xr + 4, yr + 5.7);
    fuente("cifras", TAM_TABLA);
    doc.text(f.valor, W - M - 4, yr + 5.7, { align: "right" });
    trazo(RAYA, 0.3);
    doc.line(xr, yr + ALTO_FILA, W - M, yr + ALTO_FILA);
    yr += ALTO_FILA;
  }
  // El TOTAL, en su caja de color, un poco girada, con su sombra.
  yr += 4;
  relleno(col.acento);
  cajaGirada(xr + SOMBRA, yr + SOMBRA, ANCHO_RESUMEN, ALTO_TOTAL, -2, "F");
  relleno(col.destacado);
  trazo(TINTA, BORDE);
  cajaGirada(xr, yr, ANCHO_RESUMEN, ALTO_TOTAL, -2, "FD");
  const etiquetaTotal = rs.total.trim().toUpperCase();
  fuente("titular", 13, col.sobreDestacado);
  doc.text(etiquetaTotal, xr + 5, yr + 13.8);
  const total = eur(doc_.total);
  const partesTotal = /^(.*?)[\s\u00a0]*€$/.exec(total);
  const cifra = partesTotal ? partesTotal[1] : total;
  const simbolo = partesTotal ? " €" : "";
  // La cifra, tan grande como quepa al lado de la etiqueta.
  const libre = ANCHO_RESUMEN - 10 - medir("titular")(etiquetaTotal, 13) - 6;
  const anchoCifra = (t: number) =>
    medir("titular")(cifra, t) + (simbolo ? medir("normal")(simbolo, t) : 0);
  const tamTotal = Math.max(12, Math.min(26, (26 * libre) / Math.max(1, anchoCifra(26))));
  const xFinTotal = W - M - 5;
  const anchoSimbolo = simbolo ? medir("normal")(simbolo, tamTotal) : 0;
  fuente("titular", tamTotal, col.sobreDestacado);
  doc.text(cifra, xFinTotal - anchoSimbolo, yr + 12.4, { align: "right" });
  if (simbolo) {
    fuente("normal", tamTotal, col.sobreDestacado);
    doc.text(simbolo, xFinTotal - anchoSimbolo, yr + 12.4);
  }
  yr += ALTO_TOTAL;
  if (nota) {
    const lineasNota = partir("normal")(nota, ANCHO_RESUMEN + 6, 7.8);
    fuente("normal", 7.8, GRIS);
    doc.text(lineasNota[0], W - M, yr + 6.7, { align: "right" });
    yr += 6.7;
  } else {
    yr += 2.5;
  }

  // La aceptación del cliente: dónde firmar y la fecha.
  if (ac.mostrar) {
    if (conTituloAceptacion) {
      yr += 9.3;
      titulo(ac.titulo, xr, yr, 11);
    }
    if (textoAceptacion.length) {
      fuente("normal", 8, GRIS);
      textoAceptacion.forEach((l, i) => doc.text(l, xr, yr + 4.2 + i * altoLinea(8)));
      yr += textoAceptacion.length * altoLinea(8);
    }
    if (ac.etiquetaFirma.trim()) {
      yr += 3.2;
      relleno(BLANCO);
      trazo(TINTA, BORDE);
      doc.roundedRect(xr, yr, ANCHO_RESUMEN, 17, RADIO, RADIO, "FD");
      rotulo(ac.etiquetaFirma.trim().toUpperCase(), xr + 4, yr + 5.6, 7.5, GRIS);
      yr += 17;
    }
    if (ac.etiquetaFecha.trim()) {
      yr += 2;
      relleno(BLANCO);
      trazo(TINTA, BORDE);
      doc.roundedRect(xr, yr, ANCHO_RESUMEN, 10.3, RADIO, RADIO, "FD");
      rotulo(ac.etiquetaFecha.trim().toUpperCase(), xr + 4, yr + 6.2, 7.5, GRIS);
      // Se rellena a mano al firmar: solo las barras.
      fuente("cifras", 10, GRIS);
      doc.text("/          /", W - M - 16, yr + 6.4, { align: "right" });
      yr += 10.3;
    }
  }
  y = yBloque + altoBloque;

  /** Un bloque de párrafos a todo lo ancho, que pasa de página línea a línea. */
  const bloque = (rotuloBloque: string, lineas: string[], tam: number) => {
    sitio(11.3 + Math.min(lineas.length, 3) * 4.4);
    if (rotuloBloque.trim()) {
      y += 11.3;
      titulo(rotuloBloque, M, y, 15);
      y += 7.1;
    } else {
      y += 6;
    }
    fuente("normal", tam);
    for (const l of lineas) {
      if (y > mp.finCuerpo) {
        doc.addPage();
        y = ARRIBA;
        fuente("normal", tam);
      }
      if (l) doc.text(l, M, y);
      y += 4.4;
    }
  };

  if (notas && !notasALaIzquierda) {
    bloque(
      p.observaciones.titulo,
      notas
        .split(/\r?\n/)
        .flatMap((l) => (l.trim() ? partir("normal")(l, W - 2 * M, TAM_NOTAS) : [""])),
      TAM_NOTAS,
    );
  }

  // ---------------------------------------------------------------------------
  // Las imágenes del presupuesto: dos por fila, sin deformar
  // ---------------------------------------------------------------------------
  const imagenes = d.imagenes ?? [];
  const filasImagenes = maquetarImagenes(imagenes, W - 2 * M, {
    columnas: 2,
    separacion: 6,
    altoMaximo: 85,
  });
  if (filasImagenes.length) {
    sitio(11.3 + 7.1 + filasImagenes[0].alto);
    y += 11.3;
    titulo("Imágenes", M, y, 15);
    y += 7.1;
    for (const fila of filasImagenes) {
      sitio(fila.alto);
      for (const celda of fila.celdas) {
        const im = imagenes[celda.indice];
        try {
          doc.addImage(im.dataUrl, im.formato, M + celda.x, y, celda.ancho, celda.alto);
        } catch (error) {
          // Una imagen que jsPDF no entiende no impide sacar el presupuesto.
          console.warn("[presupuesto] imagen que no se puede incrustar:", error);
        }
      }
      y += fila.alto + 6;
    }
  }

  // ---------------------------------------------------------------------------
  // Condiciones: a dos columnas, cada una con su visto delante
  // ---------------------------------------------------------------------------
  const cd = p.condiciones;
  const condiciones = cd.mostrar ? rellenarTexto(cd.texto, valores) : [];
  if (condiciones.length) {
    const TAM_COND = 8.8;
    const PASO = 4.16;
    const SEPARACION = 1.66;
    const SANGRIA = 5.5;
    const anchoColumna = (W - 2 * M) / 2 - 3;
    const items = condiciones.map((x) => partir("normal")(x, anchoColumna - SANGRIA, TAM_COND));
    const altoItem = (lineas: string[]) => lineas.length * PASO + SEPARACION;
    const enLaIzquierda = repartirEnDosColumnas(items.map(altoItem));
    const columnasCond = [items.slice(0, enLaIzquierda), items.slice(enLaIzquierda)];
    // Hasta la última línea de la columna más larga, con lo que baja la letra.
    const altoColumnas = Math.max(
      ...columnasCond.map((cc) =>
        cc.length ? cc.reduce((s, l) => s + altoItem(l), 0) - PASO - SEPARACION + 1.5 : 0,
      ),
    );
    const cabeza = cd.titulo.trim() ? 11.3 + 7.1 : 6;
    // La primera línea se apoya en `y`: lo de encima de la letra ya va en la cabeza.
    const escribir = (lineas: string[], x: number, base: number) => {
      visto(x, base, col.acento);
      fuente("normal", TAM_COND);
      lineas.forEach((l, i) => doc.text(l, x + SANGRIA, base + i * PASO));
    };
    const ponerTitulo = () => {
      if (cd.titulo.trim()) {
        y += 11.3;
        titulo(cd.titulo, M, y, 15);
        y += 7.1;
      } else {
        y += 6;
      }
    };
    const enUnaPagina = cabeza + altoColumnas <= mp.finCuerpo - ARRIBA;
    if (enUnaPagina) {
      sitio(cabeza + altoColumnas);
      ponerTitulo();
      columnasCond.forEach((cc, i) => {
        let yy = y;
        const x = M + i * ((W - 2 * M) / 2 + 3);
        for (const l of cc) {
          escribir(l, x, yy);
          yy += altoItem(l);
        }
      });
      y += altoColumnas;
    } else {
      // Muchas condiciones: una columna, pasando de página condición a condición.
      sitio(cabeza + altoItem(items[0]));
      ponerTitulo();
      const anchas = condiciones.map((x) => partir("normal")(x, W - 2 * M - SANGRIA, TAM_COND));
      for (const l of anchas) {
        if (y + l.length * PASO > mp.finCuerpo) {
          doc.addPage();
          y = ARRIBA;
        }
        escribir(l, M, y);
        y += altoItem(l);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // En cada página: la banda del pie; desde la segunda, arriba, a qué
  // presupuesto pertenece; y, si hay más de una, el número de página
  // ---------------------------------------------------------------------------
  const paginas = doc.getNumberOfPages();
  const referencia = referenciaPaginas(cab.titulo.texto, d.numero).toUpperCase();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    relleno(col.banda);
    doc.rect(0, mp.arriba, W, H - mp.arriba, "F");
    if (tituloPie) {
      const subidaTitulo = 11 * MM_POR_PUNTO * 0.86;
      fuente("titular", 11, col.acento);
      doc.text(tituloPie, M, mp.arriba + (H - mp.arriba - subidaTitulo) / 2 + subidaTitulo, {
        charSpace: ESPACIADO_TITULOS,
      });
    }
    if (lineasPie.length) {
      fuente("normal", tamPie, col.sobreBanda);
      const xPie =
        pie.alineacion === "centro"
          ? xTextoPie + anchoPie / 2
          : pie.alineacion === "derecha"
            ? W - M
            : xTextoPie;
      doc.text(lineasPie, xPie, mp.primeraLinea, {
        align:
          pie.alineacion === "centro" ? "center" : pie.alineacion === "derecha" ? "right" : "left",
      });
    }
    if (conNumeros) {
      fuente("normal", 7, GRIS);
      doc.text(`Página ${i} de ${paginas}`, W - M, mp.arriba - 1.5, { align: "right" });
    }
    if (i > 1) {
      relleno(col.banda);
      doc.rect(0, 0, W, ALTO_BANDA_SEGUIDA, "F");
      fuente("titular", 11, col.sobreBanda);
      doc.text(referencia, M, 9.3, { charSpace: ESPACIADO_TITULOS });
      const libre = W - 2 * M - anchoEspaciado(referencia, 11, ESPACIADO_TITULOS) - 8;
      fuente("bold", 8.5, col.acento);
      const nombre = doc.splitTextToSize(nombreComercial.toUpperCase(), libre)[0] ?? "";
      doc.text(nombre, W - M, 9, { align: "right" });
    }
  }

  return doc;
}
