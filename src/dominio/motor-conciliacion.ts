/**
 * Motor de conciliación: qué movimiento del banco paga qué documento.
 *
 * Reglas (las de la especificación, tal cual):
 *
 *   - El importe se compara contra lo que el documento ESPERA ver en el banco:
 *     en una factura recibida, su líquido (base + IVA − IRPF) y en negativo,
 *     porque sale dinero; en una emitida, su total, en positivo. Así un cargo
 *     solo puede casar con facturas recibidas y un abono con emitidas, sin
 *     regla aparte. Tolerancia: un céntimo.
 *   - Importe + contraparte + fecha → verde (conciliada).
 *   - Solo importe + fecha → ámbar (revisar). NUNCA verde: dos proveedores
 *     que cobran 49,99 € el mismo mes son dos candidatos igual de buenos.
 *   - Un movimiento que paga varias facturas, o una factura pagada en varios
 *     movimientos, cuando las cantidades suman → ámbar.
 *   - La fecha vale si el movimiento cae entre 5 días antes y 45 días después
 *     de la del documento.
 *   - Traspasos entre cuentas propias: importes espejo, cuentas distintas y a
 *     3 días o menos → se marcan y no pagan nada.
 *   - Las sugerencias de un movimiento no escriben nada: son todos los
 *     documentos con el mismo importe (±1 céntimo), ordenados por probabilidad.
 *
 * Lógica pura: sin base de datos, sin pantallas.
 */

import { contieneReferencia, mencionaCliente } from "./conciliacion";

/** Diferencia que se acepta entre banco y documento, en céntimos. */
export const TOLERANCIA_CENTIMOS = 1;
/** El movimiento puede ir hasta 5 días antes de la fecha del documento… */
export const DIAS_ANTES = 5;
/** …y hasta 45 días después. */
export const DIAS_DESPUES = 45;
/** Un traspaso entre cuentas propias tarda como mucho esto en llegar. */
export const DIAS_TRASPASO = 3;
/** Cuántos documentos (o movimientos) se prueban a sumar como mucho. */
export const MAX_SUMANDOS = 4;
/** Cuántos candidatos se miran para las sumas, los más cercanos en fecha. */
const MAX_CANDIDATOS_SUMA = 20;

export type TipoDocumento = "compra" | "factura" | "textil";

export type Movimiento = {
  id: string;
  fecha: string;
  concepto: string;
  /** Con signo: negativo es un cargo, positivo un abono. */
  importe: number;
  cuenta_id: string | null;
};

export type Documento = {
  tipo: TipoDocumento;
  id: string;
  fecha: string;
  /** Lo que se espera ver en el banco, con signo. Ver `esperadoDe`. */
  esperado: number;
  /** Proveedor o cliente. */
  contraparte: string | null;
  nif: string | null;
  /** Número de la factura. */
  referencia: string | null;
};

export type ComoSeReconoce = "nif" | "referencia" | "nombre";

export type MotivoEnlace =
  "contraparte" | "importe_fecha" | "varias_candidatas" | "suma_documentos" | "suma_movimientos";

export type Enlace = {
  movimientos: string[];
  documentos: { tipo: TipoDocumento; id: string }[];
  estado: "conciliada" | "revisar";
  motivo: MotivoEnlace;
  /** Banco − documentos, en euros. */
  diferencia: number;
};

export type Traspaso = { a: string; b: string; dias: number };

export type Plan = { verdes: Enlace[]; ambares: Enlace[]; traspasos: Traspaso[] };

export type Sugerencia = {
  documento: Documento;
  contraparte: ComoSeReconoce | null;
  enVentana: boolean;
  /** Días del movimiento respecto al documento (positivo: después). */
  dias: number;
};

export const ETIQUETA_MOTIVO: Record<MotivoEnlace | "manual", string> = {
  contraparte: "Importe, fecha y contraparte",
  importe_fecha: "Solo importe y fecha",
  varias_candidatas: "Varias facturas encajan igual",
  suma_documentos: "Paga varias facturas que suman",
  suma_movimientos: "Pagada en varios movimientos",
  manual: "Enlazada a mano",
};

