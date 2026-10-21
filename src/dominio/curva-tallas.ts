/**
 * El almacén textil por prenda y color, con las tallas en columnas: la «curva
 * de tallas» de la pantalla Stock.
 *
 * La tabla tenía una fila por variante: la misma camiseta en tres tallas y dos
 * colores eran seis filas, y para saber si quedaba una M había que leerlas
 * todas. Aquí cada fila es una prenda en un color, y cada talla una columna con
 * lo disponible (físico − reservado: lo que se puede prometer).
 *
 * La prenda es la marca y el nombre, no el producto. Hay proveedores que meten
 * la talla y el color en la referencia (Roly: SS643203011 es la Antartida en L
 * y blanco perla), y al registrar sus compras cada referencia ha dado un
 * producto; agrupando por producto, las seis filas seguirían siendo seis.
 *
 * Lógica pura: sin base de datos ni red.
 */

import type { TonoEstado } from "./estados";
import { redondear } from "./importes";
import { claveTalla, claveTexto } from "./normalizar-textil";
import { compararTallas } from "./stock-textil";
import type { VarianteCatalogo } from "./tipos-textil";

/** El color de una cifra de stock. Sin verde: lo normal es que haya. */
export type TonoStock = Extract<TonoEstado, "neutro" | "atencion" | "mal">;

/**
 * Rojo si hay más reservado que físico: se ha prometido lo que no hay. Ámbar
 * si lo disponible está en el mínimo o por debajo (con mínimo 0, si no queda
 * nada libre): hay que reponer antes de prometer más. Es el mismo corte que el
 * filtro «Solo poco stock».
 *
 * Tenerlo todo reservado para pedidos no es un error, así que no es rojo.
 */
export function tonoStock(disponibleTalla: number, minimo: number): TonoStock {
  if (disponibleTalla < 0) return "mal";
  if (disponibleTalla <= minimo) return "atencion";
  return "neutro";
}

const PESO_TONO: Record<TonoStock, number> = { neutro: 0, atencion: 1, mal: 2 };

/** Una talla de una fila: sus variantes (una, o más si hay repetidas sin fusionar) y sus cifras. */
export type CasillaTalla = {
  variantes: VarianteCatalogo[];
  fisico: number;
  reservado: number;
  disponible: number;
  /** El mínimo más alto de sus variantes: dos fichas de la misma talla no suman dos mínimos. */
  minimo: number;
  tono: TonoStock;
};

export type FilaCurva = {
  clave: string;
  marca: string | null;
  nombre: string;
  /** Tal como está escrito; null si las variantes no llevan color. */
  color: string | null;
  /** La referencia del producto, si todas las variantes llevan la misma. */
  referencia: string | null;
  /** La categoría, si todas las variantes llevan la misma. */
  categoria: string | null;
  /**
   * Todas sus variantes, por talla, también las desactivadas: el detalle las
   * enseña con sus botones. Una desactivada sin unidades no cuenta en las
   * casillas, para no abrir una columna de una talla que ya no se trabaja.
   */
  variantes: VarianteCatalogo[];
  /** Clave de talla → casilla, solo las tallas que tiene. */
  casillas: Map<string, CasillaTalla>;
  fisico: number;
  reservado: number;
  disponible: number;
  /** El peor tono de sus casillas. */
  tono: TonoStock;
  /** El coste por unidad: el más bajo y el más alto (iguales si cuestan lo mismo). */
  coste: { min: number; max: number } | null;
};

export type ColumnaTalla = { clave: string; etiqueta: string };

export type CurvaTallas = {
  /** Las tallas que salen en alguna fila, en orden: XS…5XL, niño, única, sin talla. */
  tallas: ColumnaTalla[];
  filas: FilaCurva[];
};

/** Cuenta en las casillas: activa, o desactivada pero con unidades o reservas. */
const cuentaEnCurva = (v: VarianteCatalogo) =>
  v.activa || v.cantidad !== 0 || v.cantidad_reservada !== 0;

const nombreDe = (v: VarianteCatalogo) =>
  (v.producto?.nombre ?? "").trim() || v.nombre.trim() || "Sin nombre";

const textoONulo = (t: string | null | undefined) => {
  const s = (t ?? "").trim();
  return s === "" ? null : s;
};

/** El valor si todas las variantes llevan el mismo (por su clave); si no, null. */
function comun(
  variantes: readonly VarianteCatalogo[],
  leer: (v: VarianteCatalogo) => string | null | undefined,
): string | null {
  const primero = textoONulo(leer(variantes[0]));
  if (primero === null) return null;
  const clave = claveTexto(primero);
  return variantes.every((v) => claveTexto(leer(v)) === clave) ? primero : null;
}

const suma = (variantes: readonly VarianteCatalogo[], leer: (v: VarianteCatalogo) => number) =>
  redondear(
    variantes.reduce((s, v) => s + leer(v), 0),
    6,
  );

