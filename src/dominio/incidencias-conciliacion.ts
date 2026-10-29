/**
 * Lo que hay que resolver en la conciliación, con el porqué y qué hacer.
 *
 * Junta en una lista lo que la conciliación sabe que está mal o a medias:
 * extractos que no cuadran, recibos de tarjeta que no cuadran, movimientos
 * que parecen repetidos, enlaces con diferencia o cobrados en parte,
 * movimientos sin factura, facturas sin movimiento en el banco y propuestas
 * que esperan confirmación. Cada una con su gravedad: «error» es algo que
 * está mal; «aviso», algo pendiente.
 *
 * Lógica pura: los datos los trae el servidor y la pantalla los pinta.
 */
import { normalizar } from "./conciliacion";
import { pendienteDeEnlace, sentidoDe } from "./conciliar-a-mano";
import { DIAS_DESPUES, diasEntre, type Documento, type Plan } from "./motor-conciliacion";

/** Días que se deja a un movimiento sin factura antes de avisar: lo normal es registrarla en esos días. */
export const DIAS_SIN_FACTURA = 3;

/**
 * Días tras la fecha de una factura sin movimiento en el banco para avisar:
 * los mismos que mira el motor. Pasado eso, el motor ya no la propone sola.
 */
export const DIAS_SIN_BANCO = DIAS_DESPUES;

/** Cuántas facturas sin movimiento se enumeran; del resto se dice cuántas son. */
export const MAX_DOCUMENTOS = 30;

export type TipoIncidencia =
  | "extracto"
  | "recibo_tarjeta"
  | "repetido"
  | "diferencia"
  | "parcial"
  | "cobros_sin_factura"
  | "pagos_sin_factura"
  | "documento_sin_banco"
  | "documentos_sin_banco_mas"
  | "por_revisar";

/**
 * Una cosa por resolver. Los textos los pone la pantalla, con los importes
 * formateados (src/lib/format.ts); aquí van los datos.
 */
export type Incidencia = {
  clave: string;
  tipo: TipoIncidencia;
  gravedad: "error" | "aviso";
  /** Lo que se nombra: el fichero, la cuenta, el concepto o el documento. */
  nombre: string;
  /** Cuántos: movimientos repetidos o sin factura, propuestas, facturas de más. */
  n: number;
  /** Lo que falta o sobra (extracto, recibo, enlace), o lo que queda por cobrar o pagar. */
  diferencia: number | null;
  /** Días sin movimiento en el banco. */
  dias: number | null;
  fecha: string | null;
  importe: number | null;
  /** Lo que necesita el botón para resolverlo. */
  ref: {
    movimientos?: string[];
    grupo?: string;
    documento?: { tipo: Documento["tipo"]; id: string };
    extracto?: string;
    /** Para filtrar la lista de movimientos por un importe. */
    importe?: number;
  };
};

type Mov = {
  id: string;
  fecha: string;
  concepto: string;
  importe: number;
  cuenta_id: string | null;
};

