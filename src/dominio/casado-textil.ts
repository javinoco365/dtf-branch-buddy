/**
 * Casado del escáner textil: a qué variante del catálogo corresponde cada
 * línea de una factura de proveedor.
 *
 * De más seguro a menos:
 *
 *   1. lo que no es artículo (portes, descuentos…) no se casa;
 *   2. la memoria del proveedor («lo que este proveedor llama X es esta
 *      variante»), que aprende con cada registro confirmado;
 *   3. el EAN;
 *   4. la referencia (SKU único y compatible, o referencia del producto con el
 *      mismo color y talla);
 *   5. el parecido de las palabras, que **nunca** casa solo: solo sugiere.
 *
 * El EAN de la factura manda: si la línea trae un EAN válido y la variante
 * propuesta por la memoria o por la referencia tiene otro, esa propuesta no
 * vale. Las variantes desactivadas o repetidas no se casan nunca.
 *
 * Lógica pura: sin base de datos ni red.
 */

import {
  claveMemoria,
  claveMemoriaDescripcion,
  claveTalla,
  claveTexto,
  normalizarEan,
  palabras,
} from "./normalizar-textil";
import { etiquetaVariante, utilizable } from "./stock-textil";
import type {
  Casado,
  EntradaMemoria,
  LineaParaCasar,
  NuevaVariante,
  ProductoTextil,
  Sugerencia,
  VarianteCatalogo,
} from "./tipos-textil";

export const PUNTOS_MINIMOS_SUGERENCIA = 40;
export const MAX_SUGERENCIAS = 3;

/** Colores que son el mismo (claves ya normalizadas). Solo para comparar: la base guarda el color sin traducir. */
export const SINONIMOS_COLOR: readonly (readonly string[])[] = [
  ["negro", "black", "noir"],
  ["blanco", "white", "blanc"],
  ["rojo", "red"],
  ["azulmarino", "marino", "navy", "navyblue"],
  ["azul", "blue", "royal", "royalblue"],
  ["gris", "grey", "gray"],
  ["verde", "green"],
  ["amarillo", "yellow"],
  ["naranja", "orange"],
  ["rosa", "pink"],
  ["morado", "purple", "violeta"],
  ["marron", "brown"],
  ["beige", "sand", "arena"],
];

const GRUPO_COLOR: ReadonlyMap<string, number> = new Map(
  SINONIMOS_COLOR.flatMap((grupo, i) => grupo.map((c) => [c, i] as const)),
);

export type ContextoCasado = {
  variantes: readonly VarianteCatalogo[];
  memoria: readonly EntradaMemoria[];
};

/** Mismo color: la misma clave o sinónimos («Black» y «Negro»). Dos vacíos son el mismo (sin color). */
export function mismoColor(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = claveTexto(a);
  const kb = claveTexto(b);
  if (ka === kb) return true;
  const ga = GRUPO_COLOR.get(ka);
  return ga !== undefined && ga === GRUPO_COLOR.get(kb);
}

/** Lo que trae la línea no contradice la variante: si trae color, el mismo; si trae talla, la misma. */
function compatible(linea: LineaParaCasar, v: VarianteCatalogo): boolean {
  if (claveTexto(linea.color) !== "" && !mismoColor(linea.color, v.color)) return false;
  const talla = claveTalla(linea.talla);
  if (talla !== "" && talla !== claveTalla(v.talla)) return false;
  return true;
}

/** La línea trae un EAN válido y la variante tiene otro: es otra prenda. */
function vetadaPorEan(eanLinea: string | null, v: VarianteCatalogo): boolean {
  if (eanLinea === null) return false;
  const eanVariante = normalizarEan(v.ean);
  return eanVariante !== null && eanVariante !== eanLinea;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let comunes = 0;
  for (const p of sa) if (sb.has(p)) comunes += 1;
  return comunes / (sa.size + sb.size - comunes);
}

function palabrasLinea(l: LineaParaCasar): string[] {
  return [l.descripcion, l.marca, l.modelo, l.referencia].flatMap((t) => palabras(t));
}

function palabrasVariante(v: VarianteCatalogo): string[] {
  return [v.producto?.marca, v.producto?.referencia, v.producto?.nombre, v.nombre, v.sku].flatMap(
    (t) => palabras(t),
  );
}

/**
 * Puntos de parecido (0–100): 60 × Jaccard de las palabras, + 20 si el color
 * es el mismo y + 20 si la talla es la misma. El color y la talla solo puntúan
 * si la línea los trae.
 */
