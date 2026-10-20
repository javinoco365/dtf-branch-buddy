import type { jsPDF } from "jspdf";
import { eur, fechaCorta, metros, numero } from "@/lib/format";
import { LETRA, registrarFuentesPdf } from "@/lib/fuentes-pdf";
import {
  etiquetaGasto,
  horas,
  porcentaje,
  textoAvisoResumen,
  textoCargo,
  textoVigencia,
} from "@/lib/resumen-diario-textos";
import { DEFINICIONES } from "@/dominio/definiciones";
import type { AjustesJornada, GastoDelRango } from "@/dominio/gerencia";
import type { InformeAlmacen } from "@/dominio/cuenta-almacen";
import type { Partida } from "@/dominio/tipos-textil";
import {
  BLANCO,
  CIELO,
  GRIS,
  MARINO,
  NARANJA,
  NOCHE,
  TINTA,
  colorHex,
  type RGB,
} from "@/dominio/maqueta-presupuesto";
import {
  costesDelPeriodo,
  proporcion,
  ratiosDe,
  serieDelResumen,
  variacionResumen,
  type AvisoResumen,
  type CifrasNegocio,
  type Margenes,
  type Resumen,
} from "@/dominio/resumen-diario";

/**
 * El informe de los socios: un PDF corporativo con lo que ha pasado en el
 * periodo (un día, una semana, un mes, un trimestre o un año), para leerlo
 * sin entrar en la aplicación.
 *
 * - Página 1, resumen ejecutivo: el periodo en tres frases, las ocho cifras
 *   con su variación, cada negocio en barras, qué mirar y el resultado.
 * - Página 2, la cuenta del periodo: de lo vendido al beneficio, lo pedido
 *   frente a lo realizado y frente al periodo anterior; la máquina y los
 *   cobros; la evolución día a día (o mes a mes).
 * - Después, los gastos del periodo y el almacén textil: su cuenta, el valor
 *   de hoy, los controles que tienen que dar 0 y lo que se debe a los
 *   proveedores.
 * - La última, cada negocio en su ficha y cómo leer el informe.
 *
 * Con los colores y las letras de la casa (los del presupuesto). Las cifras
 * llegan hechas del dominio (`resumenPeriodo`): aquí solo se colocan.
 *
 * Solo se carga al pulsar el botón (import dinámico), con jsPDF.
 */

export type DatosInformeSocios = {
  resumen: Resumen;
  /** El periodo con que se compara; nulo sin comparación. */
  anterior: Resumen | null;
  /** «Informe semanal». */
  tipoInforme: string;
  /** «Semana del 5 al 11 de octubre de 2026». */
  periodo: string;
  /** Con qué se compara: «28 sep–4 oct 2026». */
  frente: string | null;
  empresa: { razon_social: string; cif: string | null };
  /** El color de cada tienda (hexadecimal), para sus barras y su ficha. */
  colores: Record<string, string | null | undefined>;
  jornada: AjustesJornada;
  /** Los gastos fijos del periodo uno a uno; nulo si no se han podido leer. */
  gastos: readonly GastoDelRango[] | null;
  /** La página «Almacén»; nulo (o ausente) si no se ha podido leer. */
  almacen?: InformeAlmacen | null;
  generado: Date;
};

// ---------------------------------------------------------------------------
// La paleta y la página
// ---------------------------------------------------------------------------

const W = 210;
const H = 297;
const M = 14;
const ANCHO = W - 2 * M;
/** Hasta dónde se escribe: debajo va el pie. */
const LIMITE = H - 18;

const VERDE: RGB = [22, 140, 74];
const ROJO: RGB = [205, 40, 40];
const AMBAR: RGB = [214, 120, 0];
const FONDO: RGB = [245, 246, 251];
const FONDO_CIELO: RGB = [234, 246, 253];
const FONDO_NARANJA: RGB = [255, 243, 230];
const LINEA: RGB = [222, 225, 236];
const SUAVE: RGB = [200, 204, 228];

/** El color del negocio: el de la tienda, naranja el textil, marino si no tiene. */
function colorNegocio(id: string, colores: DatosInformeSocios["colores"]): RGB {
  if (id === "textil-personalizado") return NARANJA;
  return colorHex(colores[id]) ?? MARINO;
}

type Letra = "titular" | "texto" | "negrita" | "cifras";

class Lienzo {
  y = 0;
  constructor(
    readonly doc: jsPDF,
    readonly d: DatosInformeSocios,
  ) {}

  letra(l: Letra, tam: number, color: RGB = TINTA) {
    const doc = this.doc;
    if (l === "titular") doc.setFont(LETRA.titular, "normal");
    else if (l === "negrita") doc.setFont(LETRA.texto, "bold");
    else if (l === "cifras") doc.setFont(LETRA.cifras, "normal");
    else doc.setFont(LETRA.texto, "normal");
    doc.setFontSize(tam);
    doc.setTextColor(...color);
  }

  relleno(c: RGB) {
    this.doc.setFillColor(...c);
  }

  texto(t: string, x: number, y: number, align: "left" | "right" | "center" = "left") {
    this.doc.text(t, x, y, { align, baseline: "alphabetic" });
  }

  /** Un texto que no cabe se reduce hasta caber (las cifras grandes). */
  ajustado(t: string, l: Letra, tam: number, ancho: number, color: RGB = TINTA) {
    let s = tam;
    this.letra(l, s, color);
    while (s > 7 && this.doc.getTextWidth(t) > ancho) {
      s -= 0.5;
      this.letra(l, s, color);
    }
  }

  /** Si no cabe `alto`, página nueva con su cabecera. */
  sitio(alto: number, titulo: string) {
    if (this.y + alto <= LIMITE) return;
    this.doc.addPage();
    this.cabeceraInterior(titulo);
  }

  /** La banda de las páginas 2 y siguientes. */
  cabeceraInterior(titulo: string) {
    const { doc, d } = this;
    this.relleno(NOCHE);
    doc.rect(0, 0, W, 20, "F");
    this.relleno(NARANJA);
    doc.rect(0, 20, W, 1, "F");
    this.letra("titular", 15, BLANCO);
    this.texto(titulo.toUpperCase(), M, 13);
    this.letra("texto", 8, SUAVE);
    this.texto(`Informe para los socios · ${d.periodo}`, W - M, 9, "right");
    this.texto(d.empresa.razon_social, W - M, 14, "right");
    this.y = 30;
  }