/** Lo que una factura espera ver en el banco: −líquido si es recibida, +total si es emitida. */
export function esperadoDe(tipo: TipoDocumento, importe: number): number {
  return tipo === "compra" ? -importe : importe;
}

const centimos = (n: number) => Math.round(n * 100);

export function coincideImporte(banco: number, esperado: number): boolean {
  return Math.abs(centimos(banco) - centimos(esperado)) <= TOLERANCIA_CENTIMOS;
}

/** Días del movimiento respecto al documento: positivo si el movimiento es posterior. */
export function diasEntre(fechaDocumento: string, fechaMovimiento: string): number {
  return Math.round(
    (Date.parse(fechaMovimiento.slice(0, 10)) - Date.parse(fechaDocumento.slice(0, 10))) /
      86_400_000,
  );
}

export function enVentana(fechaDocumento: string, fechaMovimiento: string): boolean {
  const d = diasEntre(fechaDocumento, fechaMovimiento);
  return d >= -DIAS_ANTES && d <= DIAS_DESPUES;
}

const alfanumerico = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** ¿Se reconoce en el concepto a quién es el documento? Por NIF, número de factura o nombre. */
export function reconoceContraparte(concepto: string, doc: Documento): ComoSeReconoce | null {
  if (doc.nif) {
    const nif = alfanumerico(doc.nif);
    if (nif.length >= 8 && alfanumerico(concepto).includes(nif)) return "nif";
  }
  if (doc.referencia && contieneReferencia(concepto, doc.referencia)) return "referencia";
  if (mencionaCliente(concepto, doc.contraparte)) return "nombre";
  return null;
}

/**
 * Todos los documentos con el mismo importe que el movimiento (±1 céntimo),
 * los más probables primero: los que nombran a la contraparte, luego los que
 * caen en la ventana de fechas, luego por cercanía. No escribe nada.
 */
export function sugerencias(mov: Movimiento, docs: Documento[]): Sugerencia[] {
  return docs
    .filter((d) => coincideImporte(mov.importe, d.esperado))
    .map((d) => ({
      documento: d,
      contraparte: reconoceContraparte(mov.concepto, d),
      enVentana: enVentana(d.fecha, mov.fecha),
      dias: diasEntre(d.fecha, mov.fecha),
    }))
    .sort(
      (a, b) =>
        Number(b.contraparte !== null) - Number(a.contraparte !== null) ||
        Number(b.enVentana) - Number(a.enVentana) ||
        Math.abs(a.dias) - Math.abs(b.dias),
    );
}

/**
 * Parejas de movimientos espejo entre dos cuentas propias distintas, a
 * DIAS_TRASPASO días o menos. Cada movimiento, en un traspaso como mucho; si
 * hay varios espejos posibles, el más cercano en fecha.
 */
export function detectarTraspasos(movs: Movimiento[]): Traspaso[] {
  const parejas: Traspaso[] = [];
  for (const a of movs) {
    if (a.importe >= 0 || !a.cuenta_id) continue;
    for (const b of movs) {
      if (b.importe <= 0 || !b.cuenta_id || b.cuenta_id === a.cuenta_id) continue;
      if (centimos(a.importe) + centimos(b.importe) !== 0) continue;
      const dias = Math.abs(diasEntre(a.fecha, b.fecha));
      if (dias <= DIAS_TRASPASO) parejas.push({ a: a.id, b: b.id, dias });
    }
  }
  parejas.sort((x, y) => x.dias - y.dias);
  const usados = new Set<string>();
  return parejas.filter((p) => {
    if (usados.has(p.a) || usados.has(p.b)) return false;
    usados.add(p.a);
    usados.add(p.b);
    return true;
  });
}

/**
 * Busca entre `candidatos` de 2 a MAX_SUMANDOS cuyo importe sume `objetivo`
 * (±1 céntimo). Prueba primero las combinaciones más cortas y, a igualdad,
 * devuelve la que tiene más puntos según `puntos`.
 */
