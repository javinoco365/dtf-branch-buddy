/**
 * Los metros de cada línea de un pedido de WooCommerce.
 *
 * El montador de DTF (DTFBuild) vende cada trabajo con cantidad 1 y el precio
 * de su longitud. En el panel de WordPress la línea enseña, por ejemplo:
 *
 *   Longitud de hoja (m): 4.4
 *   Longitud facturada por trabajo (m): 4.4
 *   Precio por metro: 7,00 €
 *   Total de hojas: 1
 *
 * Pero lo que se ve en el panel NO es necesariamente lo que devuelve la API:
 * `line_items[].meta_data` solo trae los metas guardados de verdad (también los
 * ocultos, con «_»). Lo que el plugin pinta con su propio HTML o añade con un
 * filtro no llega nunca. Por eso esto no se fía de una sola forma:
 *
 *   1. Busca la longitud del trabajo en los metas, por su etiqueta legible
 *      (`display_key`) o por su clave (`key`), en español o en inglés, y
 *      dentro de valores que sean objetos o JSON. «Longitud facturada» manda;
 *      si no está, longitud de hoja × número de hojas. Por la cantidad de la
 *      línea (son copias del trabajo).
 *   2. Solo acepta esa longitud si cuadra con lo cobrado: el precio por metro
 *      que resulta (subtotal ÷ metros) tiene que parecerse al de la línea (±5 %)
 *      o, si la línea no lo trae, al configurado (entre la mitad y vez y media,
 *      por los descuentos por volumen). Así no se cuela un «175,1 m» mal leído.
 *   3. Si no hay longitud que valga y la línea es de metros, la ESTIMA: subtotal
 *      ÷ precio por metro (el de la propia línea o, si no lo trae, el de Ajustes
 *      de Gerencia). Queda marcada como estimada, con el precio usado.
 *   4. Si la línea no es de metros (textil, accesorios…), `null`: va en unidades.
 *
 * Nunca se toma la cantidad como metros: era el fallo («1 m a 12,27 €»).
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

/** De dónde salen los metros de una línea. */
export type OrigenMetros = "montador" | "precio_linea" | "precio_ajustes";

export type MedidaLinea = {
  metros: number;
  origen: OrigenMetros;
  /** El precio por metro con el que se ha estimado o comprobado, si hubo. */
  precio_metro: number | null;
};

/** Margen del precio por metro implícito frente al de la propia línea. */
const MARGEN_PRECIO_LINEA = 0.05;
/** Margen frente al precio configurado: los tramos por volumen lo bajan. */
const MINIMO_PRECIO_AJUSTES = 0.5;
const MAXIMO_PRECIO_AJUSTES = 1.5;

const ENTIDADES: Record<string, string> = {
  "&nbsp;": " ",
  "&#160;": " ",
  "&amp;": "&",
  "&euro;": "€",
  "&#8364;": "€",
  "&times;": "×",
  "&#215;": "×",
};

