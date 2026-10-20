/**
 * Pagos pendientes a proveedores: lo que se debe, a quién y desde cuándo.
 *
 * Cuentan las facturas registradas, sin borrar y con `estado_pago`
 * «pendiente». El importe es el líquido (lo que se paga de verdad, con la
 * retención descontada) o, sin él, el total. Un proveedor es el mismo aunque
 * su NIF venga escrito de dos maneras («ES-B12345678» y «B12345678»).
 *
 * Una proforma casada con su factura no cuenta: el pago vive en la factura.
 * Una proforma pagada y sin factura es un anticipo a proveedor.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { diaEnEspana } from "./fecha-documento";
import { redondear } from "./importes";
import { claveNif, claveTexto } from "./normalizar-textil";
import type { ProformaFila } from "./proformas";

export type CompraPendiente = {
  id: string;
  proveedor: string | null;
  nif_proveedor: string | null;
  proveedor_id?: string | null;
  numero: string | null;
  fecha: string | null;
  liquido?: number | string | null;
  total: number | string;
  estado: string;
  estado_pago?: string | null;
  borrada_en?: string | null;
  /** «factura» o «proforma»; sin la migración, factura. */
  tipo_documento?: string | null;
  /** Proforma ya casada con su factura: el pago está en la factura. */
  casada?: boolean;
  /**
   * En una factura casada, lo que hizo el casado (`casado_resumen`). Si la
   * proforma ya estaba pagada (a mano, sin enlace del banco) y la factura sale
   * por más, la factura queda pendiente solo por la diferencia.
   */
  casado_resumen?: unknown;
};

/**
 * Lo ya pagado con la proforma de una factura casada que quedó pendiente: el
 * líquido de la proforma si estaba pagada; 0 si no.
 */
export function pagadoConProforma(casadoResumen: unknown): number {
  if (!casadoResumen || typeof casadoResumen !== "object") return 0;
  const pago = (casadoResumen as { pago?: unknown }).pago;
  if (!pago || typeof pago !== "object") return 0;
  const p = pago as { proforma_pagada?: unknown; liquido_proforma?: unknown };
  if (p.proforma_pagada !== true) return 0;
  return redondear(Number(p.liquido_proforma) || 0);
}

export type TramoPago = {
  clave: "0-30" | "31-60" | "61-90" | "90+";
  etiqueta: string;
  facturas: number;
  importe: number;
};

export type DeudaProveedor = {
  clave: string;
  nombre: string;
  facturas: number;
  importe: number;
  masAntigua: string | null;
};

export type PagosProveedores = {
  total: number;
  facturas: number;
  porProveedor: DeudaProveedor[];
  tramos: TramoPago[];
  /** Cuántas de las contadas son proformas. */
  proformas: number;
};

const TRAMOS: readonly { clave: TramoPago["clave"]; etiqueta: string; hasta: number }[] = [
  { clave: "0-30", etiqueta: "Hasta 30 días", hasta: 30 },
  { clave: "31-60", etiqueta: "De 31 a 60 días", hasta: 60 },
  { clave: "61-90", etiqueta: "De 61 a 90 días", hasta: 90 },
  { clave: "90+", etiqueta: "Más de 90 días", hasta: Number.POSITIVE_INFINITY },
];

const DIA_MS = 86_400_000;

/** Días entre dos días 'yyyy-mm-dd' (de calendario, sin horas). null si alguno no lo es. */
function diasEntre(desde: string | null, hasta: string): number | null {
  if (!desde) return null;
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DIA_MS);
}

function claveDeProveedor(
  c: Pick<CompraPendiente, "proveedor_id" | "nif_proveedor" | "proveedor">,
): string {
  if (c.proveedor_id) return `p:${c.proveedor_id}`;
  const nif = claveNif(c.nif_proveedor);
  if (nif) return `n:${nif}`;
  return `t:${claveTexto(c.proveedor)}`;
}

/**
 * Registradas, sin borrar y con estado_pago "pendiente"; importe = liquido ??
 * total, menos lo ya pagado con su proforma si es una factura casada
 * (pagadoConProforma; si no queda nada, no cuenta); por proveedor_id, si no por claveNif(nif_proveedor), si no por
 * claveTexto(proveedor); antigüedad desde la fecha (sin fecha, en el primer
 * tramo).
 */