function buscarSuma<T>(
  objetivo: number,
  candidatos: T[],
  importe: (x: T) => number,
  puntos: (x: T) => number,
): T[] | null {
  const meta = Math.abs(centimos(objetivo));
  const lista = candidatos
    .map((x) => ({ x, c: Math.abs(centimos(importe(x))) }))
    .filter((e) => e.c > 0 && e.c < meta);
  for (let k = 2; k <= MAX_SUMANDOS; k++) {
    let mejor: T[] | null = null;
    let mejoresPuntos = -1;
    const elegir = (desde: number, quedan: number, suma: number, acc: T[]) => {
      if (quedan === 0) {
        if (Math.abs(suma - meta) <= TOLERANCIA_CENTIMOS) {
          const p = acc.reduce((s, x) => s + puntos(x), 0);
          if (p > mejoresPuntos) {
            mejor = [...acc];
            mejoresPuntos = p;
          }
        }
        return;
      }
      for (let i = desde; i < lista.length; i++) {
        if (suma + lista[i].c > meta + TOLERANCIA_CENTIMOS) continue;
        acc.push(lista[i].x);
        elegir(i + 1, quedan - 1, suma + lista[i].c, acc);
        acc.pop();
      }
    };
    elegir(0, k, 0, []);
    if (mejor) return mejor;
  }
  return null;
}

const sumaCentimos = (xs: number[]) => xs.reduce((s, x) => s + centimos(x), 0);

/** Más allá de este tamaño, un grupo que se disputa los mismos documentos va a revisar. */
const MAX_DISPUTA = 8;

/**
 * De las parejas posibles (movimiento → documentos), las que se deciden solas:
 * por cada grupo de movimientos y documentos conectados, el reparto uno a uno
 * que los casa a todos, si es el único posible.
 */
function repartosUnicos<D>(aristas: Map<string, D[]>, clave: (d: D) => string): [string, D][] {
  const resultado: [string, D][] = [];
  const visto = new Set<string>();
  for (const inicio of aristas.keys()) {
    if (visto.has(inicio)) continue;
    // El grupo: movimientos unidos por algún documento en común.
    const movsGrupo: string[] = [];
    const docsGrupo = new Set<string>();
    const cola = [inicio];
    visto.add(inicio);
    while (cola.length > 0) {
      const m = cola.pop()!;
      movsGrupo.push(m);
      for (const d of aristas.get(m) ?? []) {
        if (docsGrupo.has(clave(d))) continue;
        docsGrupo.add(clave(d));
        for (const [otro, ds] of aristas) {
          if (!visto.has(otro) && ds.some((x) => clave(x) === clave(d))) {
            visto.add(otro);
            cola.push(otro);
          }
        }
      }
    }
    if (movsGrupo.length !== docsGrupo.size || movsGrupo.length > MAX_DISPUTA) continue;

    let soluciones = 0;
    let unica: [string, D][] = [];
    const usados = new Set<string>();
    const actual: [string, D][] = [];
    const probar = (i: number) => {
      if (soluciones > 1) return;
      if (i === movsGrupo.length) {
        soluciones++;
        unica = [...actual];
        return;
      }
      for (const d of aristas.get(movsGrupo[i]) ?? []) {
        if (usados.has(clave(d))) continue;
        usados.add(clave(d));
        actual.push([movsGrupo[i], d]);
        probar(i + 1);
        actual.pop();
        usados.delete(clave(d));
      }
    };
    probar(0);
    if (soluciones === 1) resultado.push(...unica);
  }
  return resultado;
}

/**
 * El plan de conciliación para los movimientos y documentos sin conciliar.
 * No escribe nada: dice qué iría en verde, qué en ámbar y qué son traspasos.
 */