/** Texto plano: sin etiquetas HTML ni las entidades más comunes. */
function textoPlano(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un número escrito como sea, sin unidad: «4.4», «4,40», «1.234,5», «1,234.5». */
function aNumero(token: string): number | null {
  let s = token;
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

/**
 * El PRIMER número de un texto y su unidad de longitud si la lleva.
 * «1,75 m (mín. 1 m)» → 1,75 m. Antes se juntaban todas las cifras (175,1).
 */
export function primerNumero(
  v: unknown,
): { valor: number; unidad: "m" | "cm" | "mm" | null } | null {
  if (typeof v === "number") return Number.isFinite(v) ? { valor: v, unidad: null } : null;
  if (typeof v !== "string") return null;
  const m = textoPlano(v).match(/-?\d+(?:[.,]\d+)*(?:\s*(mm|cm|m)\b)?/i);
  if (!m) return null;
  const numero = aNumero(m[0].replace(/\s*(mm|cm|m)$/i, ""));
  if (numero === null) return null;
  const unidad = (m[1]?.toLowerCase() ?? null) as "m" | "cm" | "mm" | null;
  return { valor: numero, unidad };
}

/** El primer número de un texto, sin unidad. */
export function numeroDeTexto(v: unknown): number | null {
  return primerNumero(v)?.valor ?? null;
}

type Clase = "facturada" | "hoja" | "hojas" | "precio";

/** Qué es un dato por su nombre (etiqueta, clave o propiedad), o nada. */
export function claseDeNombre(nombre: string): Clase | null {
  const n = normalizarTexto(nombre).replace(/[_-]+/g, " ");
  if (/longitud facturada|billed length|chargeable length|length billed/.test(n)) {
    return "facturada";
  }
  if (/precio (por|x) metro|price per (meter|metre|m)\b|precio metro|rate per m/.test(n)) {
    return "precio";
  }
  if (/total de hojas|numero de hojas|\bhojas\b|total sheets|\bsheets\b|sheet count/.test(n)) {
    return "hojas";
  }
  if (/longitud( de (la )?hoja)?\b|sheet length|\blength\b/.test(n)) return "hoja";
  return null;
}

/** La unidad que dice el propio nombre: «(cm)», «_mm», «length_cm»… */
function unidadDeNombre(nombre: string): "m" | "cm" | "mm" | null {
  const n = nombre.toLowerCase();
  if (/\(mm\)|[_\s-]mm\b/.test(n)) return "mm";
  if (/\(cm\)|[_\s-]cm\b/.test(n)) return "cm";
  if (/\(m\)|[_\s-]m\b/.test(n)) return "m";
  return null;
}

const A_METROS = { m: 1, cm: 0.01, mm: 0.001 } as const;

type Hallazgo = { clase: Clase; valor: number };

/** Recorre un valor objeto/array (o JSON) buscando datos por el nombre de cada propiedad. */
function recorrer(valor: unknown, hallazgos: Hallazgo[], profundidad = 0): void {
  if (profundidad > 3 || valor === null || typeof valor !== "object") return;
  for (const [prop, v] of Object.entries(valor as Record<string, unknown>)) {
    const clase = claseDeNombre(prop);
    if (clase && (typeof v === "number" || typeof v === "string")) {
      const n = primerNumero(v);
      if (n) apuntar(hallazgos, clase, n, unidadDeNombre(prop));
    } else if (typeof v === "object") {
      recorrer(v, hallazgos, profundidad + 1);
    }
  }
}

function apuntar(
  hallazgos: Hallazgo[],
  clase: Clase,
  n: { valor: number; unidad: "m" | "cm" | "mm" | null },
  unidadNombre: "m" | "cm" | "mm" | null,
) {
  if (!(n.valor > 0)) return;
  const unidad =
    clase === "facturada" || clase === "hoja" ? (n.unidad ?? unidadNombre ?? "m") : null;
  hallazgos.push({ clase, valor: unidad ? n.valor * A_METROS[unidad] : n.valor });
}

function aObjeto(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.trim();
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }
    return null;
  }
  return v !== null && typeof v === "object" ? v : null;
}

/** Todo lo que se reconoce en los metas de una línea. */
export function datosDeMetas(metas: readonly MetaWoo[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const m of metas) {
    const nombres = [m.display_key, m.key].filter((x): x is string => typeof x === "string");
    const clase = nombres.map(claseDeNombre).find((c) => c !== null) ?? null;
    if (clase) {
      // El valor crudo primero: suele ser más preciso que el formateado.
      const n = primerNumero(m.value) ?? primerNumero(m.display_value);
      const unidadNombre = nombres.map(unidadDeNombre).find((u) => u !== null) ?? null;
      if (n) {
        apuntar(hallazgos, clase, n, unidadNombre);
        continue;
      }
    }
    const objeto = aObjeto(m.value);
    if (objeto) recorrer(objeto, hallazgos);
  }
  return hallazgos;
}

const primero = (h: Hallazgo[], clase: Clase) => h.find((x) => x.clase === clase)?.valor ?? null;

/** Una clave que delata al montador de DTF aunque no se sepa leer su valor. */
const CLAVE_MONTADOR = /dtf_?b|dtfbuild|gang|manifest/i;

