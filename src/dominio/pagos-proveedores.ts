/**
 * Pagos pendientes a proveedores: lo que se debe, a quién y desde cuándo.
 *
 * Cuentan las facturas registradas, sin borrar y con `estado_pago`
 * «pendiente». El importe es el líquido (lo que se paga de verdad, con la
 * retención descontada) o, sin él, el total. Un proveedor es el mismo aunque
 * su NIF venga escrito de dos maneras («ES-B12345678» y «B12345678»).
 *
 * Lógica pura: sin base de datos ni red.
 */

import { diaEnEspana } from "./fecha-documento";
import { redondear } from "./importes";
import { claveNif, claveTexto } from "./normalizar-textil";

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
};

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

function claveDeProveedor(c: CompraPendiente): string {
  if (c.proveedor_id) return `p:${c.proveedor_id}`;
  const nif = claveNif(c.nif_proveedor);
  if (nif) return `n:${nif}`;
  return `t:${claveTexto(c.proveedor)}`;
}

/**
 * Registradas, sin borrar y con estado_pago "pendiente"; importe = liquido ??
 * total; por proveedor_id, si no por claveNif(nif_proveedor), si no por
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

  for (const c of compras) {
    if (c.estado !== "registrada" || c.borrada_en || c.estado_pago !== "pendiente") continue;
    const bruto = c.liquido ?? c.total;
    const importe = redondear(Number(bruto) || 0);
    total += importe;
    facturas += 1;

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
  };
}
