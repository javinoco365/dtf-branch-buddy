/**
 * Normalización del escáner textil: claves de texto, tallas, NIF, memoria y EAN.
 *
 * Replica carácter a carácter las funciones SQL de la migración
 * 20261028100000_escaner_textil_esquema.sql (`textil_clave`,
 * `textil_clave_talla`, `nif_clave`, `textil_clave_memoria`): la base y el
 * dominio tienen que normalizar igual (invariante I7 del contrato), o el casado
 * de la pantalla y el de la base no coinciden. Por eso no se usa
 * `normalize("NFD")`: se traduce con el mismo mapa de 48 caracteres que
 * `translate()` en SQL, se quita todo lo que no sea `[A-Za-z0-9]` y solo
 * después se pasa a minúsculas o mayúsculas.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { TIPOS_LINEA_COMPRA, type TipoLineaCompra } from "./tipos-textil";

/** Los 48 caracteres con acento que se traducen (el mismo orden que en SQL). */
export const ACENTOS = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
/** Su traducción, posición a posición. */
export const SIN_ACENTOS = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

const MAPA_ACENTOS: ReadonlyMap<string, string> = new Map(
  [...ACENTOS].map((c, i) => [c, SIN_ACENTOS[i]]),
);

/** `translate(coalesce(t, ''), ACENTOS, SIN_ACENTOS)` + fuera lo que no sea letra o cifra. */
function sinAdornos(t: string | null | undefined): string {
  let s = "";
  for (const c of t ?? "") s += MAPA_ACENTOS.get(c) ?? c;
  return s.replace(/[^A-Za-z0-9]/g, "");
}

/** = `textil_clave`: «  Camiseta Básica  Ñandú » → «camisetabasicanandu». */
export function claveTexto(t: string | null | undefined): string {
  return sinAdornos(t).toLowerCase();
}

const TALLAS_EQUIVALENTES: Readonly<Record<string, string>> = {
  XXS: "2XS",
  XXXS: "3XS",
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
  XXXXXL: "5XL",
  U: "UNICA",
  TU: "UNICA",
  ONESIZE: "UNICA",
  OS: "UNICA",
};

/** = `textil_clave_talla`: «xxl» → «2XL», «Talla M» → «M», «T.U.» → «UNICA», «3-4 años» → «34». */
export function claveTalla(t: string | null | undefined): string {
  const s = sinAdornos(t)
    .toUpperCase()
    .replace(/^TALLA/, "")
    .replace(/(ANOS|YEARS)$/, "");
  return TALLAS_EQUIVALENTES[s] ?? s;
}

/**
 * = `nif_clave`. NO se llama normalizarNif: ese nombre ya existe en
 * src/dominio/clientes.ts con otra regla (no quita el prefijo ES); dos
 * funciones iguales de nombre y distintas de efecto acaban importándose la que
 * no es.
 */
