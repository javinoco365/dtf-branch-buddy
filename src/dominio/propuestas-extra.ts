/**
 * Propuestas que el motor básico (motor-conciliacion.ts) no ve:
 *
 * 1. Remesas de TPV: el banco abona de una vez lo cobrado con tarjeta de uno o
 *    varios días. Se casa con las ventas ya cobradas (los tickets nacen
 *    pagados) de los días de antes cuyo total da el importe de la remesa.
 * 2. Bizum: un abono que dice «Bizum» y una venta ya cobrada del mismo
 *    importe, en los días de alrededor.
 * 3. Lo aprendido: un concepto que ya se concilió otras veces con el mismo
 *    proveedor o cliente (los recibos domiciliados de cada mes) propone la
 *    factura pendiente de ese proveedor o cliente con el mismo importe,
 *    aunque el banco lo nombre de otra manera.
 *
 * Todo va a ámbar («por revisar»), salvo lo aprendido con dos o más
 * conciliaciones anteriores y una sola factura posible, que va a verde.
 * Nunca se inventa un reparto: si caben dos combinaciones, no se propone.
 *
 * Lógica pura: sin base de datos.
 */
import { mencionaCliente, normalizar } from "./conciliacion";
import {
  coincideImporte,
  diasEntre,
  enVentana,
  type Documento,
  type Enlace,
  type Movimiento,
  type Plan,
} from "./motor-conciliacion";

/** Una venta ya cobrada que todavía no está enlazada a un movimiento del banco. */
export type VentaCobrada = Documento & {
  /** Método de pago del pedido (WooCommerce o a mano), si se sabe. */
  metodo: string | null;
};

/** Días antes de la remesa en que pueden caer sus ventas (un fin de semana largo). */
export const DIAS_REMESA = 5;
/** Días alrededor de un Bizum en que se busca su venta. */
export const DIAS_BIZUM = 3;
/** Ventas como mucho en el reparto de una remesa: más allá, la búsqueda se dispara. */
export const MAX_VENTAS_REMESA = 40;
/**
 * Remesa más alta que se reparte venta a venta (3.000 €): la tabla mide
 * ventas × céntimos. Por encima solo se prueba con días seguidos.
 */
export const MAX_CENTIMOS_REMESA = 300_000;

const centimos = (n: number) => Math.round(n * 100);
const clave = (d: { tipo: string; id: string }) => `${d.tipo}:${d.id}`;

export function esRemesaTarjeta(concepto: string): boolean {
  const c = normalizar(concepto);
  return /\b(tpv|remesa|redsys|liquidacion tarjeta|abono tarjeta|liq tpv|comercio)\b/.test(c);
}

export function esBizum(concepto: string): boolean {
  return /\bbizum\b/.test(normalizar(concepto));
}

/** ¿Pudo cobrarse con tarjeta? Sin método (pedidos de antes de guardarlo), se da por posible. */
export function pagoConTarjeta(metodo: string | null): boolean {
  if (!metodo) return true;
  return /tarjeta|redsys|tpv|card|stripe|credito|debito/.test(normalizar(metodo));
}

export function pagoConBizum(metodo: string | null): boolean {
  if (!metodo) return true;
  return /bizum/.test(normalizar(metodo));
}

/**
 * Las combinaciones de ventas cuyo total es exactamente `objetivo` (en
 * céntimos), contando como mucho dos: basta saber si es única. Programación
 * dinámica sobre los céntimos, para que veinte tickets no sean un millón de
 * pruebas.
 */
export function repartoUnico<T extends { esperado: number }>(
  ventas: T[],
  objetivo: number,
): T[] | null {
  if (objetivo <= 0 || objetivo > MAX_CENTIMOS_REMESA) return null;
  if (ventas.length === 0 || ventas.length > MAX_VENTAS_REMESA) return null;
  const importes = ventas.map((v) => centimos(v.esperado));
  if (importes.some((c) => c <= 0)) return null;
  if (importes.reduce((a, b) => a + b, 0) < objetivo) return null;
  // formas[i][s]: de cuántas maneras (0, 1 o 2 = «varias») las ventas i.. suman s.
  const n = importes.length;
  const formas: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(objetivo + 1));
  formas[n][0] = 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let s = 0; s <= objetivo; s++) {
      let f = formas[i + 1][s];
      if (s >= importes[i]) f += formas[i + 1][s - importes[i]];
      formas[i][s] = Math.min(f, 2);
    }
  }
  if (formas[0][objetivo] !== 1) return null;
  const elegidas: T[] = [];
  let s = objetivo;
  for (let i = 0; i < n; i++) {
    // Si sin esta venta no se llega, va dentro.
    if (formas[i + 1][s] === 0) {
      elegidas.push(ventas[i]);
      s -= importes[i];
    }
  }
  return elegidas;
}

