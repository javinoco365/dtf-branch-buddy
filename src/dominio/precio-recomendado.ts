/**
 * Precio de venta recomendado: solo información.
 *
 * El precio lo pone Javier. El sistema enseña al lado lo que saldría con la
 * relación precio/coste que él mismo aplica, calculada con datos reales: la de
 * otras variantes del mismo producto o, si no hay, la mediana de su catálogo.
 * Sin datos suficientes no recomienda nada (I8): nunca un número inventado ni
 * un margen «de manual».
 *
 * Lógica pura: sin base de datos ni red.
 */

import { redondear } from "./importes";
import type { VarianteCatalogo } from "./tipos-textil";

/** Muestras mínimas del catálogo para recomendar sin variantes del mismo producto. */
export const MIN_MUESTRAS_CATALOGO = 3;

export type Recomendacion = {
  precio: number; // redondear(coste × ratio, 2)
  ratio: number; // redondear(mediana, 4)
  fuente: "producto" | "catalogo";
  muestras: number;
};

/** Mediana; con un número par de valores, la media de los dos centrales. null si no hay. */
export function mediana(valores: readonly number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Coste ≤ 0 → null. Muestras: activas, no repetidas, distintas del objetivo,
 * con coste > 0 y precio_venta > 0. Con alguna del mismo producto → mediana
 * de precio/coste de esas («producto»). Si no, con al menos
 * MIN_MUESTRAS_CATALOGO → mediana de todas («catalogo»). Si no, null.
 */
export function precioRecomendado(
  objetivo: { id?: string | null; producto_id: string | null; coste_unitario: number },
  catalogo: readonly Pick<
    VarianteCatalogo,
    "id" | "producto_id" | "coste_unitario" | "precio_venta" | "activa" | "repetida"
  >[],
): Recomendacion | null {
  const coste = Number(objetivo.coste_unitario);
  if (!Number.isFinite(coste) || coste <= 0) return null;

  const muestras = catalogo.filter(
    (v) =>
      v.activa &&
      !v.repetida &&
      !(objetivo.id && v.id === objetivo.id) &&
      Number.isFinite(v.coste_unitario) &&
      Number.isFinite(v.precio_venta) &&
      v.coste_unitario > 0 &&
      v.precio_venta > 0,
  );

  const delProducto = objetivo.producto_id
    ? muestras.filter((v) => v.producto_id === objetivo.producto_id)
    : [];
  const [elegidas, fuente]: [typeof muestras, Recomendacion["fuente"]] =
    delProducto.length > 0
      ? [delProducto, "producto"]
      : muestras.length >= MIN_MUESTRAS_CATALOGO
        ? [muestras, "catalogo"]
        : [[], "catalogo"];
  const m = mediana(elegidas.map((v) => v.precio_venta / v.coste_unitario));
  if (m === null) return null;

  const ratio = redondear(m, 4);
  return { precio: redondear(coste * ratio, 2), ratio, fuente, muestras: elegidas.length };
}