  /** El título de una sección, con su raya naranja. */
  seccion(t: string, nota?: string) {
    const { doc } = this;
    this.letra("titular", 12.5, MARINO);
    this.texto(t.toUpperCase(), M, this.y);
    const ancho = doc.getTextWidth(t.toUpperCase());
    this.relleno(NARANJA);
    doc.rect(M, this.y + 1.6, Math.min(ancho, 22), 0.9, "F");
    if (nota) {
      this.letra("texto", 7.5, GRIS);
      this.texto(nota, W - M, this.y, "right");
    }
    this.y += 7;
  }
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

const signo = (v: number) => (v < 0 ? "−" : "+");

/** Un coste que resta, sin «-0,00 €» cuando no hay coste. */
const menos = (x: number) => (x ? -x : 0);

/** «1 pedido», «3 pedidos». */
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «+12,4 %» de una variación en tanto por uno. */
const textoVariacion = (v: number) => `${signo(v)}${numero(Math.abs(v) * 100, 1)} %`;

/** Un triángulo hacia arriba (verde) o hacia abajo (rojo) y la variación. */
function variacion(
  c: Lienzo,
  v: number | null,
  x: number,
  y: number,
  frente: string | null,
  inverso = false,
) {
  const { doc } = c;
  if (!frente) return;
  if (v === null) {
    c.letra("texto", 6.5, GRIS);
    c.texto("sin datos antes", x, y);
    return;
  }
  const sube = v >= 0;
  const bueno = inverso ? !sube : sube;
  const color = Math.abs(v) < 0.0005 ? GRIS : bueno ? VERDE : ROJO;
  c.relleno(color);
  if (sube) doc.triangle(x, y, x + 2.6, y, x + 1.3, y - 2.2, "F");
  else doc.triangle(x, y - 2.2, x + 2.6, y - 2.2, x + 1.3, y, "F");
  c.letra("negrita", 7, color);
  c.texto(textoVariacion(v), x + 3.6, y);
}

type Tarjeta = {
  etiqueta: string;
  valor: string;
  pie: string;
  color: RGB;
  v: number | null;
  rojo?: boolean;
  /** Sin variación (un porcentaje de uso no se compara así). */
  sinVariacion?: boolean;
};

function tarjeta(c: Lienzo, t: Tarjeta, x: number, y: number, w: number, h: number) {
  const { doc } = c;
  c.relleno(FONDO);
  doc.roundedRect(x, y, w, h, 1.8, 1.8, "F");
  c.relleno(t.color);
  doc.rect(x, y, w, 1.1, "F");
  c.letra("negrita", 6.3, GRIS);
  c.texto(t.etiqueta.toUpperCase(), x + 3, y + 6.2);
  c.ajustado(t.valor, "titular", 16, w - 6, t.rojo ? ROJO : TINTA);
  c.texto(t.valor, x + 3, y + 14.8);
  if (!t.sinVariacion) variacion(c, t.v, x + 3, y + 20.2, c.d.frente);
  c.letra("texto", 6.2, GRIS);
  const pie = c.doc.splitTextToSize(t.pie, w - 6) as string[];
  c.texto(pie[0] ?? "", x + 3, y + h - 2.8);
}

/** Una barra de progreso con su color según lo lleno que esté. */
function barra(
  c: Lienzo,
  x: number,
  y: number,
  w: number,
  h: number,
  valor: number | null,
  color: RGB,
) {
  const { doc } = c;
  c.relleno(LINEA);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");
  const v = Math.max(0, Math.min(1, valor ?? 0));
  if (v > 0) {
    c.relleno(color);
    doc.roundedRect(x, y, Math.max(h, w * v), h, h / 2, h / 2, "F");
  }
}

/** Una línea «etiqueta ……… valor» de un panel. */
function fila(
  c: Lienzo,
  etiqueta: string,
  valor: string,
  x: number,
  w: number,
  opciones: { rojo?: boolean; fuerte?: boolean; nota?: string } = {},
) {
  c.letra(opciones.fuerte ? "negrita" : "texto", 8, opciones.fuerte ? TINTA : GRIS);
  c.texto(etiqueta, x, c.y);
  if (opciones.nota) {
    const ancho = c.doc.getTextWidth(etiqueta);
    c.letra("texto", 6.5, GRIS);
    c.texto(opciones.nota, x + ancho + 1.5, c.y);
  }
  c.letra(opciones.fuerte ? "negrita" : "cifras", 8.2, opciones.rojo ? ROJO : TINTA);
  c.texto(valor, x + w, c.y, "right");
  c.y += 5.2;
}

// ---------------------------------------------------------------------------
// Página 1: resumen ejecutivo
// ---------------------------------------------------------------------------

function portada(c: Lienzo) {
  const { doc, d } = c;
  c.relleno(NOCHE);
  doc.rect(0, 0, W, 46, "F");
  c.relleno(NARANJA);
  doc.rect(0, 46, W, 1.6, "F");
  c.relleno(CIELO);
  doc.rect(M, 11, 1.2, 25, "F");

  c.letra("negrita", 7.5, CIELO);
  c.texto(`${d.tipoInforme} para los socios`.toUpperCase(), M + 4.5, 14);
  c.ajustado(d.periodo.toUpperCase(), "titular", 25, 118, BLANCO);
  c.texto(d.periodo.toUpperCase(), M + 4.5, 26.5);
  c.letra("texto", 8, SUAVE);
  c.texto(
    `Tiendas DTF y textil personalizado${d.frente ? ` · comparado con ${d.frente}` : ""}`,
    M + 4.5,
    33.5,
  );

  c.ajustado(d.empresa.razon_social.toUpperCase(), "titular", 12, 62, BLANCO);
  c.texto(d.empresa.razon_social.toUpperCase(), W - M, 15, "right");
  c.letra("texto", 7.5, SUAVE);
  if (d.empresa.cif) c.texto(`CIF ${d.empresa.cif}`, W - M, 20.5, "right");
  const f = d.generado;
  const dd = (n: number) => String(n).padStart(2, "0");
  c.texto(
    `Emitido el ${dd(f.getDate())}/${dd(f.getMonth() + 1)}/${f.getFullYear()} a las ${dd(f.getHours())}:${dd(f.getMinutes())}`,
    W - M,
    25.5,
    "right",
  );
  c.texto("Datos reales del CRM, sin retoques", W - M, 30.5, "right");
  c.y = 57;
}

/** El periodo en tres o cuatro frases, con cifras. */
function frases(d: DatosInformeSocios): string[] {
  const r = d.resumen;
  const t = r.total;
  const a = d.anterior?.total;
  const x = ratiosDe(t);
  if (t.pedido.pedidos === 0 && t.realizado.pedidos === 0 && t.cobrado === 0) {
    return ["En este periodo no entró ningún pedido, no se terminó ninguno y no se cobró nada."];
  }
  const out: string[] = [];
  const v = a ? variacionResumen(t.pedido.vendido, a.pedido.vendido) : null;
  out.push(
    `Entraron ${t.pedido.pedidos} ${t.pedido.pedidos === 1 ? "pedido" : "pedidos"} por ${eur(t.pedido.vendido)} con IVA` +
      (v !== null && d.frente ? ` (${textoVariacion(v)} frente a ${d.frente})` : "") +
      (t.pedido.metros > 0 ? `, con ${metros(t.pedido.metros)} de DTF.` : "."),
  );
  if (r.capacidad.dias > 0 || t.realizado.metrosImpresos > 0) {
    out.push(
      `Se imprimieron ${metros(t.realizado.metrosImpresos)}` +
        (r.capacidad.uso != null
          ? `, el ${porcentaje(r.capacidad.uso)} de lo que podía hacer la máquina`
          : "") +
        (t.cola.pedidos > 0
          ? `; quedan ${t.cola.pedidos} pedidos (${metros(t.cola.metros)}) en cola.`
          : "; no queda nada en cola."),
    );
  }
  out.push(
    `El margen neto, después de producir y enviar, fue de ${eur(t.pedido.margenConEnvios)}` +
      (x.margenNeto != null ? ` (${porcentaje(x.margenNeto)} de lo facturado sin IVA)` : "") +
      `. Se cobraron ${eur(t.cobrado)} y de lo vendido quedan ${eur(t.pedido.pendiente)} por cobrar.`,
  );
  if (r.beneficio != null) {
    out.push(
      `Descontados ${eur(r.gastosFijos)} de gastos fijos, el periodo deja ` +
        (r.beneficio >= 0
          ? `${eur(r.beneficio)} de beneficio.`
          : `${eur(-r.beneficio)} de pérdida.`),
    );
  }
  return out;
}

function enUnaFrase(c: Lienzo) {
  const { doc } = c;
  c.letra("texto", 9);
  const lineas = frases(c.d).flatMap((f) => doc.splitTextToSize(f, ANCHO - 12) as string[]);
  const alto = 8 + lineas.length * 4.4;
  c.relleno(FONDO_CIELO);
  doc.roundedRect(M, c.y, ANCHO, alto, 1.8, 1.8, "F");
  c.relleno(CIELO);
  doc.rect(M, c.y, 1.4, alto, "F");
  c.letra("negrita", 7, CIELO);
  c.texto("EL PERIODO EN POCAS PALABRAS", M + 6, c.y + 5.5);
  c.letra("texto", 9, TINTA);
  lineas.forEach((l, i) => c.texto(l, M + 6, c.y + 10.5 + i * 4.4));
  c.y += alto + 7;
}

function cifrasClave(c: Lienzo) {
  const { d } = c;
  const t = d.resumen.total;
  const a = d.anterior?.total;
  const x = ratiosDe(t);
  const v = (actual: number, previo: number | undefined) =>
    previo === undefined ? null : variacionResumen(actual, previo);
  const tarjetas: Tarjeta[] = [
    {
      etiqueta: "Pedidos",
      valor: String(t.pedido.pedidos),
      pie: `Ticket medio ${eur(t.pedido.ticket)}`,
      color: MARINO,
      v: v(t.pedido.pedidos, a?.pedido.pedidos),
    },
    {
      etiqueta: "Metros pedidos",
      valor: metros(t.pedido.metros),
      pie:
        t.pedido.fueraDeHora === 1
          ? "1 entró fuera de hora"
          : `${t.pedido.fueraDeHora} entraron fuera de hora`,
      color: MARINO,
      v: v(t.pedido.metros, a?.pedido.metros),
    },
    {
      etiqueta: "Metros realizados",
      valor: metros(t.realizado.metrosImpresos),
      pie: `${plural(t.realizado.pedidos, "pedido terminado", "pedidos terminados")}`,
      color: CIELO,
      v: v(t.realizado.metrosImpresos, a?.realizado.metrosImpresos),
    },
    {
      etiqueta: "Uso de la máquina",
      valor: porcentaje(d.resumen.capacidad.uso),
      pie: `De ${metros(d.resumen.capacidad.metros)} posibles`,
      color: CIELO,
      v: null,
      sinVariacion: true,
    },
    {
      etiqueta: "Facturado",
      valor: eur(t.facturado),
      pie: "Tickets y facturas, sin IVA",
      color: NARANJA,
      v: v(t.facturado, a?.facturado),
    },
    {
      etiqueta: "Cobrado",
      valor: eur(t.cobrado),
      pie: `Por cobrar de lo vendido: ${eur(t.pedido.pendiente)}`,
      color: NARANJA,
      v: v(t.cobrado, a?.cobrado),
    },
    {
      etiqueta: "Margen neto",
      valor: eur(t.pedido.margenConEnvios),
      pie:
        x.margenNeto != null ? `${porcentaje(x.margenNeto)} de la facturación` : "Sin facturación",
      color: VERDE,
      v: v(t.pedido.margenConEnvios, a?.pedido.margenConEnvios),
      rojo: t.pedido.margenConEnvios < 0,
    },
    {
      etiqueta: "Margen sin envíos",
      valor: eur(t.pedido.margenSinEnvios),
      pie: `Envíos: ${signo(t.pedido.resultadoEnvios)}${eur(Math.abs(t.pedido.resultadoEnvios))}`,
      color: VERDE,
      v: v(t.pedido.margenSinEnvios, a?.pedido.margenSinEnvios),
      rojo: t.pedido.margenSinEnvios < 0,
    },
  ];
  const hueco = 3;
  const w = (ANCHO - 3 * hueco) / 4;
  const h = 27;
  // Sin comparación, la tarjeta de la máquina no lleva variación: sí su pie.
  tarjetas.forEach((t2, i) => {
    const x2 = M + (i % 4) * (w + hueco);
    const y2 = c.y + Math.floor(i / 4) * (h + hueco);
    tarjeta(c, t2, x2, y2, w, h);
  });
  c.y += 2 * h + hueco + 9;
}

function porNegocio(c: Lienzo) {
  const { doc, d } = c;
  const r = d.resumen;
  if (r.negocios.length === 0) return;
  c.sitio(14 + r.negocios.length * 12, "Resumen");
  c.seccion("Cada negocio", "Vendido con IVA y margen neto del periodo");
  const maximo = Math.max(1, ...r.negocios.map((n) => Math.abs(n.pedido.vendido)));
  const xBarra = M + 46;
  const wBarra = ANCHO - 46 - 30;
  for (const n of r.negocios) {
    const color = colorNegocio(n.id, d.colores);
    const y = c.y;
    c.relleno(color);
    doc.circle(M + 1.6, y + 2.6, 1.6, "F");
    c.ajustado(n.nombre, "negrita", 8.5, 40);
    c.texto(n.nombre, M + 5, y + 3.6);
    c.letra("texto", 6.5, GRIS);
    c.texto(
      `${n.pedido.pedidos} ped. · ${metros(n.pedido.metros)} · hechos ${metros(n.realizado.metrosImpresos)}`,
      M + 5,
      y + 7.6,
    );
    // Vendido
    barra(c, xBarra, y, wBarra, 3.6, n.pedido.vendido / maximo, color);
    c.letra("cifras", 7.5);
    c.texto(eur(n.pedido.vendido), W - M, y + 3, "right");
    // Margen neto
    const margen = n.pedido.margenConEnvios;
    barra(c, xBarra, y + 5, wBarra, 2.4, Math.max(0, margen) / maximo, margen < 0 ? ROJO : VERDE);
    c.letra("negrita", 7, margen < 0 ? ROJO : VERDE);
    c.texto(eur(margen), W - M, y + 7.4, "right");
    c.y += 11.5;
  }
  c.letra("texto", 6.5, GRIS);
  c.relleno(MARINO);
  doc.rect(xBarra, c.y - 2, 4, 1.8, "F");
  c.texto("Vendido", xBarra + 5.5, c.y - 0.4);
  c.relleno(VERDE);
  doc.rect(xBarra + 22, c.y - 2, 4, 1.8, "F");
  c.texto("Margen neto (rojo si pierde)", xBarra + 27.5, c.y - 0.4);
  c.y += 7;
}

const COLOR_AVISO: Record<AvisoResumen["nivel"], RGB> = {
  alto: ROJO,
  medio: AMBAR,
  info: CIELO,
};

function avisosYResultado(c: Lienzo) {
  const { doc, d } = c;
  const r = d.resumen;
  const avisos = r.avisos.slice(0, 5);
  c.letra("texto", 7.8);
  const wCol = (ANCHO - 6) / 2;
  const lineasAvisos = avisos.map(
    (a) => doc.splitTextToSize(textoAvisoResumen(a), wCol - 12) as string[],
  );
  const altoAvisos =
    12 +
    Math.max(
      1,
      lineasAvisos.reduce((s, l) => s + l.length * 3.6 + 2, 0),
    ) +
    2;
  const altoResultado =
    12 +
    3 * 5.2 +
    (r.objetivo.avanceMetros != null ? 11 : 0) +
    (r.objetivo.avanceVendido != null ? 11 : 0) +
    4;
  const alto = Math.max(altoAvisos, altoResultado, 40);
  c.sitio(alto + 2, "Resumen");
  const y0 = c.y;

  // Qué mirar
  c.relleno(FONDO);
  doc.roundedRect(M, y0, wCol, alto, 1.8, 1.8, "F");
  c.letra("titular", 11, MARINO);
  c.texto("QUÉ MIRAR", M + 5, y0 + 7.5);
  let y = y0 + 13.5;
  if (avisos.length === 0) {
    c.letra("texto", 7.8, GRIS);
    c.texto("Nada fuera de lo normal.", M + 5, y);
  }
  avisos.forEach((a, i) => {
    c.relleno(COLOR_AVISO[a.nivel]);
    doc.circle(M + 6.2, y - 1.1, 1.3, "F");
    c.letra("texto", 7.8, TINTA);
    lineasAvisos[i].forEach((l, j) => c.texto(l, M + 9.5, y + j * 3.6));
    y += lineasAvisos[i].length * 3.6 + 2;
  });

  // Resultado
  const x = M + wCol + 6;
  const beneficio = r.beneficio;
  c.relleno(beneficio == null || beneficio >= 0 ? FONDO : FONDO_NARANJA);
  doc.roundedRect(x, y0, wCol, alto, 1.8, 1.8, "F");
  c.letra("titular", 11, MARINO);
  c.texto("RESULTADO DEL PERIODO", x + 5, y0 + 7.5);
  c.y = y0 + 14;
  fila(c, "Margen neto", eur(r.total.pedido.margenConEnvios), x + 5, wCol - 10, {
    rojo: r.total.pedido.margenConEnvios < 0,
  });
  fila(
    c,
    "Gastos fijos del periodo",
    r.gastosFijos == null ? "—" : `−${eur(r.gastosFijos)}`,
    x + 5,
    wCol - 10,
  );
  doc.setDrawColor(...LINEA);
  doc.line(x + 5, c.y - 3.4, x + wCol - 5, c.y - 3.4);
  c.letra("titular", 13, beneficio != null && beneficio < 0 ? ROJO : VERDE);
  c.texto(beneficio == null ? "—" : eur(beneficio), x + wCol - 5, c.y + 1, "right");
  c.letra("negrita", 8.5, TINTA);
  c.texto(beneficio != null && beneficio < 0 ? "Pérdida" : "Beneficio", x + 5, c.y + 0.6);
  c.y += 8;
  const objetivo = (etiqueta: string, avance: number, texto: string) => {
    c.letra("texto", 7, GRIS);
    c.texto(etiqueta, x + 5, c.y);
    c.letra("negrita", 7, TINTA);
    c.texto(porcentaje(avance), x + wCol - 5, c.y, "right");
    barra(c, x + 5, c.y + 1.5, wCol - 10, 2.2, avance, avance >= 1 ? VERDE : CIELO);
    c.letra("texto", 6.3, GRIS);
    c.texto(texto, x + 5, c.y + 7);
    c.y += 11;
  };
  if (r.objetivo.avanceMetros != null) {
    objetivo(
      "Objetivo de metros",
      r.objetivo.avanceMetros,
      `${metros(r.total.realizado.metrosImpresos)} de ${metros(r.objetivo.metros)}`,
    );
  }
  if (r.objetivo.avanceVendido != null) {
    objetivo(
      "Objetivo de ventas",
      r.objetivo.avanceVendido,
      `${eur(r.total.pedido.vendido)} de ${eur(r.objetivo.vendido)}`,
    );
  }
  c.y = y0 + alto + 6;
}

// ---------------------------------------------------------------------------
// Página 2: la cuenta del periodo
// ---------------------------------------------------------------------------

type Concepto = {
  etiqueta: string;
  valor: (m: Margenes) => number;
  formato?: (n: number) => string;
  tipo?: "suma" | "resultado" | "clave";
};

const CONCEPTOS: Concepto[] = [
  { etiqueta: "Pedidos", valor: (m) => m.pedidos, formato: (n) => String(n) },
  { etiqueta: "Metros de DTF", valor: (m) => m.metros, formato: metros },
  { etiqueta: "Vendido (con IVA y envío)", valor: (m) => m.vendido },
  { etiqueta: "Facturación bruta (sin IVA ni envío)", valor: (m) => m.bruta, tipo: "clave" },
  { etiqueta: "− Coste de producción", valor: (m) => menos(m.costeProduccion) },
  { etiqueta: "= Margen sin envíos", valor: (m) => m.margenSinEnvios, tipo: "suma" },
  { etiqueta: "+ Envíos cobrados al cliente", valor: (m) => m.enviosCobrados },
  { etiqueta: "− Lo que cobra la agencia", valor: (m) => menos(m.costeEnvios) },
  { etiqueta: "= Margen neto", valor: (m) => m.margenConEnvios, tipo: "resultado" },
];

async function cuentaDelPeriodo(c: Lienzo, autoTable: AutoTable) {
  const { doc, d } = c;
  const r = d.resumen;
  const t = r.total;
  const a = d.anterior?.total;
  c.seccion(
    "De lo vendido al beneficio",
    "«Pedido»: lo que entró en el periodo · «Realizado»: lo que se terminó en él",
  );
  const formatoDe = (k: Concepto) => k.formato ?? ((n: number) => eur(n));
  const cuerpo = CONCEPTOS.map((k) => {
    const actual = k.valor(t.pedido);
    const previo = a ? k.valor(a.pedido) : null;
    const v = previo === null ? null : variacionResumen(actual, previo);
    return [
      k.etiqueta,
      formatoDe(k)(actual),
      formatoDe(k)(k.valor(t.realizado)),
      previo === null ? "—" : formatoDe(k)(previo),
      v === null ? "—" : textoVariacion(v),
    ];
  });
  const estimados = t.pedido.enviosEstimados;
  cuerpo.push(
    [
      "− Gastos fijos del periodo",
      r.gastosFijos == null ? "—" : eur(menos(r.gastosFijos)),
      "",
      d.anterior?.gastosFijos == null ? "—" : eur(menos(d.anterior.gastosFijos)),
      "",
    ],
    [
      "= Beneficio",
      r.beneficio == null ? "—" : eur(r.beneficio),
      "",
      d.anterior?.beneficio == null ? "—" : eur(d.anterior.beneficio),
      r.beneficio != null && d.anterior?.beneficio != null
        ? (() => {
            const v = variacionResumen(r.beneficio, d.anterior.beneficio);
            return v === null ? "—" : textoVariacion(v);
          })()
        : "—",
    ],
  );
  const tipos = [...CONCEPTOS.map((k) => k.tipo), undefined, "resultado"];
  autoTable(doc, {
    startY: c.y,
    margin: { left: M, right: M },
    head: [["", "Pedido", "Realizado", d.frente ? `Antes (${d.frente})` : "Antes", "Variación"]],
    body: cuerpo,
    theme: "plain",
    styles: { font: LETRA.texto, fontSize: 8.2, textColor: TINTA, cellPadding: 1.9 },
    headStyles: {
      font: LETRA.texto,
      fontStyle: "bold",
      fillColor: NOCHE,
      textColor: BLANCO,
      fontSize: 7.5,
      halign: "right",
    },
    columnStyles: {
      0: { cellWidth: 70, halign: "left" },
      1: { halign: "right", font: LETRA.cifras },
      2: { halign: "right", font: LETRA.cifras },
      3: { halign: "right", textColor: GRIS },
      4: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index === 0) h.cell.styles.halign = "left";
      if (h.section !== "body") return;
      const tipo = tipos[h.row.index];
      // La negrita es la de Inter: la de las cifras no tiene negrita.
      if (tipo === "suma" || tipo === "clave") {
        h.cell.styles.fillColor = FONDO;
        h.cell.styles.font = LETRA.texto;
        h.cell.styles.fontStyle = "bold";
      }
      if (tipo === "resultado") {
        h.cell.styles.fillColor = FONDO_NARANJA;
        h.cell.styles.font = LETRA.texto;
        h.cell.styles.fontStyle = "bold";
        h.cell.styles.fontSize = 9;
      }
      const texto = String(h.cell.raw ?? "");
      if (h.column.index === 4 && texto !== "—" && texto !== "") {
        h.cell.styles.textColor = texto.startsWith("−") ? ROJO : VERDE;
      } else if (h.column.index > 0 && texto.startsWith("-") && tipo === "resultado") {
        h.cell.styles.textColor = ROJO;
      }
    },
    didDrawCell: (h) => {
      if (h.section === "body") {
        doc.setDrawColor(...LINEA);
        doc.line(
          h.cell.x,
          h.cell.y + h.cell.height,
          h.cell.x + h.cell.width,
          h.cell.y + h.cell.height,
        );
      }
    },
  });
  c.y = finTabla(doc) + 3;
  c.letra("texto", 6.8, GRIS);
  const nota =
    `Costes de producción: metros × coste por metro congelado en cada pedido; en textil, la ropa que salió del almacén.` +
    (estimados > 0
      ? ` ${estimados} ${estimados === 1 ? "envío" : "envíos"} sin coste real apuntado se estiman a ${eur(d.jornada.coste_envio_defecto)} cada uno.`
      : "");
  (doc.splitTextToSize(nota, ANCHO) as string[]).forEach((l) => {
    c.texto(l, M, c.y + 2);
    c.y += 3.4;
  });
  c.y += 7;
}