export function claveNif(t: string | null | undefined): string {
  const s = (t ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^ES[0-9A-Z][0-9]{7}[0-9A-Z]$/.test(s) ? s.slice(2) : s;
}

/** = `textil_clave_memoria`. Con referencia, «r:ref|color|talla»; sin ella, «d:descripción» (+ «|color|talla» si los trae). */
export function claveMemoria(l: {
  referencia: string | null | undefined;
  color: string | null | undefined;
  talla: string | null | undefined;
  descripcion: string | null | undefined;
}): string {
  const ref = claveTexto(l.referencia);
  const color = claveTexto(l.color);
  const talla = claveTalla(l.talla);
  if (ref !== "") return `r:${ref}|${color}|${talla}`;
  const desc = claveTexto(l.descripcion);
  if (desc === "") return "";
  return color !== "" || talla !== "" ? `d:${desc}|${color}|${talla}` : `d:${desc}`;
}

/**
 * La clave de solo descripción ("d:" + claveTexto(descripción)); "" si no hay.
 * Es la forma de la memoria migrada y el segundo intento del casado (2.4).
 */
export function claveMemoriaDescripcion(descripcion: string | null | undefined): string {
  const desc = claveTexto(descripcion);
  return desc === "" ? "" : `d:${desc}`;
}

/** Solo cifras; null si queda vacío. No valida. */
export function cifrasEan(t: string | null | undefined): string | null {
  const s = (t ?? "").replace(/\D/g, "");
  return s === "" ? null : s;
}

/** Dígito de control GTIN (módulo 10, pesos 3 y 1 desde la derecha). */
function controlGtinCorrecto(cifras: string): boolean {
  let suma = 0;
  const n = cifras.length;
  for (let i = 0; i < n - 1; i++) {
    const d = cifras.charCodeAt(n - 2 - i) - 48;
    suma += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (suma % 10)) % 10 === cifras.charCodeAt(n - 1) - 48;
}

/**
 * GTIN-8/12/13/14 con dígito de control correcto, en forma canónica: un UPC-A
 * de 12 cifras pasa a EAN-13 con un 0 delante y un GTIN-14 que empieza por 0
 * pierde ese 0 (es el mismo artículo y el dígito de control no cambia).
 * Devuelve 8, 13 o 14 cifras; si no vale, null.
 */
export function normalizarEan(t: string | null | undefined): string | null {
  const c = cifrasEan(t);
  if (c === null || ![8, 12, 13, 14].includes(c.length)) return null;
  if (!controlGtinCorrecto(c)) return null;
  if (c.length === 12) return `0${c}`;
  if (c.length === 14 && c.startsWith("0")) return c.slice(1);
  return c;
}

export function eanValido(t: string | null | undefined): boolean {
  return normalizarEan(t) !== null;
}

const RE_PORTE = /\b(portes?|transporte|env[ií]o|gastos de env[ií]o|shipping)\b/i;

/**
 * Tipo de línea: el que diga la IA si es válido; si no, importe < 0 →
 * descuento; /\b(portes?|transporte|env[ií]o|gastos de env[ií]o|shipping)\b/i →
 * porte; si no, articulo.
 */
export function tipoDeLinea(
  tipoLeido: unknown,
  descripcion: string,
  importe: number,
): TipoLineaCompra {
  if (typeof tipoLeido === "string") {
    const t = tipoLeido.trim().toLowerCase();
    if ((TIPOS_LINEA_COMPRA as readonly string[]).includes(t)) return t as TipoLineaCompra;
  }
  if (importe < 0) return "descuento";
  if (RE_PORTE.test(descripcion ?? "")) return "porte";
  return "articulo";
}

const ENVASES = "(?:packs?|cajas?|lotes?|bolsas?)";
const RE_PACK_DELANTE = new RegExp(`\\b${ENVASES}\\s*(?:de\\s+)?(\\d{1,4})\\b`, "i");
const RE_PACK_DETRAS = new RegExp(
  `\\b(\\d{1,4})\\s*(?:uds?|unidades|u)\\.?\\s*(?:\\/|por|x)\\s*${ENVASES}\\b`,
  "i",
);

/** «pack 5», «pack de 5», «caja 10», «lote de 12», «bolsa 5», «5 uds/pack», «10 uds por caja». null si no. */
export function packDesdeTexto(descripcion: string | null | undefined): number | null {
  const t = descripcion ?? "";
  const m = RE_PACK_DELANTE.exec(t) ?? RE_PACK_DETRAS.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** de, del, la, el, los, las, con, sin, y, en, para, por, talla, color, ud, uds */
export const STOPWORDS: readonly string[] = [
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "con",
  "sin",
  "y",
  "en",
  "para",
  "por",
  "talla",
  "color",
  "ud",
  "uds",
];

const SEPARADORES_PALABRA = /[\s/,;|()[\]+·]+/;

/** Palabras para comparar: claveTexto por palabra, sin vacías ni STOPWORDS. */
export function palabras(t: string | null | undefined): string[] {
  return (t ?? "")
    .split(SEPARADORES_PALABRA)
    .map(claveTexto)
    .filter((p) => p !== "" && !STOPWORDS.includes(p));
}
