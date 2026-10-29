/**
 * Conciliar a mano: buscar documentos, ordenarlos por lo más probable,
 * comprobar lo que se ha marcado antes de enlazar y filtrar los movimientos
 * pendientes por cobros y pagos.
 *
 * Sin base de datos: el servidor (src/lib/conciliacion.functions.ts) lee y la
 * pantalla (MotorConciliacion) pinta; las reglas viven aquí.
 */
import { criterioBusqueda, normalizar } from "./conciliacion";
import { coincideImporte, diasEntre, type Documento } from "./motor-conciliacion";

/** Un cobro entra en el banco (abono); un pago sale (cargo). */
export type Sentido = "cobro" | "pago";

export function sentidoDe(importe: number): Sentido {
  return importe < 0 ? "pago" : "cobro";
}

const redondear = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

/** Las palabras de lo que se busca, comparables: sin acentos ni signos, sin repetir. */
export function palabrasDeBusqueda(texto: string): string[] {
  return [...new Set(normalizar(texto).split(" "))].filter((p) => p.length >= 2);
}

/**
 * El patrón para un `ilike` de la base que encuentra la palabra aunque lleve
 * acentos o eñes: «garcia» encuentra «García». Las vocales y la ene pasan a
 * `_` (un carácter cualquiera), así que el patrón trae de más; lo que sobra lo
 * quita después `coincideConPalabras`.
 */
export function patronIlike(palabra: string): string {
  return palabra.replace(/[aeioun]/g, "_");
}

/** ¿Están todas las palabras en el nombre, el NIF o el número del documento? */
export function coincideConPalabras(
  doc: Pick<Documento, "contraparte" | "nif" | "referencia">,
  palabras: string[],
): boolean {
  const texto = normalizar([doc.contraparte, doc.nif, doc.referencia].filter(Boolean).join(" "));
  const junto = texto.replace(/ /g, "");
  return palabras.every((p) => texto.includes(p) || junto.includes(p));
}

/**
 * Margen de un importe buscado: se encuentra lo que está a un euro o menos.
 * Así sale la factura aunque el banco haya cobrado una comisión o se haya
 * tecleado mal un céntimo; las que casan al céntimo van primero.
 */
export const MARGEN_IMPORTE = 1;

/** ¿El importe del documento (o lo que le queda) está cerca del buscado? */
export function cercaDelImporte(buscado: number, doc: DocumentoBuscado): boolean {
  return Math.abs(Math.abs(queda(doc)) - Math.abs(buscado)) <= MARGEN_IMPORTE + 1e-9;
}

/** Lo que se ha escrito en el buscador, ya interpretado. */
export type Busqueda = {
  palabras: string[];
  importe: number | null;
  numero: number | null;
};

export function interpretarBusqueda(texto: string): Busqueda {
  const c = criterioBusqueda(texto);
  return {
    palabras: c.texto ? palabrasDeBusqueda(c.texto) : [],
    importe: c.importe,
    numero: c.numero,
  };
}

/**
 * ¿Sirve el documento para lo buscado? Con palabras, tienen que estar todas;
 * con un importe, tiene que estar cerca; con un entero (importe o número de
 * factura), vale cualquiera de las dos cosas.
 */
export function cumpleBusqueda(doc: DocumentoBuscado, b: Busqueda): boolean {
  if (b.palabras.length > 0) return coincideConPalabras(doc, b.palabras);
  const porImporte = b.importe !== null && cercaDelImporte(b.importe, doc);
  const porNumero =
    b.numero !== null && (doc.referencia ?? "").replace(/\D/g, "").endsWith(String(b.numero));
  return porImporte || porNumero;
}

// ---------------------------------------------------------------------------
// Cobros y pagos en parte
// ---------------------------------------------------------------------------

/**
 * Una factura ya enlazada que todavía no está pagada del todo: lo que se ha
 * pagado (con signo, como el banco) y lo que falta.
 */
export type Parcial = { grupo: string; pagado: number; pendiente: number };

/** Un documento tal como lo devuelve el buscador: puede estar cobrado en parte. */
export type DocumentoBuscado = Documento & { parcial?: Parcial };

/** Lo que el banco tiene que traer todavía para este documento. */
export function queda(doc: DocumentoBuscado): number {
  return doc.parcial ? doc.parcial.pendiente : doc.esperado;
}

/**
 * Lo que falta de un documento enlazado él solo con uno o varios movimientos.
 * `diferencia` es la del enlace (banco − documento). Falta algo si el banco
 * se quedó corto, en el mismo sentido que el documento; si sobra, o cuadra,
 * no hay nada pendiente (nulo).
 */
export function pendienteDeEnlace(esperado: number, diferencia: number): number | null {
  const pendiente = redondear(-diferencia);
  if (pendiente === 0 || Math.sign(pendiente) !== Math.sign(esperado)) return null;
  if (Math.abs(pendiente) >= Math.abs(esperado)) return null;
  return pendiente;
}

// ---------------------------------------------------------------------------
// Orden: lo más probable primero
// ---------------------------------------------------------------------------

/**
 * Ordena lo encontrado para el movimiento que se concilia: primero lo que
 * casa al céntimo con lo que le queda, luego lo más cercano en importe y,
 * a igualdad, lo más cercano en fecha. Sin movimiento, lo más reciente
 * primero.
 */