function maquinaYCobros(c: Lienzo) {
  const { doc, d } = c;
  const r = d.resumen;
  const t = r.total;
  const x2 = ratiosDe(t);
  const wCol = (ANCHO - 6) / 2;
  const alto = 64;
  c.sitio(alto + 4, "Cuenta del periodo");
  const y0 = c.y;

  // Producción
  c.relleno(FONDO);
  doc.roundedRect(M, y0, wCol, alto, 1.8, 1.8, "F");
  c.letra("titular", 11, MARINO);
  c.texto("PRODUCCIÓN", M + 5, y0 + 7.5);
  const uso = r.capacidad.uso;
  c.letra("titular", 18, uso != null && uso >= 0.9 ? ROJO : TINTA);
  c.texto(porcentaje(uso), M + wCol - 5, y0 + 9, "right");
  barra(
    c,
    M + 5,
    y0 + 12,
    wCol - 10,
    3,
    uso,
    uso == null ? GRIS : uso >= 0.9 ? ROJO : uso < 0.5 ? AMBAR : VERDE,
  );
  c.letra("texto", 6.3, GRIS);
  c.texto(
    `Uso de la máquina: ${numero(d.jornada.metros_hora, 0)} m/h · ${d.jornada.jornada_inicio}–${d.jornada.jornada_fin} · ${r.capacidad.dias} ${r.capacidad.dias === 1 ? "día laborable" : "días laborables"}`,
    M + 5,
    y0 + 19.5,
  );
  c.y = y0 + 26;
  const w = wCol - 10;
  fila(c, "Metros impresos", metros(t.realizado.metrosImpresos), M + 5, w, { fuerte: true });
  fila(c, "Capacidad de la máquina", metros(r.capacidad.metros), M + 5, w);
  fila(c, "En cola al cerrar", `${t.cola.pedidos} · ${metros(t.cola.metros)}`, M + 5, w);
  fila(c, "Fuera de hora", String(t.pedido.fueraDeHora), M + 5, w, {
    nota: `desde las ${d.jornada.hora_corte}`,
  });
  fila(c, "Del pedido a terminado", horas(t.realizado.horasMedias), M + 5, w, { nota: "media" });
  fila(c, "Cancelados", String(t.pedido.cancelados), M + 5, w);

  // Cobros
  const x = M + wCol + 6;
  c.relleno(FONDO);
  doc.roundedRect(x, y0, wCol, alto, 1.8, 1.8, "F");
  c.letra("titular", 11, MARINO);
  c.texto("DINERO", x + 5, y0 + 7.5);
  c.letra("titular", 18, TINTA);
  c.texto(porcentaje(x2.cobradoDeLoPedido), x + wCol - 5, y0 + 9, "right");
  barra(c, x + 5, y0 + 12, wCol - 10, 3, x2.cobradoDeLoPedido, VERDE);
  c.letra("texto", 6.3, GRIS);
  c.texto("De lo vendido en el periodo, la parte ya cobrada", x + 5, y0 + 19.5);
  c.y = y0 + 26;
  fila(c, "Vendido (con IVA)", eur(t.pedido.vendido), x + 5, w, { fuerte: true });
  fila(c, "Facturado (sin IVA)", eur(t.facturado), x + 5, w);
  fila(c, "Cobrado en el periodo", eur(t.cobrado), x + 5, w);
  fila(c, "De lo vendido, por cobrar", eur(t.pedido.pendiente), x + 5, w, {
    rojo: t.pedido.pendiente > 0,
  });
  fila(
    c,
    "Terminados sin cobrar",
    `${t.realizado.sinCobrar} · ${eur(t.realizado.importeSinCobrar)}`,
    x + 5,
    w,
    { rojo: t.realizado.sinCobrar > 0 },
  );
  fila(
    c,
    "Precio medio del metro",
    t.pedido.euroMetro == null ? "—" : eur(t.pedido.euroMetro),
    x + 5,
    w,
    { nota: "sin IVA" },
  );
  c.y = y0 + alto + 8;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function evolucion(c: Lienzo, autoTable: AutoTable) {
  const { doc, d } = c;
  const serie = serieDelResumen(d.resumen);
  if (serie.tramos.length < 2) return;
  const etiqueta = (clave: string) =>
    serie.por === "mes"
      ? `${MESES[Number(clave.slice(5, 7)) - 1]} ${clave.slice(2, 4)}`
      : `${clave.slice(8, 10)}/${clave.slice(5, 7)}`;

  const alto = 52;
  c.sitio(alto + 14, "Evolución");
  c.seccion(
    serie.por === "mes" ? "Mes a mes" : "Día a día",
    "Metros pedidos y realizados · vendido con IVA",
  );
  const y0 = c.y;
  const xEje = M + 12;
  const wGraf = ANCHO - 12;
  const hGraf = alto - 12;
  const maxM = Math.max(1, ...serie.tramos.flatMap((t) => [t.metrosPedidos, t.metrosImpresos]));
  const maxV = Math.max(1, ...serie.tramos.map((t) => t.vendido));
  const paso = wGraf / serie.tramos.length;
  const wBarra = Math.min(5, (paso - 1.5) / 2);
  // Rejilla
  doc.setDrawColor(...LINEA);
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 4; i++) {
    const y = y0 + hGraf - (hGraf * i) / 4;
    doc.line(xEje, y, xEje + wGraf, y);
    c.letra("texto", 5.8, GRIS);
    c.texto(numero((maxM * i) / 4, 0), xEje - 1.5, y + 1, "right");
  }
  c.letra("texto", 5.8, GRIS);
  c.texto("m", xEje - 1.5, y0 - 2.5, "right");
  // Barras y la línea de lo vendido
  const puntos: [number, number][] = [];
  serie.tramos.forEach((t, i) => {
    const cx = xEje + paso * i + paso / 2;
    const hp = (hGraf * t.metrosPedidos) / maxM;
    const hi = (hGraf * t.metrosImpresos) / maxM;
    c.relleno(SUAVE);
    if (hp > 0) doc.rect(cx - wBarra, y0 + hGraf - hp, wBarra, hp, "F");
    c.relleno(CIELO);
    if (hi > 0) doc.rect(cx, y0 + hGraf - hi, wBarra, hi, "F");
    puntos.push([cx, y0 + hGraf - (hGraf * t.vendido) / maxV]);
    const cada = Math.ceil(serie.tramos.length / 16);
    if (i % cada === 0) {
      c.letra("texto", 5.8, GRIS);
      c.texto(etiqueta(t.dia), cx, y0 + hGraf + 4, "center");
    }
  });
  doc.setDrawColor(...NARANJA);
  doc.setLineWidth(0.6);
  for (let i = 1; i < puntos.length; i++) {
    doc.line(puntos[i - 1][0], puntos[i - 1][1], puntos[i][0], puntos[i][1]);
  }
  c.relleno(NARANJA);
  puntos.forEach(([px, py]) => doc.circle(px, py, 0.7, "F"));
  doc.setLineWidth(0.2);
  // Leyenda
  const yl = y0 + hGraf + 9;
  const leyenda = (x: number, color: RGB, texto: string) => {
    c.relleno(color);
    doc.rect(x, yl - 2, 4, 2, "F");
    c.letra("texto", 6.5, GRIS);
    c.texto(texto, x + 5.5, yl - 0.2);
  };
  leyenda(xEje, SUAVE, "Metros pedidos");
  leyenda(xEje + 32, CIELO, "Metros realizados");
  leyenda(xEje + 68, NARANJA, `Vendido (máximo ${eur(maxV)})`);
  c.y = yl + 6;

  // La tabla: entera en la página siguiente si aquí no cabe.
  c.sitio(Math.min((serie.tramos.length + 2) * 5.4, LIMITE - 30), "Evolución");
  const primera = doc.getNumberOfPages();
  autoTable(doc, {
    startY: c.y,
    margin: { left: M, right: M, top: 30, bottom: H - LIMITE },
    head: [
      [
        serie.por === "mes" ? "Mes" : "Día",
        "Pedidos",
        "Metros pedidos",
        "Metros hechos",
        "Vendido",
        "Cobrado",
        "Margen neto",
      ],
    ],
    body: serie.tramos.map((t) => [
      serie.por === "mes"
        ? `${MESES[Number(t.dia.slice(5, 7)) - 1]} ${t.dia.slice(0, 4)}`
        : `${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][new Date(`${t.dia}T12:00:00Z`).getUTCDay()]} ${t.dia.slice(8, 10)}/${t.dia.slice(5, 7)}`,
      String(t.pedidos),
      metros(t.metrosPedidos),
      metros(t.metrosImpresos),
      eur(t.vendido),
      eur(t.cobrado),
      eur(t.margenConEnvios),
    ]),
    foot: [
      [
        "Total",
        String(d.resumen.total.pedido.pedidos),
        metros(d.resumen.total.pedido.metros),
        metros(d.resumen.total.realizado.metrosImpresos),
        eur(d.resumen.total.pedido.vendido),
        eur(d.resumen.total.cobrado),
        eur(d.resumen.total.pedido.margenConEnvios),
      ],
    ],
    theme: "plain",
    styles: {
      font: LETRA.texto,
      fontSize: 7.2,
      textColor: TINTA,
      cellPadding: 1.3,
      halign: "right",
    },
    headStyles: { fillColor: NOCHE, textColor: BLANCO, fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: FONDO_NARANJA, fontStyle: "bold" },
    columnStyles: { 0: { halign: "left" } },
    alternateRowStyles: { fillColor: FONDO },
    didParseCell: (h) => {
      if (h.column.index === 0) h.cell.styles.halign = "left";
      if (h.section === "body" && h.column.index === 6 && String(h.cell.raw).startsWith("-")) {
        h.cell.styles.textColor = ROJO;
      }
    },
    // Una tabla de más de una página: cada página nueva, con su banda.
    didDrawPage: () => {
      if (doc.getNumberOfPages() > primera && doc.getCurrentPageInfo().pageNumber > primera) {
        const y = c.y;
        c.cabeceraInterior("Evolución");
        c.y = y;
      }
    },
  });
  c.y = finTabla(doc) + 8;
}

