/**
 * Del stock al pedido: variantes, productos, rejilla color × talla, disponible
 * y margen previsto.
 *
 * El disponible es físico − reservado (+ lo que reserva el propio pedido que se
 * edita, que si no se contaría dos veces). Es lo que se puede vender; el físico
 * solo dice lo que hay en la estantería.
 *
 * `aVarianteCatalogo` acepta filas de `listStock` con y sin la migración del
 * escáner (sin `producto`, `ean` ni `repetida`): la aplicación se despliega
 * antes de que se apliquen las migraciones.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { IVA_GENERAL, redondear } from "./importes";
import { porcentajeMargen } from "./margen";
import { claveTalla, claveTexto, normalizarEan } from "./normalizar-textil";
import type { LineaDocumentoTextil, ProductoTextil, VarianteCatalogo } from "./tipos-textil";

export const ORDEN_TALLAS: readonly string[] = [
  "3XS",
  "2XS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
];

function rangoTalla(k: string): number {
  if (k === "") return 4;
  if (ORDEN_TALLAS.includes(k)) return 0;
  if (/^\d+$/.test(k)) return 1;
  if (k === "UNICA") return 2;
  return 3;
}

/** Conocidas por ORDEN_TALLAS; luego números ascendentes; luego "UNICA"; luego el resto alfabético; vacías al final. */
export function compararTallas(a: string | null | undefined, b: string | null | undefined): number {
  const ka = claveTalla(a);
  const kb = claveTalla(b);
  const ra = rangoTalla(ka);
  const rb = rangoTalla(kb);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return ORDEN_TALLAS.indexOf(ka) - ORDEN_TALLAS.indexOf(kb);
  if (ra === 1) return Number(ka) - Number(kb);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

const numero = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const textoONulo = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
};

function aProducto(bruto: unknown): ProductoTextil | null {
  const o = Array.isArray(bruto) ? bruto[0] : bruto;
  if (!o || typeof o !== "object") return null;
  const p = o as Record<string, unknown>;
  if (typeof p.id !== "string") return null;
  return {
    id: p.id,
    marca: textoONulo(p.marca),
    referencia: textoONulo(p.referencia),
    nombre: typeof p.nombre === "string" ? p.nombre : "",
    categoria: textoONulo(p.categoria),
    activo: p.activo === undefined || p.activo === null ? true : Boolean(p.activo),
  };
}

/** Una fila de listStock (con o sin producto anidado, con o sin migración) → VarianteCatalogo. */
export function aVarianteCatalogo(fila: Record<string, unknown>): VarianteCatalogo {
  const producto = aProducto(fila.producto ?? fila.textil_productos);
  const activa = fila.activa ?? fila.activo;
  return {
    id: String(fila.id ?? ""),
    producto_id: textoONulo(fila.producto_id) ?? producto?.id ?? null,
    producto,
    nombre: typeof fila.nombre === "string" ? fila.nombre : "",
    sku: textoONulo(fila.sku),
    ean: textoONulo(fila.ean),
    color: textoONulo(fila.color),
    talla: textoONulo(fila.talla),
    categoria: textoONulo(fila.categoria),
    cantidad: numero(fila.cantidad),
    cantidad_reservada: numero(fila.cantidad_reservada),
    cantidad_minima: numero(fila.cantidad_minima),
    coste_unitario: numero(fila.coste_unitario),
    precio_venta: numero(fila.precio_venta),
    activa: activa === undefined || activa === null ? true : Boolean(activa),
    repetida: Boolean(fila.repetida ?? false),
  };
}

/** [marca, nombre, color, talla] sin vacíos, unidos con " · ". */
export function etiquetaVariante(v: VarianteCatalogo): string {
  return [v.producto?.marca, v.nombre, v.color, v.talla]
    .map((t) => (t ?? "").trim())
    .filter((t) => t !== "")
    .join(" · ");
}

