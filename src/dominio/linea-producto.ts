/**
 * La línea de producto: DTF (impresión propia) o DTF UV (subcontratado).
 *
 * Desde el 10 de noviembre de 2026 las tiendas venden también DTF UV, por
 * metros y con los mismos productos de WooCommerce. El UV lo imprime y lo
 * envía una subcontrata, así que sus metros no pasan por la máquina, cuestan
 * lo que cobra ella y no se suman a los del DTF.
 *
 * Cómo se reconoce una línea de UV, de más a menos fiable:
 *
 *   1. El producto de WooCommerce está en el catálogo del CRM y ya se sabe su
 *      línea (por su categoría, «DTF UV»).
 *   2. Si no, el nombre de la línea del pedido lleva «UV» como palabra
 *      («DTF UV por Metros Manual»).
 *   3. Si no, es DTF: todo lo vendido antes del UV lo es.
 *
 * Lógica pura: sin Supabase ni red.
 */

import { normalizarTexto } from "./clientes";

export type LineaProducto = "dtf" | "uv";

export const LINEAS_PRODUCTO: readonly LineaProducto[] = ["dtf", "uv"];

export const ETIQUETA_LINEA: Record<LineaProducto, string> = {
  dtf: "DTF",
  uv: "UV",
};

/** «UV» como palabra suelta, no dentro de otra («uvas», «suvenir»). */
const PALABRA_UV = /(^|[^a-z0-9])uv([^a-z0-9]|$)/;

/** ¿Habla de UV un texto (nombre, categoría o slug)? */
export function mencionaUv(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PALABRA_UV.test(normalizarTexto(texto).replace(/[_-]+/g, " "));
}

export type CategoriaWoo = { name?: string | null; slug?: string | null };

/**
 * La línea de un producto del catálogo de WooCommerce: UV si alguna de sus
 * categorías es de UV o, sin categorías que lo digan, si su nombre lo dice.
 */
export function lineaDeProductoWoo(producto: {
  name?: string | null;
  categories?: readonly CategoriaWoo[] | null;
}): LineaProducto {
  const categorias = producto.categories ?? [];
  if (categorias.some((c) => mencionaUv(c.name) || mencionaUv(c.slug))) return "uv";
  return mencionaUv(producto.name) ? "uv" : "dtf";
}

/**
 * La línea de una línea de pedido: la del producto si el catálogo la sabe; si
 * no, la que diga su nombre.
 */
export function lineaDeLineaPedido(
  nombre: string | null | undefined,
  lineaDelProducto: LineaProducto | null | undefined,
): LineaProducto {
  if (lineaDelProducto === "dtf" || lineaDelProducto === "uv") return lineaDelProducto;
  return mencionaUv(nombre) ? "uv" : "dtf";
}

/** Qué líneas lleva un pedido, por sus metros: sirve para su etiqueta. */
export type LineasDelPedido = "dtf" | "uv" | "mixto" | "ninguna";

export function lineasDelPedido(p: {
  metros_total?: number | string | null;
  metros_uv?: number | string | null;
}): LineasDelPedido {
  const dtf = Number(p.metros_total ?? 0) > 0;
  const uv = Number(p.metros_uv ?? 0) > 0;
  if (dtf && uv) return "mixto";
  if (uv) return "uv";
  if (dtf) return "dtf";
  return "ninguna";
}

/** ¿Es un pedido solo de UV? Lo envía la subcontrata. */
export const esSoloUv = (p: {
  metros_total?: number | string | null;
  metros_uv?: number | string | null;
}) => lineasDelPedido(p) === "uv";