// ---------------------------------------------------------------------------
// Los gastos del periodo
// ---------------------------------------------------------------------------

function gastosDelPeriodo(c: Lienzo, autoTable: AutoTable, inicio: number) {
  const { doc, d } = c;
  const costes = costesDelPeriodo(d.resumen);
  c.seccion("En qué se fue el dinero", "Costes de lo pedido en el periodo, sin IVA");

  // Las tres partidas en una barra, y cada una con su parte.
  const partidas: [string, number, RGB, string][] = [
    ["Producción", costes.produccion, CIELO, "Metros × coste por metro; ropa del textil"],
    ["Envíos", costes.envios, NARANJA, "Lo que cobra la agencia"],
    ["Gastos fijos", costes.fijos, MARINO, "Alquiler, sueldos, cuotas… (abajo, uno a uno)"],
  ];
  const y0 = c.y;
  let x = M;
  for (const [, importe, color] of partidas) {
    const parte = proporcion(importe, costes.total) ?? 0;
    if (parte <= 0) continue;
    c.relleno(color);
    doc.rect(x, y0, ANCHO * parte, 6, "F");
    x += ANCHO * parte;
  }
  if (costes.total <= 0) {
    c.relleno(LINEA);
    doc.rect(M, y0, ANCHO, 6, "F");
  }
  c.y = y0 + 12;
  const wCol = (ANCHO - 2 * 4) / 3;
  partidas.forEach(([nombre, importe, color, nota], i) => {
    const cx = M + i * (wCol + 4);
    c.relleno(color);
    doc.rect(cx, c.y - 3, 2.4, 2.4, "F");
    c.letra("negrita", 8, TINTA);
    c.texto(nombre, cx + 4, c.y - 0.8);
    c.letra("titular", 14, TINTA);
    c.texto(eur(importe), cx, c.y + 6.5);
    c.letra("negrita", 7.5, GRIS);
    c.texto(porcentaje(proporcion(importe, costes.total)), cx + wCol, c.y + 6.5, "right");
    c.letra("texto", 6.3, GRIS);
    c.texto(nota, cx, c.y + 11);
  });
  c.y += 15;
  c.relleno(FONDO_NARANJA);
  doc.roundedRect(M, c.y, ANCHO, 9, 1.5, 1.5, "F");
  c.letra("negrita", 8.5, TINTA);
  c.texto("Total de costes del periodo", M + 4, c.y + 5.9);
  c.letra("titular", 12, TINTA);
  c.texto(eur(costes.total), W - M - 4, c.y + 6.2, "right");
  c.y += 17;

  // Los gastos fijos, uno a uno.
  c.seccion("Gastos fijos, uno a uno", "Lo que le toca a cada uno en el periodo");
  const lista = d.gastos;
  if (!lista || lista.length === 0) {
    c.letra("texto", 8.5, GRIS);
    c.texto(
      lista ? "No hay gastos fijos en este periodo." : "No se han podido leer los gastos fijos.",
      M,
      c.y,
    );
    c.y += 8;
  } else {
    autoTable(doc, {
      startY: c.y,
      margin: { left: M, right: M, top: 30, bottom: H - LIMITE },
      head: [["Concepto", "Tipo", "Cada cargo", "Vigencia", "Justif.", "En el periodo"]],
      body: lista.map(({ gasto: g, importe }) => [
        g.concepto + (g.notas ? `\n${g.notas}` : ""),
        etiquetaGasto(g),
        textoCargo(g),
        textoVigencia(g),
        g.con_justificante === false ? "No" : "Sí",
        eur(importe),
      ]),
      foot: [["Total gastos fijos", "", "", "", "", eur(d.resumen.gastosFijos ?? 0)]],
      theme: "plain",
      styles: { font: LETRA.texto, fontSize: 7.4, textColor: TINTA, cellPadding: 1.6 },
      headStyles: { fillColor: NOCHE, textColor: BLANCO, fontStyle: "bold", fontSize: 7 },
      footStyles: { fillColor: FONDO_NARANJA, fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: FONDO },
      columnStyles: {
        0: { cellWidth: 46, fontStyle: "bold" },
        1: { cellWidth: 36, textColor: GRIS },
        2: { cellWidth: 28, halign: "right" },
        3: { cellWidth: 34 },
        4: { cellWidth: 12, halign: "center" },
        5: { halign: "right", fontStyle: "bold" },
      },
      didParseCell: (h) => {
        if (h.column.index === 5) h.cell.styles.halign = "right";
        if (h.section === "head" && h.column.index === 4) h.cell.styles.halign = "center";
      },
      didDrawPage: () => {
        if (doc.getCurrentPageInfo().pageNumber > inicio) {
          const y = c.y;
          c.cabeceraInterior("Gastos del periodo");
          c.y = y;
        }
      },
    });
    c.y = finTabla(doc) + 5;
  }

  // Dónde se corrige cada cosa.
  const ayudas: [string, string][] = [
    ["Un gasto fijo (importe, fechas, periodicidad)", "Gerencia › Ajustes › Gastos fijos"],
    ["Una factura de compra o una amortización", "Facturas de compra"],
    ["El coste por metro de producción", "Configuración de la empresa"],
    ["Lo que cobró la agencia por un envío", "En el envío de cada pedido"],
  ];
  c.sitio(10 + ayudas.length * 5, "Gastos del periodo");
  c.relleno(FONDO_CIELO);
  doc.roundedRect(M, c.y, ANCHO, 8 + ayudas.length * 4.6, 1.8, 1.8, "F");
  c.letra("negrita", 7, CIELO);
  c.texto("SI ALGO NO CUADRA, SE CORRIGE EN LA APLICACIÓN", M + 4, c.y + 5);
  ayudas.forEach(([que, donde], i) => {
    const y = c.y + 9.6 + i * 4.6;
    c.letra("texto", 7.5, TINTA);
    c.texto(que, M + 4, y);
    c.letra("negrita", 7.5, MARINO);
    c.texto(donde, W - M - 4, y, "right");
  });
  c.y += 14 + ayudas.length * 4.6;
  const conFactura = (d.gastos ?? []).filter((x) => (x.gasto.facturas?.length ?? 0) > 0);
  if (conFactura.length) {
    c.letra("texto", 6.8, GRIS);
    c.texto(
      `${conFactura.length} ${conFactura.length === 1 ? "gasto cuenta" : "gastos cuentan"} lo de su factura real en vez del importe previsto.`,
      M,
      c.y - 4,
    );
  }
}