/** Físico − reservado (+ lo que reserva el pedido que se edita). */
export function disponible(
  v: Pick<VarianteCatalogo, "cantidad" | "cantidad_reservada">,
  reservadoPropio: number = 0,
): number {
  return redondear(numero(v.cantidad) - numero(v.cantidad_reservada) + numero(reservadoPropio), 6);
}

/** Se puede casar, elegir y vender: activa y no repetida. */
export const utilizable = (v: Pick<VarianteCatalogo, "activa" | "repetida">) =>
  v.activa && !v.repetida;

export type GrupoProducto = {
  clave: string; // producto_id, o "n:" + claveTexto(nombre) sin migración
  producto_id: string | null;
  marca: string | null;
  referencia: string | null;
  nombre: string;
  variantes: VarianteCatalogo[];
  fisico: number;
  reservado: number;
  disponible: number;
};

const ordenColor = (a: string | null, b: string | null) => (a ?? "￿").localeCompare(b ?? "￿", "es");

/**
 * Las variantes agrupadas por producto, ordenadas por marca y nombre; dentro,
 * por color y talla. Sin `incluirInactivas`, fuera las desactivadas y las
 * repetidas (no se venden).
 */
export function agruparPorProducto(
  variantes: readonly VarianteCatalogo[],
  opciones: { incluirInactivas?: boolean } = {},
): GrupoProducto[] {
  const grupos = new Map<string, GrupoProducto>();
  for (const v of variantes) {
    if (!opciones.incluirInactivas && !utilizable(v)) continue;
    const clave = v.producto_id ?? `n:${claveTexto(v.nombre)}`;
    let g = grupos.get(clave);
    if (!g) {
      g = {
        clave,
        producto_id: v.producto_id,
        marca: v.producto?.marca ?? null,
        referencia: v.producto?.referencia ?? null,
        nombre: v.producto?.nombre || v.nombre,
        variantes: [],
        fisico: 0,
        reservado: 0,
        disponible: 0,
      };
      grupos.set(clave, g);
    }
    g.variantes.push(v);
  }
  const lista = [...grupos.values()];
  for (const g of lista) {
    g.variantes.sort((a, b) => ordenColor(a.color, b.color) || compararTallas(a.talla, b.talla));
    g.fisico = redondear(
      g.variantes.reduce((s, v) => s + v.cantidad, 0),
      6,
    );
    g.reservado = redondear(
      g.variantes.reduce((s, v) => s + v.cantidad_reservada, 0),
      6,
    );
    g.disponible = redondear(g.fisico - g.reservado, 6);
  }
  return lista.sort(
    (a, b) =>
      (a.marca ?? "").localeCompare(b.marca ?? "", "es") ||
      a.nombre.localeCompare(b.nombre, "es") ||
      a.clave.localeCompare(b.clave),
  );
}

function clavesDeGrupo(g: GrupoProducto): string[] {
  const claves = [g.marca, g.referencia, g.nombre].map(claveTexto);
  for (const v of g.variantes) {
    claves.push(claveTexto(v.nombre), claveTexto(v.sku), claveTexto(v.color));
  }
  return claves.filter((c) => c !== "");
}

/**
 * Por marca, referencia, nombre, SKU o color (claveTexto contiene; con varias
 * palabras, tienen que estar todas). Un EAN válido exacto pone su producto
 * primero.
 */
export function buscarProductos(grupos: readonly GrupoProducto[], texto: string): GrupoProducto[] {
  const ean = normalizarEan(texto);
  const conEan = ean
    ? grupos.filter((g) => g.variantes.some((v) => normalizarEan(v.ean) === ean))
    : [];
  const terminos = (texto ?? "")
    .split(/\s+/)
    .map(claveTexto)
    .filter((t) => t !== "");
  if (terminos.length === 0) return [...grupos];
  const porTexto = grupos.filter((g) => {
    if (conEan.includes(g)) return false;
    const claves = clavesDeGrupo(g);
    return terminos.every((t) => claves.some((c) => c.includes(t)));
  });
  return [...conEan, ...porTexto];
}