/**
 * La clave de un concepto del banco para reconocerlo otro mes: sin números
 * (fechas, referencias), sin las muletillas del banco y sin palabras de una o
 * dos letras. «RECIBO E-DISTRIBUCION 10/2026 REF 4471» → «distribucion».
 */
export function claveConcepto(concepto: string): string {
  return normalizar(concepto)
    .split(" ")
    .filter((p) => p.length >= 3 && !/\d/.test(p) && !MULETILLAS.has(p))
    .join(" ");
}

const MULETILLAS = new Set([
  "recibo",
  "adeudo",
  "cargo",
  "abono",
  "transferencia",
  "transf",
  "trf",
  "sepa",
  "core",
  "pago",
  "cobro",
  "domiciliacion",
  "domiciliado",
  "ref",
  "referencia",
  "factura",
  "fra",
  "mes",
  "fecha",
  "concepto",
  "ordenante",
  "beneficiario",
  "favor",
  "por",
  "del",
  "los",
  "las",
  "con",
]);

/** Lo que se sabe de un concepto por las conciliaciones de antes. */
export type Aprendido = { nif: string | null; contraparte: string | null; veces: number };

/**
 * Qué proveedor o cliente hay detrás de cada concepto, aprendido de los
 * enlaces ya conciliados de un movimiento con un solo documento. Si un
 * concepto se concilió con dos contrapartes distintas, no se aprende: es
 * ambiguo.
 */
export function aprenderConceptos(
  enlaces: { movimientos: { concepto: string }[]; documentos: Documento[] }[],
): Map<string, Aprendido> {
  const memoria = new Map<string, Aprendido & { quien: string }>();
  const ambiguos = new Set<string>();
  for (const e of enlaces) {
    if (e.documentos.length !== 1) continue;
    const d = e.documentos[0];
    const quien = d.nif ? `nif:${normalizar(d.nif)}` : `nombre:${normalizar(d.contraparte ?? "")}`;
    if (quien === "nombre:") continue;
    for (const m of e.movimientos) {
      const k = claveConcepto(m.concepto);
      if (!k || ambiguos.has(k)) continue;
      const ya = memoria.get(k);
      if (!ya) {
        memoria.set(k, { nif: d.nif, contraparte: d.contraparte, veces: 1, quien });
      } else if (ya.quien === quien) {
        ya.veces++;
      } else {
        memoria.delete(k);
        ambiguos.add(k);
      }
    }
  }
  return new Map(
    [...memoria].map(([k, a]) => [k, { nif: a.nif, contraparte: a.contraparte, veces: a.veces }]),
  );
}

const mismoQuien = (d: Documento, a: Aprendido) =>
  a.nif
    ? !!d.nif && normalizar(d.nif) === normalizar(a.nif)
    : !!d.contraparte && normalizar(d.contraparte) === normalizar(a.contraparte ?? "");

const enlaceDe = (
  ms: Movimiento[],
  ds: Documento[],
  estado: Enlace["estado"],
  motivo: Enlace["motivo"],
): Enlace => ({
  movimientos: ms.map((m) => m.id),
  documentos: ds.map((d) => ({ tipo: d.tipo, id: d.id })),
  estado,
  motivo,
  diferencia:
    (ms.reduce((s, m) => s + centimos(m.importe), 0) -
      ds.reduce((s, d) => s + centimos(d.esperado), 0)) /
    100,
});

/**
 * Amplía el plan del motor con remesas de TPV, Bizum y lo aprendido. Solo
 * mira los movimientos que el motor dejó sin propuesta y los documentos que
 * no usó; cada venta o documento entra en una propuesta como mucho.
 */