// ---------------------------------------------------------------------------
// El almacén textil
// ---------------------------------------------------------------------------

/** Un ✓ en un círculo verde o un ✗ en uno rojo, dibujados (la letra no los tiene). */
function marca(c: Lienzo, ok: boolean, x: number, y: number) {
  const { doc } = c;
  c.relleno(ok ? VERDE : ROJO);
  doc.circle(x, y, 1.9, "F");
  doc.setDrawColor(...BLANCO);
  doc.setLineWidth(0.45);
  if (ok) {
    doc.line(x - 0.95, y, x - 0.25, y + 0.75);
    doc.line(x - 0.25, y + 0.75, x + 1, y - 0.8);
  } else {
    doc.line(x - 0.8, y - 0.8, x + 0.8, y + 0.8);
    doc.line(x - 0.8, y + 0.8, x + 0.8, y - 0.8);
  }
  doc.setLineWidth(0.2);
}

/** Si todas las partidas de la cuenta están a cero: no hay nada que contar. */
function cuentaVacia(a: InformeAlmacen): boolean {
  const k = a.cuenta;
  return [
    k.inicial,
    k.compras,
    k.altas,
    k.devolucionesCliente,
    k.ventas,
    k.mermas,
    k.devolucionesProveedor,
    k.ajustes,
    k.final,
  ].every((p) => p.unidades === 0 && p.valor === 0);
}

