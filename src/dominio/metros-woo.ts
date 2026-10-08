/**
 * Los metros de cada línea de un pedido de WooCommerce.
 *
 * El montador de DTF (DTFBuild) no vende «1 unidad»: guarda en la línea lo que
 * mide el trabajo, como datos del artículo (`meta_data`). En un pedido real:
 *
 *   Tamaño de hoja: 58 × Auto
 *   Ancho de hoja (cm): 58
 *   Longitud de hoja (m): 4.4
 *   Longitud facturada por trabajo (m): 4.4
 *   Precio por metro: 7,00 €
 *   Total de hojas: 1
 *
 * con cantidad 1 y 30,83 € de línea. Antes se tomaba la CANTIDAD como metros:
 * ese pedido contaba 1 m en vez de 4,4, y el precio del metro salía a 30,83 €.
 *
 * Qué se lee, por orden:
 *   1. «Longitud facturada por trabajo»: lo que se cobra, que es lo que vale.
 *   2. Si no está, «Longitud de hoja» × «Total de hojas» (1 si no viene).
 *   3. Sin datos del montador, si el producto se llama «… metro(s) …», la
 *      cantidad (productos que se venden por metros con la cantidad).
 *   4. Si no, la línea no es de metros (textil, accesorios…): `null`.
 * Los metros del trabajo son por unidad: se multiplican por la cantidad.
 * Las etiquetas se comparan sin tildes ni mayúsculas; si dicen «(cm)», se
 * pasa a metros.
 *
 * Lógica pura: sin Supabase ni red.
 */

import { normalizarTexto } from "./clientes";
import { redondear } from "./importes";

export type MetaWoo = {
  key?: string | null;
  value?: unknown;
  display_key?: string | null;
  display_value?: unknown;
};

export type LineaWoo = {
  name?: string | null;
  quantity?: number | string | null;
  subtotal?: number | string | null;
  meta_data?: MetaWoo[] | null;
};

/** Un número escrito como sea: 4.4, «4,4», «4,40 m», «1.234,5». */
export function numeroDeTexto(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    // El último separador es el decimal.
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function buscar(metas: MetaWoo[], etiqueta: string): { valor: number; enCm: boolean } | null {
  for (const m of metas) {
    const nombre = normalizarTexto(String(m.display_key ?? m.key ?? ""));
    if (!nombre.includes(etiqueta)) continue;
    const valor = numeroDeTexto(m.value ?? m.display_value);
    if (valor !== null && valor > 0) return { valor, enCm: nombre.includes("(cm)") };
  }
  return null;
}

const enMetros = (x: { valor: number; enCm: boolean }) => (x.enCm ? x.valor / 100 : x.valor);

/** Metros de la línea (ya multiplicados por la cantidad), o `null` si no se vende por metros. */
export function metrosLineaWoo(li: LineaWoo): number | null {
  const cantidad = numeroDeTexto(li.quantity ?? 0) ?? 0;
  const metas = Array.isArray(li.meta_data) ? li.meta_data : [];

  const facturada = buscar(metas, "longitud facturada");
  if (facturada) return redondear(enMetros(facturada) * cantidad, 3);

  const hoja = buscar(metas, "longitud de hoja");
  if (hoja) {
    const hojas = buscar(metas, "total de hojas")?.valor ?? 1;
    return redondear(enMetros(hoja) * hojas * cantidad, 3);
  }

  if (/\bmetros?\b/i.test(li.name ?? "")) return redondear(cantidad, 3);
  return null;
}

/** La línea como la guarda el CRM: en metros si lo es, en unidades si no. */
export function lineaPedidoWoo(li: LineaWoo): {
  cantidad: number;
  unidad: "m" | "ud";
  precio_unitario: number;
} {
  const subtotal = numeroDeTexto(li.subtotal ?? 0) ?? 0;
  const metros = metrosLineaWoo(li);
  const cantidad = metros ?? numeroDeTexto(li.quantity ?? 0) ?? 0;
  return {
    cantidad,
    unidad: metros === null ? "ud" : "m",
    precio_unitario: cantidad > 0 ? redondear(subtotal / cantidad, 4) : 0,
  };
}

/** Metros del pedido: la suma de sus líneas de metros. */
export function metrosPedidoWoo(lineas: readonly LineaWoo[] | null | undefined): number {
  return redondear(
    (lineas ?? []).reduce((s, li) => s + (metrosLineaWoo(li) ?? 0), 0),
    3,
  );
}