export function ampliarPlan(
  plan: Plan,
  movs: Movimiento[],
  docs: Documento[],
  ventas: VentaCobrada[],
  memoria: Map<string, Aprendido>,
): Plan {
  const movUsado = new Set<string>();
  const docUsado = new Set<string>();
  for (const e of [...plan.verdes, ...plan.ambares]) {
    for (const id of e.movimientos) movUsado.add(id);
    for (const d of e.documentos) docUsado.add(clave(d));
  }
  for (const t of plan.traspasos) {
    movUsado.add(t.a);
    movUsado.add(t.b);
  }
  const verdes = [...plan.verdes];
  const ambares = [...plan.ambares];
  const usar = (ms: Movimiento[], ds: Documento[]) => {
    for (const m of ms) movUsado.add(m.id);
    for (const d of ds) docUsado.add(clave(d));
  };
  const libres = () => movs.filter((m) => !movUsado.has(m.id));
  const ventasLibres = () => ventas.filter((v) => !docUsado.has(clave(v)));

  // 1. Lo aprendido: el mismo concepto, el mismo proveedor o cliente, el
  //    mismo importe y una sola factura posible.
  for (const m of libres()) {
    const a = memoria.get(claveConcepto(m.concepto));
    if (!a) continue;
    const candidatas = docs.filter(
      (d) =>
        !docUsado.has(clave(d)) &&
        mismoQuien(d, a) &&
        coincideImporte(m.importe, d.esperado) &&
        enVentana(d.fecha, m.fecha),
    );
    if (candidatas.length !== 1) continue;
    usar([m], candidatas);
    (a.veces >= 2 ? verdes : ambares).push(
      enlaceDe([m], candidatas, a.veces >= 2 ? "conciliada" : "revisar", "historial"),
    );
  }

  // 2. Bizum: una venta ya cobrada del mismo importe, cerca en fecha. Si el
  //    concepto nombra al cliente, esa; si no, solo si es la única.
  for (const m of libres().filter((x) => x.importe > 0 && esBizum(x.concepto))) {
    const cerca = ventasLibres().filter(
      (v) =>
        pagoConBizum(v.metodo) &&
        coincideImporte(m.importe, v.esperado) &&
        Math.abs(diasEntre(v.fecha, m.fecha)) <= DIAS_BIZUM,
    );
    const nombradas = cerca.filter((v) => mencionaCliente(m.concepto, v.contraparte));
    const elegida = nombradas.length === 1 ? nombradas[0] : cerca.length === 1 ? cerca[0] : null;
    if (!elegida) continue;
    usar([m], [elegida]);
    ambares.push(enlaceDe([m], [elegida], "revisar", "bizum"));
  }

  // 3. Remesas de TPV: las ventas con tarjeta de los días de antes que suman
  //    el abono. Primero un tramo de días seguidos (lo normal: el día de
  //    antes, o el fin de semana); si no, un reparto único entre ellas.
  for (const m of libres().filter((x) => x.importe > 0 && esRemesaTarjeta(x.concepto))) {
    const ventana = ventasLibres()
      .filter((v) => {
        const d = diasEntre(v.fecha, m.fecha);
        return pagoConTarjeta(v.metodo) && d >= 0 && d <= DIAS_REMESA;
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
    const objetivo = centimos(m.importe);
    const dias = [...new Set(ventana.map((v) => v.fecha.slice(0, 10)))].sort();
    let elegidas: VentaCobrada[] | null = null;
    let encontrados = 0;
    for (let i = 0; i < dias.length; i++) {
      for (let j = i; j < dias.length; j++) {
        const tramo = ventana.filter((v) => {
          const f = v.fecha.slice(0, 10);
          return f >= dias[i] && f <= dias[j];
        });
        if (tramo.reduce((s, v) => s + centimos(v.esperado), 0) === objetivo) {
          encontrados++;
          elegidas = tramo;
        }
      }
    }
    if (encontrados !== 1) elegidas = encontrados > 1 ? null : repartoUnico(ventana, objetivo);
    if (!elegidas || elegidas.length === 0) continue;
    usar([m], elegidas);
    ambares.push(enlaceDe([m], elegidas, "revisar", "remesa_tpv"));
  }

  return { verdes, ambares, traspasos: plan.traspasos };
}