function almacen(c: Lienzo, autoTable: AutoTable) {
  const { doc, d } = c;
  const a = d.almacen;
  c.seccion("Cuenta del almacén textil", "Unidades y valor a precio de compra, sin IVA");
  if (!a) {
    c.letra("texto", 8.5, GRIS);
    c.texto("Sin datos del almacén para este periodo.", M, c.y);
    c.y += 8;
    return;
  }

  const k = a.cuenta;
  if (cuentaVacia(a)) {
    c.letra("texto", 8.5, GRIS);
    c.texto("Sin datos del almacén para este periodo.", M, c.y);
    c.y += 8;
  } else {
    const uds = (p: Partida) => numero(p.unidades, 0);
    const filas: [string, Partida][] = [
      [`Existencias al ${fechaCorta(k.desde)}`, k.inicial],
      ["+ Compras", k.compras],
      ["+ Altas con existencias", k.altas],
      ["+ Devoluciones de clientes", k.devolucionesCliente],
      ["− Coste de lo vendido", k.ventas],
      ["− Mermas", k.mermas],
      ["− Devoluciones a proveedores", k.devolucionesProveedor],
      ["± Ajustes de inventario", k.ajustes],
    ];
    autoTable(doc, {
      startY: c.y,
      margin: { left: M, right: M, top: 30, bottom: H - LIMITE },
      head: [["", "Unidades", "Valor"]],
      body: filas.map(([etiqueta, p]) => [etiqueta, uds(p), eur(p.valor)]),
      foot: [[`= Existencias al ${fechaCorta(k.hasta)}`, uds(k.final), eur(k.final.valor)]],
      theme: "plain",
      styles: { font: LETRA.texto, fontSize: 8.2, textColor: TINTA, cellPadding: 1.9 },
      headStyles: {
        fillColor: NOCHE,
        textColor: BLANCO,
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "right",
      },
      footStyles: { fillColor: FONDO_NARANJA, fontStyle: "bold", fontSize: 9, halign: "right" },
      alternateRowStyles: { fillColor: FONDO },
      columnStyles: {
        0: { cellWidth: 100, halign: "left" },
        1: { halign: "right", font: LETRA.cifras },
        2: { halign: "right", font: LETRA.cifras },
      },
      didParseCell: (h) => {
        if (h.column.index === 0) h.cell.styles.halign = "left";
        // La primera fila (lo que había) va en negrita, como el total.
        if (h.section === "body" && h.row.index === 0) {
          h.cell.styles.font = LETRA.texto;
          h.cell.styles.fontStyle = "bold";
        }
      },
    });
    c.y = finTabla(doc) + 3;
    const descuadre = Math.abs(k.descuadre.valor) >= 0.005 || k.descuadre.unidades !== 0;
    if (descuadre) {
      c.letra("negrita", 7.5, ROJO);
      c.texto(
        `La cuenta no cierra: descuadre de ${numero(k.descuadre.unidades, 0)} unidades y ${eur(k.descuadre.valor)}.`,
        M,
        c.y + 2,
      );
      c.y += 5;
    }
    c.letra("texto", 6.8, GRIS);
    (doc.splitTextToSize(DEFINICIONES.g_almacen_cuenta.fuente, ANCHO) as string[]).forEach((l) => {
      c.texto(l, M, c.y + 2);
      c.y += 3.4;
    });
    c.y += 5;
  }

  // Tres cifras: lo que vale hoy, lo que se perdió y lo que se debe.
  const alto = 26;
  c.sitio(alto + 6, "Almacén");
  const w = (ANCHO - 2 * 4) / 3;
  const tarjetas: Tarjeta[] = [
    {
      etiqueta: "Valor del almacén hoy",
      valor: a.valorHoy === null ? "—" : eur(a.valorHoy),
      pie: "Unidades × coste medio guardados",
      color: CIELO,
      v: null,
      sinVariacion: true,
    },
    {
      etiqueta: "Mermas y ajustes del periodo",
      valor: eur(k.perdidas),
      pie: "En Resultados (A), no en el Beneficio",
      color: NARANJA,
      v: null,
      rojo: k.perdidas > 0,
      sinVariacion: true,
    },
    {
      etiqueta: "Debido a proveedores hoy",
      valor: a.pagosProveedores ? eur(a.pagosProveedores.total) : "—",
      pie: a.pagosProveedores
        ? `${plural(a.pagosProveedores.facturas, "factura", "facturas")} pendientes de pago`
        : "No se han podido leer",
      color: MARINO,
      v: null,
      sinVariacion: true,
    },
  ];
  const y0 = c.y;
  tarjetas.forEach((t, i) => tarjeta(c, t, M + i * (w + 4), y0, w, alto));
  c.y = y0 + alto + 5;
  // El «Beneficio» de este informe es margen menos gastos fijos: no resta las
  // mermas y ajustes (ni las compras ni las amortizaciones). Gerencia ›
  // Resultados sí. Se dice para que nadie compare las dos cifras sin saberlo.
  c.sitio(12, "Almacén");
  c.letra("texto", 6.8, GRIS);
  (
    doc.splitTextToSize(
      "Las mermas y ajustes restan en Gerencia › Resultados (grupo A). El «Beneficio» de este informe es el margen menos los gastos fijos: no las resta, como tampoco resta las compras ni las amortizaciones, así que puede ser mayor que el de Resultados.",
      ANCHO,
    ) as string[]
  ).forEach((l) => {
    c.texto(l, M, c.y);
    c.y += 3.4;
  });
  c.y += 5;

  // Los controles: tienen que dar 0.
  c.sitio(48, "Almacén");
  c.seccion("Controles del almacén", "Tienen que dar 0");
  const r = a.controles;
  if (!r) {
    c.letra("texto", 8.5, GRIS);
    c.texto("No se han podido comprobar.", M, c.y);
    c.y += 8;
    return;
  }
  const lineas: [string, string | null, boolean, string?][] = [
    [
      "Compras textil frente a sus entradas en el stock",
      r.comprasConDescuadre === 0
        ? eur(r.diferenciaCompras)
        : `${eur(r.diferenciaCompras)} · ${plural(r.comprasConDescuadre, "compra", "compras")} con descuadre`,
      r.comprasConDescuadre === 0 && Math.abs(r.diferenciaCompras) < 0.005,
      r.comprasSinEnlace > 0
        ? `${plural(r.comprasSinEnlace, "anterior", "anteriores")} al enlace, sin comprobar`
        : undefined,
    ],
    [
      "Variantes descuadradas",
      r.variantesDescuadradas === null ? null : numero(r.variantesDescuadradas, 0),
      r.variantesDescuadradas === 0,
    ],
    [
      "Reservas descuadradas",
      r.reservasDescuadradas === null ? null : numero(r.reservasDescuadradas, 0),
      r.reservasDescuadradas === 0,
    ],
  ];
  c.relleno(FONDO);
  doc.roundedRect(M, c.y - 4.5, ANCHO, lineas.length * 6.4 + 3, 1.8, 1.8, "F");
  for (const [etiqueta, valor, enCero, nota] of lineas) {
    if (valor !== null) marca(c, enCero, M + 5, c.y - 1.2);
    c.letra("texto", 8, TINTA);
    c.texto(etiqueta, M + 9, c.y);
    if (nota) {
      const ancho = doc.getTextWidth(etiqueta);
      c.letra("texto", 6.5, GRIS);
      c.texto(nota, M + 9 + ancho + 2, c.y);
    }
    if (valor === null) {
      c.letra("texto", 8, GRIS);
      c.texto("No comprobado", W - M - 4, c.y, "right");
    } else {
      c.letra(enCero ? "cifras" : "negrita", 8.2, enCero ? TINTA : ROJO);
      c.texto(valor, W - M - 4, c.y, "right");
    }
    c.y += 6.4;
  }
  c.y += 3;
  c.letra("texto", 6.8, GRIS);
  const informativa =
    `Valor según la caché − valor según el libro: ${
      r.diferenciaValorCache === null ? "—" : eur(r.diferenciaValorCache)
    }. Informativo, no cuenta como control: con el coste medio solo lo mueven los redondeos y las variantes que llegaron a quedar en negativo.` +
    (r.todoEnCero
      ? ""
      : " Si algún control no da 0, hay que mirarlo antes de fiarse de las cifras del almacén.");
  (doc.splitTextToSize(informativa, ANCHO) as string[]).forEach((l) => {
    c.texto(l, M, c.y + 2);
    c.y += 3.4;
  });
  c.y += 4;
}