function casilla(variantes: VarianteCatalogo[]): CasillaTalla {
  const fisico = suma(variantes, (v) => v.cantidad);
  const reservado = suma(variantes, (v) => v.cantidad_reservada);
  const libre = redondear(fisico - reservado, 6);
  const minimo = Math.max(...variantes.map((v) => v.cantidad_minima));
  return {
    variantes,
    fisico,
    reservado,
    disponible: libre,
    minimo,
    tono: tonoStock(libre, minimo),
  };
}

function ordenVariantes(a: VarianteCatalogo, b: VarianteCatalogo): number {
  return (
    compararTallas(a.talla, b.talla) ||
    Number(b.activa) - Number(a.activa) ||
    Number(a.repetida) - Number(b.repetida) ||
    a.id.localeCompare(b.id)
  );
}

function fila(clave: string, variantes: VarianteCatalogo[]): FilaCurva {
  variantes.sort(ordenVariantes);
  const porTalla = new Map<string, VarianteCatalogo[]>();
  for (const v of variantes) {
    if (!cuentaEnCurva(v)) continue;
    const k = claveTalla(v.talla);
    const lista = porTalla.get(k);
    if (lista) lista.push(v);
    else porTalla.set(k, [v]);
  }
  const casillas = new Map([...porTalla].map(([k, vs]) => [k, casilla(vs)]));
  const cuentan = variantes.filter(cuentaEnCurva);
  const costes = cuentan.map((v) => v.coste_unitario);
  const fisico = suma(variantes, (v) => v.cantidad);
  const reservado = suma(variantes, (v) => v.cantidad_reservada);
  let tono: TonoStock = "neutro";
  for (const c of casillas.values()) if (PESO_TONO[c.tono] > PESO_TONO[tono]) tono = c.tono;
  return {
    clave,
    marca: comun(variantes, (v) => v.producto?.marca),
    nombre: nombreDe(variantes[0]),
    color: comun(variantes, (v) => v.color),
    referencia: comun(variantes, (v) => v.producto?.referencia),
    categoria: comun(variantes, (v) => v.categoria ?? v.producto?.categoria),
    variantes,
    casillas,
    fisico,
    reservado,
    disponible: redondear(fisico - reservado, 6),
    tono,
    coste: costes.length > 0 ? { min: Math.min(...costes), max: Math.max(...costes) } : null,
  };
}

/** Por nombre, marca y color; sin color, al final. */
function ordenFilas(a: FilaCurva, b: FilaCurva): number {
  return (
    a.nombre.localeCompare(b.nombre, "es") ||
    (a.marca ?? "").localeCompare(b.marca ?? "", "es") ||
    (a.color === null ? 1 : 0) - (b.color === null ? 1 : 0) ||
    (a.color ?? "").localeCompare(b.color ?? "", "es") ||
    a.clave.localeCompare(b.clave)
  );
}

/**
 * Las columnas de talla de las filas que se ven, en orden. Cada una se llama
 * como la escriben más variantes: si casi todas dicen «XXL», la columna dice
 * «XXL» aunque alguna diga «2XL» (es la misma talla).
 */
function columnas(filas: readonly FilaCurva[]): ColumnaTalla[] {
  const nombres = new Map<string, Map<string, number>>();
  for (const f of filas) {
    for (const [k, c] of f.casillas) {
      const cuenta = nombres.get(k) ?? new Map<string, number>();
      for (const v of c.variantes) {
        const etiqueta = (v.talla ?? "").trim();
        cuenta.set(etiqueta, (cuenta.get(etiqueta) ?? 0) + 1);
      }
      nombres.set(k, cuenta);
    }
  }
  return [...nombres]
    .map(([clave, cuenta]) => {
      let etiqueta = "";
      let veces = 0;
      for (const [e, n] of cuenta) {
        if (n > veces) {
          etiqueta = e;
          veces = n;
        }
      }
      return { clave, etiqueta: clave === "" ? "Sin talla" : etiqueta };
    })
    .sort((a, b) => compararTallas(a.clave, b.clave));
}

/**
 * Las variantes en filas de prenda (marca y nombre) y color, con una casilla
 * por talla. `quedarse` decide qué filas se ven (búsqueda, «poco stock»); las
 * columnas salen solo de esas.
 */
export function curvaDeTallas(
  variantes: readonly VarianteCatalogo[],
  quedarse: (fila: FilaCurva) => boolean = () => true,
): CurvaTallas {
  const grupos = new Map<string, VarianteCatalogo[]>();
  for (const v of variantes) {
    const clave = [v.producto?.marca, nombreDe(v), v.color].map(claveTexto).join("|");
    const lista = grupos.get(clave);
    if (lista) lista.push(v);
    else grupos.set(clave, [v]);
  }
  const filas = [...grupos]
    .map(([clave, vs]) => fila(clave, vs))
    .filter(quedarse)
    .sort(ordenFilas);
  return { tallas: columnas(filas), filas };
}