export function ordenarCandidatos<T extends DocumentoBuscado>(
  docs: T[],
  objetivo: { importe: number; fecha: string } | null,
): T[] {
  const reciente = (a: T, b: T) => String(b.fecha).localeCompare(String(a.fecha));
  if (!objetivo) return [...docs].sort(reciente);
  const clave = (d: T) => ({
    exacto: coincideImporte(objetivo.importe, queda(d)) ? 0 : 1,
    distancia: Math.abs(Math.abs(objetivo.importe) - Math.abs(queda(d))),
    dias: Math.abs(diasEntre(d.fecha, objetivo.fecha)),
  });
  return [...docs].sort((a, b) => {
    const x = clave(a);
    const y = clave(b);
    return x.exacto - y.exacto || x.distancia - y.distancia || x.dias - y.dias || reciente(a, b);
  });
}

// ---------------------------------------------------------------------------
// Lo marcado, antes de enlazar
// ---------------------------------------------------------------------------

export type ResumenSeleccion = {
  sumaMovimientos: number;
  /** Con signo, como el banco; de una factura cobrada en parte, lo que le queda. */
  sumaDocumentos: number;
  /** Banco − documentos. Cero: cuadra. */
  diferencia: number;
  /** Por qué no se puede enlazar, para decírselo a la persona. Nulo si se puede. */
  error: string | null;
  /** Si es añadir un pago a una factura cobrada en parte: el enlace que se amplía. */
  ampliaGrupo: string | null;
};

/**
 * Comprueba lo marcado con las mismas reglas que la base
 * (banco_enlazar_como), para decirlo en pantalla antes de intentarlo.
 */
export function resumenSeleccion(
  movimientos: { importe: number }[],
  documentos: DocumentoBuscado[],
): ResumenSeleccion {
  const sumaMovimientos = redondear(movimientos.reduce((s, m) => s + m.importe, 0));
  const sumaDocumentos = redondear(documentos.reduce((s, d) => s + queda(d), 0));
  const base = {
    sumaMovimientos,
    sumaDocumentos,
    diferencia: redondear(sumaMovimientos - sumaDocumentos),
    ampliaGrupo: null as string | null,
  };
  const error = (mensaje: string): ResumenSeleccion => ({ ...base, error: mensaje });

  if (movimientos.length === 0) return error("Elige al menos un movimiento del banco.");
  const sentidos = new Set(movimientos.map((m) => sentidoDe(m.importe)));
  if (sentidos.size > 1) {
    return error("No se mezclan cobros y pagos en un mismo enlace: márcalos por separado.");
  }
  if (documentos.length === 0) return error("Marca la factura o facturas que paga.");
  const sentido = [...sentidos][0];
  if (documentos.some((d) => sentidoDe(d.esperado) !== sentido)) {
    return error(
      sentido === "cobro"
        ? "Un cobro se concilia con facturas o tickets emitidos, no con facturas recibidas."
        : "Un pago se concilia con facturas recibidas, no con facturas emitidas.",
    );
  }
  if (movimientos.length > 1 && documentos.length > 1) {
    return error(
      "Varios movimientos contra varias facturas no se enlazan de una vez: deja una sola factura, o enlázalos por partes.",
    );
  }
  const parciales = documentos.filter((d) => d.parcial);
  if (parciales.length > 0 && documentos.length > 1) {
    return error("Para añadir un pago a una factura cobrada en parte, márcala a ella sola.");
  }
  return { ...base, error: null, ampliaGrupo: parciales[0]?.parcial?.grupo ?? null };
}

// ---------------------------------------------------------------------------
// Movimientos pendientes: filtros y totales
// ---------------------------------------------------------------------------

export type FiltroMovimientos = {
  sentido: "todo" | Sentido;
  /** Una cuenta, o null para todas. */
  cuenta: string | null;
  /** Concepto o importe («-40,48», «828,71»). */
  texto: string;
};

export const SIN_FILTRO: FiltroMovimientos = { sentido: "todo", cuenta: null, texto: "" };

export function filtrarMovimientos<
  T extends { importe: number; concepto: string; cuenta_id: string | null },
>(movs: T[], f: FiltroMovimientos): T[] {
  const b = interpretarBusqueda(f.texto);
  return movs.filter((m) => {
    if (f.sentido !== "todo" && sentidoDe(m.importe) !== f.sentido) return false;
    if (f.cuenta && m.cuenta_id !== f.cuenta) return false;
    if (b.palabras.length > 0) {
      const concepto = normalizar(m.concepto ?? "");
      return b.palabras.every((p) => concepto.includes(p));
    }
    if (b.importe !== null) {
      return Math.abs(Math.abs(m.importe) - b.importe) <= MARGEN_IMPORTE + 1e-9;
    }
    return true;
  });
}

export type TotalSentido = { n: number; total: number };

/** Cuántos cobros y pagos hay y cuánto suman (los pagos, en negativo). */
export function totalesPorSentido(movs: { importe: number }[]): Record<Sentido, TotalSentido> {
  const r = { cobro: { n: 0, total: 0 }, pago: { n: 0, total: 0 } };
  for (const m of movs) {
    const t = r[sentidoDe(m.importe)];
    t.n++;
    t.total = redondear(t.total + m.importe);
  }
  return r;
}