// ---------------------------------------------------------------------------
// Página 3: cada negocio
// ---------------------------------------------------------------------------

function ficha(c: Lienzo, n: CifrasNegocio, x: number, y: number, w: number, h: number) {
  const { doc, d } = c;
  const color = colorNegocio(n.id, d.colores);
  const x2 = ratiosDe(n);
  c.relleno(FONDO);
  doc.roundedRect(x, y, w, h, 1.8, 1.8, "F");
  c.relleno(color);
  doc.roundedRect(x, y, w, 10, 1.8, 1.8, "F");
  doc.rect(x, y + 6, w, 4, "F");
  c.ajustado(n.nombre.toUpperCase(), "titular", 11.5, w - 40, BLANCO);
  c.texto(n.nombre.toUpperCase(), x + 4, y + 7);
  c.letra("negrita", 7.5, BLANCO);
  c.texto(plural(n.pedido.pedidos, "pedido", "pedidos"), x + w - 4, y + 6.6, "right");

  // Las tres cifras grandes
  const tres: [string, string, boolean][] = [
    ["Vendido", eur(n.pedido.vendido), false],
    ["Cobrado", eur(n.cobrado), false],
    ["Margen neto", eur(n.pedido.margenConEnvios), n.pedido.margenConEnvios < 0],
  ];
  const wc = (w - 8) / 3;
  tres.forEach(([et, val, rojo], i) => {
    const cx = x + 4 + i * wc;
    c.letra("negrita", 6, GRIS);
    c.texto(et.toUpperCase(), cx, y + 15.5);
    c.ajustado(val, "titular", 12, wc - 2, rojo ? ROJO : TINTA);
    c.texto(val, cx, y + 21.5);
  });

  c.y = y + 28.5;
  const ww = w - 8;
  fila(
    c,
    "Metros pedidos · hechos",
    `${metros(n.pedido.metros)} · ${metros(n.realizado.metrosImpresos)}`,
    x + 4,
    ww,
  );
  fila(c, "Facturado (sin IVA)", eur(n.facturado), x + 4, ww);
  fila(c, "Margen sin envíos", eur(n.pedido.margenSinEnvios), x + 4, ww, {
    rojo: n.pedido.margenSinEnvios < 0,
    nota: x2.margenSinEnvios != null ? porcentaje(x2.margenSinEnvios) : undefined,
  });
  fila(
    c,
    "Resultado de los envíos",
    `${signo(n.pedido.resultadoEnvios)}${eur(Math.abs(n.pedido.resultadoEnvios))}`,
    x + 4,
    ww,
    { rojo: n.pedido.resultadoEnvios < 0 },
  );
  fila(c, "Por cobrar de lo vendido", eur(n.pedido.pendiente), x + 4, ww, {
    rojo: n.pedido.pendiente > 0,
  });
  fila(
    c,
    "Precio medio del metro",
    n.pedido.euroMetro == null ? "—" : eur(n.pedido.euroMetro),
    x + 4,
    ww,
  );
  fila(c, "En cola al cerrar", `${n.cola.pedidos} · ${metros(n.cola.metros)}`, x + 4, ww);
}