export type CeldaRejilla = {
  variante: VarianteCatalogo;
  fisico: number;
  reservado: number;
  disponible: number;
};

export type Rejilla = {
  grupo: GrupoProducto;
  colores: { clave: string; etiqueta: string }[]; // "" → "Sin color"
  tallas: { clave: string; etiqueta: string }[]; // ordenadas con compararTallas; "" → "Sin talla"
  celdas: (CeldaRejilla | null)[][]; // [color][talla]; null si no existe esa variante
};

/** La rejilla color × talla de un producto, con el disponible de cada celda. */
export function rejillaProducto(
  grupo: GrupoProducto,
  reservadoPropio?: ReadonlyMap<string, number>,
): Rejilla {
  const colores = new Map<string, string>();
  const tallas = new Map<string, string>();
  for (const v of grupo.variantes) {
    const kc = claveTexto(v.color);
    if (!colores.has(kc)) colores.set(kc, kc === "" ? "Sin color" : (v.color ?? "").trim());
    const kt = claveTalla(v.talla);
    if (!tallas.has(kt)) tallas.set(kt, kt === "" ? "Sin talla" : (v.talla ?? "").trim());
  }
  const listaColores = [...colores.entries()]
    .map(([clave, etiqueta]) => ({ clave, etiqueta }))
    .sort((a, b) =>
      a.clave === "" ? 1 : b.clave === "" ? -1 : a.etiqueta.localeCompare(b.etiqueta, "es"),
    );
  const listaTallas = [...tallas.entries()]
    .map(([clave, etiqueta]) => ({ clave, etiqueta }))
    .sort((a, b) => compararTallas(a.clave, b.clave));

  const celdas = listaColores.map((c) =>
    listaTallas.map((t) => {
      const candidatas = grupo.variantes.filter(
        (v) => claveTexto(v.color) === c.clave && claveTalla(v.talla) === t.clave,
      );
      const v = candidatas.find(utilizable) ?? candidatas[0];
      if (!v) return null;
      return {
        variante: v,
        fisico: v.cantidad,
        reservado: v.cantidad_reservada,
        disponible: disponible(v, reservadoPropio?.get(v.id) ?? 0),
      };
    }),
  );
  return { grupo, colores: listaColores, tallas: listaTallas, celdas };
}

/** Lo que reserva un pedido que se está editando, por variante (de sus líneas guardadas). */
export function reservadoPorVariante(
  items: readonly { stock_id?: string | null; cantidad: number | string }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (!it.stock_id) continue;
    const c = Number(it.cantidad);
    if (!Number.isFinite(c) || c <= 0) continue;
    m.set(it.stock_id, redondear((m.get(it.stock_id) ?? 0) + c, 6));
  }
  return m;
}

/** Una línea por variante: etiqueta, cantidad (1 o la dada), precio_venta si > 0 (si no 0), IVA 21 (IVA_GENERAL), stock_id. */
export function lineasDesdeStock(
  variantes: readonly VarianteCatalogo[],
  cantidades?: ReadonlyMap<string, number>,
): LineaDocumentoTextil[] {
  return variantes.map((v) => ({
    descripcion: etiquetaVariante(v),
    cantidad: cantidades?.get(v.id) ?? 1,
    precio_unitario: v.precio_venta > 0 ? v.precio_venta : 0,
    iva_pct: IVA_GENERAL,
    stock_id: v.id,
  }));
}

export type MargenPrevisto = {
  base: number; // base de las líneas con coste conocido
  coste: number;
  margen: number;
  porcentaje: number | null; // porcentajeMargen(margen, base) de margen.ts (un decimal; null si base 0): no se reescribe
  lineasSinCoste: number;
  baseSinCoste: number;
};

