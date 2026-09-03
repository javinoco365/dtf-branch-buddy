/**
 * Conciliación bancaria: casar lo que dice el banco con lo que dice el CRM.
 *
 * El extracto del banco trae, por cada movimiento, una fecha, un concepto
 * escrito por quien hizo la transferencia y un importe. Nada más. No trae el
 * número de factura en un campo aparte: si aparece, aparece dentro del concepto
 * y escrito como al ordenante le dio la gana.
 *
 * De ahí que esto no sea una comparación, sino una propuesta con motivos. El
 * importe solo no basta: dos clientes que pagan 302,50 € el mismo mes son dos
 * candidatos igual de buenos, y elegir uno al azar deja una factura marcada
 * como cobrada que no lo está. Por eso cada propuesta dice POR QUÉ, y solo las
 * que se sostienen por sí solas se pueden aplicar en bloque.
 *
 * Lógica pura: no importa nada de `routes/`, ni de Supabase, ni del lector de
 * Excel. Se prueba sin fichero y sin base de datos.
 */

import { redondear } from "./importes";

/** Lo que se acepta de diferencia. Javier lo fijó en dos céntimos. */
export const TOLERANCIA = 0.02;

/** Días de margen alrededor de la fecha de la factura para considerarla. */
export const DIAS_MARGEN = 120;

export type MovimientoBanco = {
  id: string;
  fecha: string;
  concepto: string;
  importe: number;
};

export type FacturaPendiente = {
  id: string;
  referencia: string;
  fecha: string;
  total: number;
  cliente_nombre: string | null;
};

export type Motivo = "referencia" | "cliente_e_importe" | "importe";

export type Propuesta = {
  movimiento_id: string;
  factura_id: string;
  motivo: Motivo;
  /** Cuántas facturas encajaban igual de bien. Más de una, hay que elegir. */
  candidatas: number;
  diferencia: number;
};

/** Una propuesta se aplica sola si no hay duda de a qué factura corresponde. */
export function esSegura(p: Propuesta): boolean {
  return p.candidatas === 1 && (p.motivo === "referencia" || p.motivo === "cliente_e_importe");
}

/**
 * Deja un texto comparable: sin acentos, sin signos, en minúsculas.
 *
 * «TRANSF. J. NOVOA CONTRERAS» y «Javier Novoa Contreras» tienen que poder
 * compararse, y el banco escribe en mayúsculas, sin tildes y recortando.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * ¿Aparece la referencia de la factura en el concepto?
 *
 * `2026/0007` se escribe de muchas maneras: «2026/0007», «2026-0007»,
 * «FRA 2026 0007», «fact 20260007». Se comparan solo los dígitos, que es lo
 * único que no cambia, y se exige que estén seguidos para no cazar una
 * coincidencia por accidente.
 */
export function contieneReferencia(concepto: string, referencia: string): boolean {
  const digitos = referencia.replace(/\D/g, "");
  if (digitos.length < 6) return false;
  return concepto.replace(/\D/g, "").includes(digitos);
}

/**
 * ¿Se reconoce al cliente en el concepto?
 *
 * Se exige que coincidan al menos dos palabras de tres o más letras. Con una
 * sola bastaría un apellido común para casar a dos clientes distintos.
 */
export function mencionaCliente(concepto: string, cliente: string | null): boolean {
  if (!cliente) return false;
  const palabrasConcepto = new Set(normalizar(concepto).split(" "));
  const delCliente = normalizar(cliente)
    .split(" ")
    .filter((p) => p.length >= 3 && !PALABRAS_VACIAS.has(p));
  if (delCliente.length === 0) return false;

  const encontradas = delCliente.filter((p) => palabrasConcepto.has(p)).length;
  // Un cliente de una sola palabra útil («Zara») casa con esa palabra.
  return delCliente.length === 1 ? encontradas === 1 : encontradas >= 2;
}

// Formas societarias y muletillas del banco: no identifican a nadie.
const PALABRAS_VACIAS = new Set([
  "sl",
  "sa",
  "slu",
  "sociedad",
  "limitada",
  "anonima",
  "the",
  "and",
  "transferencia",
  "transf",
  "recibo",
  "pago",
  "abono",
  "bizum",
  "factura",
  "fra",
]);

function diasEntre(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(ms) ? ms / 86_400_000 : Infinity;
}

/**
 * Empareja cada cobro del extracto con la factura que mejor lo explica.
 *
 * Solo mira los movimientos de ENTRADA: un cargo no paga una factura emitida.
 * Y solo propone una factura por movimiento y un movimiento por factura: si
 * dos ingresos idénticos cuadran con la misma factura, uno se queda sin casar
 * y se ve, que es mejor que darla por cobrada dos veces.
 */
export function emparejar(
  movimientos: MovimientoBanco[],
  facturas: FacturaPendiente[],
): Propuesta[] {
  const propuestas: Propuesta[] = [];
  const facturasUsadas = new Set<string>();

  // Primero las que traen la referencia escrita: son las que no admiten duda,
  // y conviene resolverlas antes de que otra se lleve la factura por importe.
  const porPrioridad = [...movimientos].sort((a, b) => {
    const refA = facturas.some((f) => contieneReferencia(a.concepto, f.referencia)) ? 0 : 1;
    const refB = facturas.some((f) => contieneReferencia(b.concepto, f.referencia)) ? 0 : 1;
    return refA - refB;
  });

  for (const m of porPrioridad) {
    if (m.importe <= 0) continue;

    const encajan = facturas.filter(
      (f) =>
        !facturasUsadas.has(f.id) &&
        Math.abs(redondear(f.total) - redondear(m.importe)) <= TOLERANCIA &&
        diasEntre(m.fecha, f.fecha) <= DIAS_MARGEN,
    );
    if (encajan.length === 0) continue;

    const porReferencia = encajan.filter((f) => contieneReferencia(m.concepto, f.referencia));
    const porCliente = encajan.filter((f) => mencionaCliente(m.concepto, f.cliente_nombre));

    let elegidas: FacturaPendiente[];
    let motivo: Motivo;
    if (porReferencia.length > 0) {
      elegidas = porReferencia;
      motivo = "referencia";
    } else if (porCliente.length > 0) {
      elegidas = porCliente;
      motivo = "cliente_e_importe";
    } else {
      elegidas = encajan;
      motivo = "importe";
    }

    // Con varias candidatas se propone la más cercana en el tiempo, pero se
    // dice cuántas había: la pantalla no puede aplicarla sola.
    const elegida = [...elegidas].sort(
      (a, b) => diasEntre(m.fecha, a.fecha) - diasEntre(m.fecha, b.fecha),
    )[0];

    facturasUsadas.add(elegida.id);
    propuestas.push({
      movimiento_id: m.id,
      factura_id: elegida.id,
      motivo,
      candidatas: elegidas.length,
      diferencia: redondear(m.importe - elegida.total),
    });
  }

  return propuestas;
}