function fichas(c: Lienzo) {
  const { d } = c;
  const lista = d.resumen.negocios;
  if (lista.length === 0) return;
  const wCol = (ANCHO - 6) / 2;
  const h = 66;
  c.seccion("La ficha de cada negocio");
  for (let i = 0; i < lista.length; i += 2) {
    c.sitio(h + 6, "Cada negocio");
    const y = c.y;
    ficha(c, lista[i], M, y, wCol, h);
    if (lista[i + 1]) ficha(c, lista[i + 1], M + wCol + 6, y, wCol, h);
    c.y = y + h + 6;
  }
}

function comoLeer(c: Lienzo) {
  const { doc } = c;
  const lista: [string, string][] = [
    [
      "Pedido y realizado",
      "«Pedido» es lo que entró en el periodo; «realizado», lo que se terminó (pasó a enviado) en él, fuera del día que fuera su pedido. Un pedido que entra después de la hora de corte se hace al día siguiente.",
    ],
    ["Margen neto", DEFINICIONES.rd_margen_neto.calculo],
    ["Margen sin envíos", DEFINICIONES.rd_margen_sin_envios.calculo],
    ["Facturado", DEFINICIONES.rd_facturado.calculo],
    ["Cobrado", DEFINICIONES.rd_cobrado.calculo],
    ["Uso de la máquina", DEFINICIONES.rd_capacidad.calculo],
    [
      "Beneficio",
      "Margen neto menos los gastos fijos que tocan al periodo (alquiler, sueldos, cuotas…), repartidos por días. Antes de impuestos.",
    ],
  ];
  const wCol = (ANCHO - 8) / 2;
  c.letra("texto", 6.8);
  const bloques = lista.map(([t, x]) => ({ t, lineas: doc.splitTextToSize(x, wCol) as string[] }));
  const altoCol = (b: typeof bloques) => b.reduce((s, x) => s + 4 + x.lineas.length * 3 + 2, 0);
  const mitad = Math.ceil(bloques.length / 2);
  const alto = Math.max(altoCol(bloques.slice(0, mitad)), altoCol(bloques.slice(mitad)));
  c.sitio(alto + 12, "Cada negocio");
  c.seccion("Cómo leer este informe");
  const y0 = c.y;
  [bloques.slice(0, mitad), bloques.slice(mitad)].forEach((col, k) => {
    let y = y0;
    const x = M + k * (wCol + 8);
    for (const b of col) {
      c.letra("negrita", 7.2, MARINO);
      c.texto(b.t, x, y);
      c.letra("texto", 6.8, GRIS);
      b.lineas.forEach((l, i) => c.texto(l, x, y + 3.6 + i * 3));
      y += 4 + b.lineas.length * 3 + 2;
    }
  });
  c.y = y0 + alto + 4;
}

// ---------------------------------------------------------------------------
// El documento
// ---------------------------------------------------------------------------

type AutoTable = (typeof import("jspdf-autotable"))["default"];

const finTabla = (doc: jsPDF) =>
  (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

function pies(c: Lienzo) {
  const { doc, d } = c;
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA);
    doc.setLineWidth(0.3);
    doc.line(M, H - 12, W - M, H - 12);
    c.letra("texto", 6.8, GRIS);
    c.texto(
      `${d.empresa.razon_social}${d.empresa.cif ? ` · CIF ${d.empresa.cif}` : ""} · Confidencial: solo para los socios`,
      M,
      H - 7.5,
    );
    c.letra("negrita", 6.8, MARINO);
    c.texto(`Página ${i} de ${total}`, W - M, H - 7.5, "right");
  }
}

/** El informe de los socios, en PDF. */
export async function generarInformeSocios(d: DatosInformeSocios): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await registrarFuentesPdf(doc);
  doc.setProperties({
    title: `Informe para los socios · ${d.periodo}`,
    subject: "Resumen de actividad",
    author: d.empresa.razon_social,
  });
  const c = new Lienzo(doc, d);

  // Página 1
  portada(c);
  enUnaFrase(c);
  c.seccion("Lo esencial", d.frente ? `Variación frente a ${d.frente}` : undefined);
  cifrasClave(c);
  porNegocio(c);
  avisosYResultado(c);

  // Página 2
  doc.addPage();
  c.cabeceraInterior("Cuenta del periodo");
  await cuentaDelPeriodo(c, autoTable);
  maquinaYCobros(c);
  evolucion(c, autoTable);

  // Los gastos
  doc.addPage();
  c.cabeceraInterior("Gastos del periodo");
  const inicioGastos = doc.getNumberOfPages();
  gastosDelPeriodo(c, autoTable, inicioGastos);

  // El almacén textil
  doc.addPage();
  c.cabeceraInterior("Almacén");
  almacen(c, autoTable);

  // Cada negocio
  doc.addPage();
  c.cabeceraInterior("Cada negocio");
  fichas(c);
  comoLeer(c);

  pies(c);
  return doc.output("blob");
}