export function puntosParecido(
  linea: LineaParaCasar,
  v: VarianteCatalogo,
): { puntos: number; motivo: string } {
  const j = jaccard(palabrasLinea(linea), palabrasVariante(v));
  const color = claveTexto(linea.color) !== "" && mismoColor(linea.color, v.color);
  const talla = claveTalla(linea.talla) !== "" && claveTalla(linea.talla) === claveTalla(v.talla);
  const puntos = Math.round(60 * j) + (color ? 20 : 0) + (talla ? 20 : 0);
  const partes = [
    j > 0 ? "nombre parecido" : "",
    color ? "mismo color" : "",
    talla ? "misma talla" : "",
  ]
    .filter((p) => p !== "")
    .join(", ");
  const motivo = partes === "" ? "Nada en común" : partes[0].toUpperCase() + partes.slice(1);
  return { puntos, motivo };
}

function ordenarSugerencias(
  candidatas: readonly { v: VarianteCatalogo; puntos: number; motivo: string }[],
): Sugerencia[] {
  return [...candidatas]
    .sort(
      (a, b) =>
        b.puntos - a.puntos ||
        etiquetaVariante(a.v).localeCompare(etiquetaVariante(b.v), "es") ||
        a.v.id.localeCompare(b.v.id),
    )
    .slice(0, MAX_SUGERENCIAS)
    .map(({ v, puntos, motivo }) => ({ stock_id: v.id, puntos, motivo }));
}

/** Casa una línea con una variante del catálogo (ver el orden arriba). */
export function casarLinea(linea: LineaParaCasar, ctx: ContextoCasado): Casado {
  if (linea.tipo !== "articulo") return { estado: "no_aplica" };

  const usables = ctx.variantes.filter(utilizable);
  const porId = new Map(usables.map((v) => [v.id, v]));
  const eanLinea = normalizarEan(linea.ean);

  // 2. Memoria del proveedor.
  const clave = claveMemoria(linea);
  const entrada = clave !== "" ? ctx.memoria.find((m) => m.clave === clave) : undefined;
  if (entrada) {
    const v = porId.get(entrada.stock_id);
    if (v && !vetadaPorEan(eanLinea, v)) {
      return {
        estado: "casada",
        stock_id: v.id,
        metodo: "memoria",
        unidades_por_pack: entrada.unidades_por_pack,
      };
    }
  } else if (claveTexto(linea.referencia) === "") {
    // Memoria migrada: solo la descripción. Vale si la variante no contradice
    // el color ni la talla de la línea.
    const claveDesc = claveMemoriaDescripcion(linea.descripcion);
    const migrada =
      claveDesc !== "" && claveDesc !== clave
        ? ctx.memoria.find((m) => m.clave === claveDesc)
        : undefined;
    const v = migrada ? porId.get(migrada.stock_id) : undefined;
    if (migrada && v && compatible(linea, v) && !vetadaPorEan(eanLinea, v)) {
      return {
        estado: "casada",
        stock_id: v.id,
        metodo: "memoria",
        unidades_por_pack: migrada.unidades_por_pack,
      };
    }
  }

  // 3. EAN.
  if (eanLinea !== null) {
    const v = usables.find((x) => normalizarEan(x.ean) === eanLinea);
    if (v) return { estado: "casada", stock_id: v.id, metodo: "ean", unidades_por_pack: null };
  }

  // 4. Referencia.
  const ref = claveTexto(linea.referencia);
  if (ref !== "") {
    const porSku = usables.filter((v) => claveTexto(v.sku) === ref && compatible(linea, v));
    if (porSku.length === 1 && !vetadaPorEan(eanLinea, porSku[0])) {
      return {
        estado: "casada",
        stock_id: porSku[0].id,
        metodo: "referencia",
        unidades_por_pack: null,
      };
    }
    const porProducto = usables.filter(
      (v) =>
        claveTexto(v.producto?.referencia) === ref &&
        mismoColor(linea.color, v.color) &&
        claveTalla(linea.talla) === claveTalla(v.talla) &&
        !vetadaPorEan(eanLinea, v),
    );
    if (porProducto.length === 1) {
      return {
        estado: "casada",
        stock_id: porProducto[0].id,
        metodo: "referencia",
        unidades_por_pack: null,
      };
    }
    if (porProducto.length > 1) {
      return {
        estado: "sugerida",
        sugerencias: ordenarSugerencias(
          porProducto.map((v) => ({
            v,
            puntos: puntosParecido(linea, v).puntos,
            motivo: "Misma referencia, color y talla",
          })),
        ),
      };
    }
  }

  // 5. Parecido: solo sugiere.
  const candidatas = usables
    .filter((v) => !vetadaPorEan(eanLinea, v))
    .map((v) => {
      const j = jaccard(palabrasLinea(linea), palabrasVariante(v));
      return { v, j, ...puntosParecido(linea, v) };
    })
    .filter((c) => c.j > 0 && c.puntos >= PUNTOS_MINIMOS_SUGERENCIA);
  if (candidatas.length === 0) return { estado: "sin_casar" };
  return { estado: "sugerida", sugerencias: ordenarSugerencias(candidatas) };
}