/** ¿La línea se vende por metros? */
export function esLineaDeMetros(
  li: LineaWoo,
  hallazgos = datosDeMetas(li.meta_data ?? []),
): boolean {
  if (hallazgos.length > 0) return true;
  if (/\bmetros?\b|\bmetres?\b|\bmeters?\b/i.test(li.name ?? "")) return true;
  return (li.meta_data ?? []).some((m) =>
    CLAVE_MONTADOR.test(`${m.key ?? ""} ${m.display_key ?? ""}`),
  );
}

/**
 * Los metros de la línea, de dónde salen y con qué precio, o `null` si la
 * línea no es de metros o no hay forma honrada de saberlos.
 */
export function medirLineaWoo(li: LineaWoo, precioAjustes: number | null): MedidaLinea | null {
  const cantidad = numeroDeTexto(li.quantity ?? 0) ?? 0;
  const subtotal = numeroDeTexto(li.subtotal ?? 0) ?? 0;
  const hallazgos = datosDeMetas(li.meta_data ?? []);
  const precioLinea = primero(hallazgos, "precio");
  const precioRef = precioLinea ?? (precioAjustes && precioAjustes > 0 ? precioAjustes : null);

  const facturada = primero(hallazgos, "facturada");
  const hoja = primero(hallazgos, "hoja");
  const porTrabajo =
    facturada ?? (hoja !== null ? hoja * (primero(hallazgos, "hojas") ?? 1) : null);

  if (porTrabajo !== null && cantidad > 0) {
    const metros = redondear(porTrabajo * cantidad, 3);
    if (metros > 0 && cuadra(subtotal, metros, precioLinea, precioRef)) {
      return { metros, origen: "montador", precio_metro: precioLinea };
    }
  }

  if (!esLineaDeMetros(li, hallazgos)) return null;
  if (subtotal > 0 && precioRef) {
    return {
      metros: redondear(subtotal / precioRef, 3),
      origen: precioLinea !== null ? "precio_linea" : "precio_ajustes",
      precio_metro: precioRef,
    };
  }
  return null;
}

/** ¿Cuadra la longitud leída con lo cobrado? */
function cuadra(
  subtotal: number,
  metros: number,
  precioLinea: number | null,
  precioRef: number | null,
): boolean {
  if (!(subtotal > 0) || !precioRef) return true;
  const implicito = subtotal / metros;
  if (precioLinea !== null) return Math.abs(implicito / precioLinea - 1) <= MARGEN_PRECIO_LINEA;
  const r = implicito / precioRef;
  return r >= MINIMO_PRECIO_AJUSTES && r <= MAXIMO_PRECIO_AJUSTES;
}

/** La línea como la guarda el CRM: en metros si lo es, en unidades si no. */
export function lineaPedidoWoo(
  li: LineaWoo,
  precioAjustes: number | null,
): {
  cantidad: number;
  unidad: "m" | "ud";
  precio_unitario: number;
  metros_origen: OrigenMetros | null;
  precio_metro_usado: number | null;
} {
  const subtotal = numeroDeTexto(li.subtotal ?? 0) ?? 0;
  const medida = medirLineaWoo(li, precioAjustes);
  const cantidad = medida?.metros ?? numeroDeTexto(li.quantity ?? 0) ?? 0;
  return {
    cantidad,
    unidad: medida ? "m" : "ud",
    precio_unitario: cantidad > 0 ? redondear(subtotal / cantidad, 4) : 0,
    metros_origen: medida?.origen ?? null,
    precio_metro_usado: medida?.precio_metro ?? null,
  };
}

/** Metros del pedido: la suma de sus líneas de metros. */
export function metrosPedidoWoo(
  lineas: readonly LineaWoo[] | null | undefined,
  precioAjustes: number | null,
): number {
  return redondear(
    (lineas ?? []).reduce((s, li) => s + (medirLineaWoo(li, precioAjustes)?.metros ?? 0), 0),
    3,
  );
}

/** ¿Es un metro estimado (no leído del montador)? */
export const esEstimado = (origen: string | null | undefined) =>
  origen === "precio_linea" || origen === "precio_ajustes";