/**
 * Margen previsto de un presupuesto o pedido. coste_unitario por línea: el
 * congelado si lo tiene; si no, el de la variante (lo elige quien llama); null
 * o 0 = sin coste, y esa línea no entra en el margen (no se inventa su coste).
 */
export function margenPrevisto(
  lineas: readonly { cantidad: number; precio_unitario: number; coste_unitario: number | null }[],
): MargenPrevisto {
  let base = 0;
  let coste = 0;
  let lineasSinCoste = 0;
  let baseSinCoste = 0;
  for (const l of lineas) {
    const importe = redondear(numero(l.cantidad) * numero(l.precio_unitario));
    const cu = l.coste_unitario === null ? 0 : numero(l.coste_unitario);
    if (cu <= 0) {
      lineasSinCoste += 1;
      baseSinCoste += importe;
      continue;
    }
    base += importe;
    coste += redondear(numero(l.cantidad) * cu);
  }
  base = redondear(base);
  coste = redondear(coste);
  const margen = redondear(base - coste);
  return {
    base,
    coste,
    margen,
    porcentaje: porcentajeMargen(margen, base),
    lineasSinCoste,
    baseSinCoste: redondear(baseSinCoste),
  };
}

/**
 * Lo que se manda en `coste_unit_snapshot` para pedir a la base que deje la
 * línea SIN coste congelado (nula) al reescribirla. Lo traduce a nulo el
 * trigger `textil_item_coste_congelado` (migración 20261028100200). Ningún
 * coste real es negativo.
 */
export const SIN_COSTE_CONGELADO = -1;

/**
 * El coste congelado que se manda al reescribir una línea de un presupuesto o
 * un pedido (guardar borra las líneas y las vuelve a insertar):
 *
 * - el que traiga la línea por su posición (`porLinea`, al confirmar un
 *   presupuesto) o el que tenía la línea guardada con la misma variante;
 * - si la línea guardada con esa variante NO tenía coste (anterior a la
 *   migración, o de una variante sin coste), `SIN_COSTE_CONGELADO`, para que
 *   no tome el coste medio de hoy; solo con `conservarNulo` (el trigger que lo
 *   entiende existe), si no, nada;
 * - si es nueva, nada: el trigger le pone el coste medio de hoy.
 *
 * `undefined` = no mandar la columna. `previos` es null sin la columna.
 */
export function costeAlReescribir(
  previos: ReadonlyMap<string, number | null> | null,
  stockId: string | null | undefined,
  deLinea: number | null | undefined,
  conservarNulo: boolean,
): number | undefined {
  if (!previos || !stockId) return undefined;
  if (deLinea !== null && deLinea !== undefined) return deLinea;
  if (!previos.has(stockId)) return undefined;
  const previo = previos.get(stockId);
  if (previo !== null && previo !== undefined) return previo;
  return conservarNulo ? SIN_COSTE_CONGELADO : undefined;
}

/**
 * El producto del catálogo que ya tiene la marca y la referencia de un
 * producto nuevo pero con OTRO nombre, o null. El registro lo rechaza
 * (E-REG-26): si no, las prendas entrarían en ese otro producto y el nombre
 * escrito se perdería. Con el mismo nombre (o sin referencia) no hay choque:
 * se usa ese producto. Compara con las mismas claves que la base.
 */
export function productoQueChoca(
  productos: readonly ProductoTextil[],
  nuevo: { marca: string | null; referencia: string | null; nombre: string },
): ProductoTextil | null {
  const referencia = claveTexto(nuevo.referencia);
  if (!referencia) return null;
  const marca = claveTexto(nuevo.marca);
  const nombre = claveTexto(nuevo.nombre);
  return (
    productos.find(
      (p) =>
        claveTexto(p.marca) === marca &&
        claveTexto(p.referencia) === referencia &&
        claveTexto(p.nombre) !== nombre,
    ) ?? null
  );
}