export function planConciliacion(movs: Movimiento[], docs: Documento[]): Plan {
  const traspasos = detectarTraspasos(movs);
  const movUsado = new Set(traspasos.flatMap((t) => [t.a, t.b]));
  const docUsado = new Set<string>();
  const clave = (d: Documento) => `${d.tipo}:${d.id}`;
  const verdes: Enlace[] = [];
  const ambares: Enlace[] = [];

  const libres = () => movs.filter((m) => !movUsado.has(m.id));
  const candidatos = (m: Movimiento) =>
    docs.filter(
      (d) =>
        !docUsado.has(clave(d)) &&
        coincideImporte(m.importe, d.esperado) &&
        enVentana(d.fecha, m.fecha),
    );
  const enlace = (
    ms: Movimiento[],
    ds: Documento[],
    estado: Enlace["estado"],
    motivo: MotivoEnlace,
  ): Enlace => {
    for (const m of ms) movUsado.add(m.id);
    for (const d of ds) docUsado.add(clave(d));
    return {
      movimientos: ms.map((m) => m.id),
      documentos: ds.map((d) => ({ tipo: d.tipo, id: d.id })),
      estado,
      motivo,
      diferencia:
        (sumaCentimos(ms.map((m) => m.importe)) - sumaCentimos(ds.map((d) => d.esperado))) / 100,
    };
  };

  // 1. Verdes: casan importe, fecha y contraparte, y no hay duda de qué va
  //    con qué. Se miran juntos los movimientos y documentos que se disputan
  //    (las cuotas de cada mes del mismo proveedor, por ejemplo): solo van a
  //    verde si hay UN reparto posible que los case a todos. Si caben dos, o
  //    sobra alguno, ninguno es verde.
  const aristas = new Map<string, Documento[]>();
  for (const m of libres()) {
    const ds = candidatos(m).filter((d) => reconoceContraparte(m.concepto, d) !== null);
    if (ds.length > 0) aristas.set(m.id, ds);
  }
  for (const [m, d] of repartosUnicos(aristas, clave)) {
    verdes.push(enlace([movs.find((x) => x.id === m)!], [d], "conciliada", "contraparte"));
  }

  // 2. Ámbar uno a uno: los que casan por importe y fecha. Primero los que
  //    tienen menos candidatas, para no quitarles la única que tienen.
  const pendientes = libres()
    .map((m) => ({ m, n: candidatos(m).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.n - b.n || a.m.fecha.localeCompare(b.m.fecha));
  for (const { m } of pendientes) {
    const ds = sugerencias(m, candidatos(m));
    if (ds.length === 0) continue;
    const varias = ds.length > 1 || aristas.has(m.id);
    ambares.push(
      enlace([m], [ds[0].documento], "revisar", varias ? "varias_candidatas" : "importe_fecha"),
    );
  }

  // 3. Un movimiento que paga varios documentos que suman.
  for (const m of libres()) {
    const posibles = docs
      .filter(
        (d) =>
          !docUsado.has(clave(d)) &&
          Math.sign(d.esperado) === Math.sign(m.importe) &&
          enVentana(d.fecha, m.fecha),
      )
      .sort((a, b) => Math.abs(diasEntre(a.fecha, m.fecha)) - Math.abs(diasEntre(b.fecha, m.fecha)))
      .slice(0, MAX_CANDIDATOS_SUMA);
    const ds = buscarSuma(
      m.importe,
      posibles,
      (d) => d.esperado,
      (d) => (reconoceContraparte(m.concepto, d) ? 1 : 0),
    );
    if (ds) ambares.push(enlace([m], ds, "revisar", "suma_documentos"));
  }

  // 4. Un documento pagado en varios movimientos que suman.
  for (const d of docs) {
    if (docUsado.has(clave(d))) continue;
    const posibles = libres()
      .filter((m) => Math.sign(m.importe) === Math.sign(d.esperado) && enVentana(d.fecha, m.fecha))
      .sort((a, b) => Math.abs(diasEntre(d.fecha, a.fecha)) - Math.abs(diasEntre(d.fecha, b.fecha)))
      .slice(0, MAX_CANDIDATOS_SUMA);
    const ms = buscarSuma(
      d.esperado,
      posibles,
      (m) => m.importe,
      (m) => (reconoceContraparte(m.concepto, d) ? 1 : 0),
    );
    if (ms) ambares.push(enlace(ms, [d], "revisar", "suma_movimientos"));
  }

  return { verdes, ambares, traspasos };
}