export function pagosPendientesProveedores(
  compras: readonly CompraPendiente[],
  hoy: Date,
): PagosProveedores {
  const dia = diaEnEspana(hoy);
  const tramos: TramoPago[] = TRAMOS.map((t) => ({
    clave: t.clave,
    etiqueta: t.etiqueta,
    facturas: 0,
    importe: 0,
  }));
  const grupos = new Map<string, DeudaProveedor>();
  let total = 0;
  let facturas = 0;
  let proformas = 0;

  for (const c of compras) {
    if (c.estado !== "registrada" || c.borrada_en || c.estado_pago !== "pendiente") continue;
    if (c.casada === true) continue;
    const bruto = c.liquido ?? c.total;
    // Lo pagado con su proforma ya no se debe: solo la diferencia.
    const importe = redondear((Number(bruto) || 0) - pagadoConProforma(c.casado_resumen));
    if (importe <= 0 && pagadoConProforma(c.casado_resumen) > 0) continue;
    total += importe;
    facturas += 1;
    if (c.tipo_documento === "proforma") proformas += 1;

    const dias = diasEntre(c.fecha, dia) ?? 0;
    const i = TRAMOS.findIndex((t) => dias <= t.hasta);
    tramos[i].facturas += 1;
    tramos[i].importe += importe;

    const clave = claveDeProveedor(c);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, nombre: "", facturas: 0, importe: 0, masAntigua: null };
      grupos.set(clave, g);
    }
    if (!g.nombre) g.nombre = (c.proveedor ?? "").trim() || (c.nif_proveedor ?? "").trim();
    g.facturas += 1;
    g.importe += importe;
    if (c.fecha && (g.masAntigua === null || c.fecha < g.masAntigua)) g.masAntigua = c.fecha;
  }

  const porProveedor = [...grupos.values()]
    .map((g) => ({ ...g, nombre: g.nombre || "Sin proveedor", importe: redondear(g.importe) }))
    .sort((a, b) => b.importe - a.importe || a.nombre.localeCompare(b.nombre, "es"));

  return {
    total: redondear(total),
    facturas,
    porProveedor,
    tramos: tramos.map((t) => ({ ...t, importe: redondear(t.importe) })),
    proformas,
  };
}

export type AnticiposProveedores = {
  total: number;
  proformas: number;
  /** `facturas` cuenta proformas; `masAntigua`, por fecha de pago. */
  porProveedor: DeudaProveedor[];
  /** El pago más antiguo (fecha_pago). */
  masAntigua: string | null;
};

/**
 * Proformas (tipo_documento "proforma"), registradas (estado "registrada" o
 * ausente), sin borrar, sin factura casada en la lista y con estado_pago
 * "pagada": dinero ya salido sin factura. Importe = redondear(liquido ?? total
 * ?? 0). Agrupa por proveedor como pagosPendientesProveedores. No depende del
 * periodo: `hoy` se acepta por simetría con pagosPendientesProveedores.
 */
export function anticiposProveedores(
  compras: readonly ProformaFila[],
  hoy: Date,
): AnticiposProveedores {
  void hoy;
  const casadas = new Set<string>();
  for (const c of compras) if (c.proforma_id) casadas.add(c.proforma_id);

  const grupos = new Map<string, DeudaProveedor>();
  let total = 0;
  let proformas = 0;
  let masAntigua: string | null = null;

  for (const c of compras) {
    if (c.tipo_documento !== "proforma") continue;
    if (c.estado != null && c.estado !== "registrada") continue;
    if (c.borrada_en || casadas.has(c.id) || c.estado_pago !== "pagada") continue;
    const importe = redondear(Number(c.liquido ?? c.total ?? 0) || 0);
    total += importe;
    proformas += 1;
    const pago = c.fecha_pago ? c.fecha_pago.slice(0, 10) : null;
    if (pago && (masAntigua === null || pago < masAntigua)) masAntigua = pago;

    const clave = claveDeProveedor(c);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, nombre: "", facturas: 0, importe: 0, masAntigua: null };
      grupos.set(clave, g);
    }
    if (!g.nombre) g.nombre = (c.proveedor ?? "").trim() || (c.nif_proveedor ?? "").trim();
    g.facturas += 1;
    g.importe += importe;
    if (pago && (g.masAntigua === null || pago < g.masAntigua)) g.masAntigua = pago;
  }

  const porProveedor = [...grupos.values()]
    .map((g) => ({ ...g, nombre: g.nombre || "Sin proveedor", importe: redondear(g.importe) }))
    .sort((a, b) => b.importe - a.importe || a.nombre.localeCompare(b.nombre, "es"));

  return { total: redondear(total), proformas, porProveedor, masAntigua };
}
