/**
 * Productos que son el mismo modelo: qué se propone unir.
 *
 * Hay proveedores que meten la talla y el color en la referencia (Roly:
 * SS643203011 es la Antartida en L y blanco perla). Al registrar sus compras,
 * cada referencia daba un producto, y la Antartida acabó siendo seis productos
 * de una variante cada uno: el catálogo no sabe que son la misma prenda, la
 * rejilla de «Elegir del stock» sale de una casilla y la columna SKU, vacía.
 *
 * Unir es dejar un producto (el modelo) con todas las variantes y pasar la
 * referencia de cada uno al SKU de su variante. Lo hace la base, en
 * textil_productos_unir() (20261101100000), y no borra nada: los productos que
 * se quedan sin variantes se desactivan.
 *
 * Se proponen los productos activos con la misma marca y el mismo nombre. Sin
 * marca no: «Camiseta» a secas puede ser cualquier cosa. Si dos de ellos
 * tienen una variante activa del mismo color y talla, la base no los une (un
 * producto no puede tener dos variantes iguales): se avisa de cuáles son, para
 * fusionarlas antes.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { claveTalla, claveTexto } from "./normalizar-textil";
import type { ProductoTextil, VarianteCatalogo } from "./tipos-textil";

export type PropuestaUnion = {
  clave: string;
  marca: string;
  nombre: string;
  /**
   * El que se queda: el que no tiene referencia, si hay uno (la base no deja
   * dos sin referencia con la misma marca y nombre); si no, el de más
   * variantes.
   */
  destino: ProductoTextil;
  origenes: ProductoTextil[];
  /** Variantes que pasan al que se queda. */
  variantes: number;
  /** Color y talla que están en más de un producto: mientras haya, no se une. */
  choques: { color: string | null; talla: string | null }[];
};

/** Las prendas partidas en varios productos, por marca y nombre. */
export function propuestasDeUnion(variantes: readonly VarianteCatalogo[]): PropuestaUnion[] {
  const productos = new Map<string, { producto: ProductoTextil; variantes: VarianteCatalogo[] }>();
  for (const v of variantes) {
    const p = v.producto;
    if (!p || !p.activo || claveTexto(p.marca) === "") continue;
    const entrada = productos.get(p.id);
    if (entrada) entrada.variantes.push(v);
    else productos.set(p.id, { producto: p, variantes: [v] });
  }

  const porModelo = new Map<
    string,
    { producto: ProductoTextil; variantes: VarianteCatalogo[] }[]
  >();
  for (const e of productos.values()) {
    const clave = `${claveTexto(e.producto.marca)}|${claveTexto(e.producto.nombre)}`;
    const lista = porModelo.get(clave);
    if (lista) lista.push(e);
    else porModelo.set(clave, [e]);
  }

  const propuestas: PropuestaUnion[] = [];
  for (const [clave, lista] of porModelo) {
    if (lista.length < 2) continue;
    const ordenados = [...lista].sort(
      (a, b) =>
        Number(claveTexto(a.producto.referencia) !== "") -
          Number(claveTexto(b.producto.referencia) !== "") ||
        b.variantes.length - a.variantes.length ||
        a.producto.id.localeCompare(b.producto.id),
    );
    const [destino, ...origenes] = ordenados;

    // Las activas y no repetidas de cada color y talla, por producto.
    const enProductos = new Map<
      string,
      { color: string | null; talla: string | null; ids: Set<string> }
    >();
    for (const e of lista) {
      for (const v of e.variantes) {
        if (!v.activa || v.repetida) continue;
        const k = `${claveTexto(v.color)}|${claveTalla(v.talla)}`;
        const c = enProductos.get(k) ?? { color: v.color, talla: v.talla, ids: new Set<string>() };
        c.ids.add(e.producto.id);
        enProductos.set(k, c);
      }
    }
    const choques = [...enProductos.values()]
      .filter((c) => c.ids.size > 1)
      .map(({ color, talla }) => ({ color, talla }));

    propuestas.push({
      clave,
      marca: destino.producto.marca ?? "",
      nombre: destino.producto.nombre,
      destino: destino.producto,
      origenes: origenes.map((o) => o.producto),
      variantes: origenes.reduce((n, o) => n + o.variantes.length, 0),
      choques,
    });
  }
  return propuestas.sort(
    (a, b) => a.marca.localeCompare(b.marca, "es") || a.nombre.localeCompare(b.nombre, "es"),
  );
}