export type DatosIncidencias = {
  /** Hoy, AAAA-MM-DD. */
  hoy: string;
  /** Los movimientos sin conciliar. */
  movimientos: Mov[];
  /** El plan del motor para ellos. */
  plan: Plan;
  /** Los documentos por conciliar. */
  documentos: (Documento & { clase?: string })[];
  /** Cuántos enlaces esperan confirmación. */
  porRevisar: number;
  /** Enlaces con diferencia de importe. */
  diferencias: {
    grupo: string;
    diferencia: number;
    movimientos: Mov[];
    documentos: (Documento & { clase?: string })[];
  }[];
  /** Recibos de tarjeta que no cuadran con las compras. */
  recibos: { id: string; fecha: string; importe: number; diferencia: number; cuenta: string }[];
  extractos: {
    id: string;
    fichero: string;
    desde: string | null;
    hasta: string | null;
    saldo_inicial: number | null;
    saldo_final: number | null;
    suma_movimientos: number;
    cuadra: boolean;
  }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const nombreDoc = (d: Documento & { clase?: string }) =>
  [d.clase, d.contraparte, d.referencia].filter(Boolean).join(" · ") || "Documento";

/**
 * Movimientos que parecen el mismo dos veces: misma cuenta, misma fecha,
 * mismo importe y mismo concepto. Suele ser el mismo extracto subido en dos
 * formatos (la huella no los reconoce como iguales).
 */
export function movimientosRepetidos(movs: Mov[]): Mov[][] {
  const grupos = new Map<string, Mov[]>();
  for (const m of movs) {
    const k = [m.cuenta_id ?? "", m.fecha.slice(0, 10), r2(m.importe), normalizar(m.concepto)].join(
      "|",
    );
    grupos.set(k, [...(grupos.get(k) ?? []), m]);
  }
  return [...grupos.values()].filter((g) => g.length > 1);
}

export function incidenciasConciliacion(d: DatosIncidencias): Incidencia[] {
  const lista: Incidencia[] = [];
  const base = { n: 1, diferencia: null, dias: null } as const;

  // Extractos con los dos saldos que no cuadran: falta o sobra algún movimiento.
  for (const e of d.extractos) {
    if (e.cuadra || e.saldo_inicial === null || e.saldo_final === null) continue;
    lista.push({
      ...base,
      clave: `extracto:${e.id}`,
      tipo: "extracto",
      gravedad: "error",
      nombre: e.fichero,
      diferencia: r2(e.saldo_final - e.saldo_inicial - e.suma_movimientos),
      fecha: e.hasta,
      importe: null,
      ref: { extracto: e.id },
    });
  }

  for (const r of d.recibos) {
    lista.push({
      ...base,
      clave: `recibo:${r.id}`,
      tipo: "recibo_tarjeta",
      gravedad: "error",
      nombre: r.cuenta,
      diferencia: r.diferencia,
      fecha: r.fecha,
      importe: r.importe,
      ref: { movimientos: [r.id] },
    });
  }

  for (const g of movimientosRepetidos(d.movimientos)) {
    const m = g[0];
    lista.push({
      ...base,
      clave: `repetido:${g.map((x) => x.id).join(",")}`,
      tipo: "repetido",
      gravedad: "error",
      nombre: m.concepto,
      n: g.length,
      fecha: m.fecha,
      importe: m.importe,
      ref: { movimientos: g.map((x) => x.id), importe: m.importe },
    });
  }

  for (const e of d.diferencias) {
    const doc = e.documentos.length === 1 ? e.documentos[0] : null;
    const falta = doc ? pendienteDeEnlace(doc.esperado, e.diferencia) : null;
    const fecha =
      e.movimientos
        .map((m) => m.fecha)
        .sort()
        .at(-1) ?? null;
    lista.push({
      ...base,
      clave: `${falta !== null ? "parcial" : "diferencia"}:${e.grupo}`,
      tipo: falta !== null ? "parcial" : "diferencia",
      gravedad: "aviso",
      nombre: e.documentos.map(nombreDoc).join(", "),
      diferencia: falta ?? e.diferencia,
      fecha,
      importe: falta,
      ref: { grupo: e.grupo, ...(falta !== null ? { importe: falta } : {}) },
    });
  }

  // Movimientos de hace días sin factura propuesta (ni traspaso).
  const conPropuesta = new Set<string>();
  for (const e of [...d.plan.verdes, ...d.plan.ambares]) {
    for (const id of e.movimientos) conPropuesta.add(id);
  }
  for (const t of d.plan.traspasos) {
    conPropuesta.add(t.a);
    conPropuesta.add(t.b);
  }
  const sinFactura = d.movimientos.filter(
    (m) => !conPropuesta.has(m.id) && diasEntre(m.fecha, d.hoy) >= DIAS_SIN_FACTURA,
  );
  for (const sentido of ["cobro", "pago"] as const) {
    const movs = sinFactura.filter((m) => sentidoDe(m.importe) === sentido);
    if (movs.length === 0) continue;
    lista.push({
      ...base,
      clave: `${sentido}s_sin_factura`,
      tipo: sentido === "cobro" ? "cobros_sin_factura" : "pagos_sin_factura",
      gravedad: "aviso",
      nombre: "",
      n: movs.length,
      fecha:
        movs
          .map((m) => m.fecha)
          .sort()
          .at(-1) ?? null,
      importe: r2(movs.reduce((s, m) => s + m.importe, 0)),
      ref: { movimientos: movs.map((m) => m.id) },
    });
  }

  // Facturas que siguen sin movimiento pasado el plazo del motor.
  const viejas = d.documentos
    .filter((doc) => diasEntre(doc.fecha, d.hoy) > DIAS_SIN_BANCO)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const doc of viejas.slice(0, MAX_DOCUMENTOS)) {
    lista.push({
      ...base,
      clave: `documento:${doc.tipo}:${doc.id}`,
      tipo: "documento_sin_banco",
      gravedad: "aviso",
      nombre: nombreDoc(doc),
      dias: diasEntre(doc.fecha, d.hoy),
      fecha: doc.fecha,
      importe: doc.esperado,
      ref: { documento: { tipo: doc.tipo, id: doc.id }, importe: doc.esperado },
    });
  }
  if (viejas.length > MAX_DOCUMENTOS) {
    lista.push({
      ...base,
      clave: "documentos_sin_banco_mas",
      tipo: "documentos_sin_banco_mas",
      gravedad: "aviso",
      nombre: "",
      n: viejas.length - MAX_DOCUMENTOS,
      fecha: null,
      importe: null,
      ref: {},
    });
  }

  if (d.porRevisar > 0) {
    lista.push({
      ...base,
      clave: "por_revisar",
      tipo: "por_revisar",
      gravedad: "aviso",
      nombre: "",
      n: d.porRevisar,
      fecha: null,
      importe: null,
      ref: {},
    });
  }

  const peso = { error: 0, aviso: 1 };
  return lista.sort(
    (a, b) =>
      peso[a.gravedad] - peso[b.gravedad] ||
      String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")),
  );
}