export function casarLineas(lineas: readonly LineaParaCasar[], ctx: ContextoCasado): Casado[] {
  return lineas.map((l) => casarLinea(l, ctx));
}

/**
 * El producto (el modelo) de una línea que no casa con ninguna variante, para
 * colgar de él la variante nueva. Por orden:
 *
 *   1. el activo con la misma marca y referencia (la referencia del modelo:
 *      Gildan 5000 es la misma para todas las tallas);
 *   2. el de la variante que ya lleva esa referencia como SKU: hay
 *      proveedores que meten la talla y el color en la referencia (Roly), y
 *      entonces la referencia es de una talla, no del modelo;
 *   3. el único activo con la misma marca y el mismo nombre de modelo (otra
 *      talla de una prenda que ya está en el catálogo).
 *
 * Si no hay ninguno, null: se propone un producto nuevo. Antes se miraba solo
 * la referencia, y con Roly cada talla acababa siendo un producto distinto.
 */
export function productoParaLinea(
  linea: LineaParaCasar,
  productos: readonly ProductoTextil[],
  variantes: readonly VarianteCatalogo[] = [],
): ProductoTextil | null {
  const activos = productos.filter((p) => p.activo);
  const marca = claveTexto(linea.marca);
  const ref = claveTexto(linea.referencia);
  if (ref !== "") {
    const porReferencia = activos.find(
      (p) => claveTexto(p.referencia) === ref && claveTexto(p.marca) === marca,
    );
    if (porReferencia) return porReferencia;
    const conSku = variantes.find(
      (v) => utilizable(v) && claveTexto(v.sku) === ref && claveTexto(v.producto?.marca) === marca,
    );
    const suyo = conSku ? activos.find((p) => p.id === conSku.producto_id) : undefined;
    if (suyo) return suyo;
  }
  const nombre = claveTexto(nombreProductoDesdeLinea(linea));
  if (marca === "" || nombre === "") return null;
  const porNombre = activos.filter(
    (p) => claveTexto(p.marca) === marca && claveTexto(p.nombre) === nombre,
  );
  return porNombre.length === 1 ? porNombre[0] : null;
}

/** Nombre de producto propuesto: el modelo; si no hay, la descripción sin color, talla, marca ni referencia. */
export function nombreProductoDesdeLinea(linea: LineaParaCasar): string {
  const modelo = (linea.modelo ?? "").trim();
  if (modelo !== "") return modelo;

  const quitar = new Set(
    [linea.color, linea.marca, linea.referencia].flatMap((t) => [
      claveTexto(t),
      ...(t ?? "").split(/\s+/).map(claveTexto),
    ]),
  );
  quitar.delete("");
  const talla = claveTalla(linea.talla);
  const descripcion = (linea.descripcion ?? "").trim();
  const resto = descripcion
    .split(/\s+/)
    .filter((p) => {
      const k = claveTexto(p);
      if (k === "") return false;
      if (quitar.has(k)) return false;
      if (talla !== "" && claveTalla(p) === talla) return false;
      return true;
    })
    .join(" ")
    .trim();
  return resto !== "" ? resto : descripcion;
}

/**
 * Propuesta de variante nueva prerrellenada desde la línea (precio_venta 0,
 * cantidad_minima 0).
 *
 * La referencia de la línea va al SKU de la variante, salvo que sea la del
 * producto (la del modelo, que ya está en él). Un producto nuevo nace sin
 * referencia: no se sabe si la del proveedor es del modelo o de una talla, y
 * en el SKU sirve en los dos casos (el casado la encuentra ahí, y la siguiente
 * talla llega al modelo por ella). Así las tallas de un modelo quedan en un
 * solo producto, que se identifica por la marca y el nombre.
 */
export function nuevaVarianteDesdeLinea(
  linea: LineaParaCasar,
  productos: readonly ProductoTextil[],
  variantes: readonly VarianteCatalogo[] = [],
): NuevaVariante {
  const producto = productoParaLinea(linea, productos, variantes);
  const limpio = (t: string | null) => {
    const s = (t ?? "").trim();
    return s === "" ? null : s;
  };
  const referencia = limpio(linea.referencia);
  const delProducto =
    !!producto && referencia !== null && claveTexto(producto.referencia) === claveTexto(referencia);
  return {
    producto_id: producto?.id ?? null,
    producto: producto
      ? null
      : {
          marca: limpio(linea.marca),
          referencia: null,
          nombre: nombreProductoDesdeLinea(linea),
          categoria: null,
        },
    color: limpio(linea.color),
    talla: limpio(linea.talla),
    ean: normalizarEan(linea.ean),
    sku: delProducto ? null : referencia,
    precio_venta: 0,
    cantidad_minima: 0,
  };
}
