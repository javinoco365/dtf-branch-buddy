/**
 * Qué trae de verdad WooCommerce en los datos de una línea de pedido.
 *
 * Para saber dónde guarda el montador de DTF la longitud del trabajo hay que
 * mirar la respuesta real de la API, no la pantalla del panel de WordPress
 * (que enseña también lo que el plugin pinta con su HTML). Esto describe cada
 * meta de la línea —clave, etiqueta, tipo, el número que se lee y los nombres
 * de las propiedades si es un objeto— sin sacar valores que no hagan falta.
 *
 * El valor en crudo solo se enseña si el nombre es de una medida o un precio
 * (longitud, ancho, hojas, tamaño, unidad, precio…) y no es una dirección web:
 * en los metas de una línea puede haber nombres de ficheros, textos
 * personalizados o enlaces privados a los diseños.
 *
 * Lógica pura: sin red ni base de datos.
 */

import { normalizarTexto } from "./clientes";
import { claseDeNombre, primerNumero, type MetaWoo } from "./metros-woo";

export type MetaDescrita = {
  clave: string;
  /** La etiqueta legible (display_key) si es distinta de la clave. */
  etiqueta: string | null;
  tipo: "texto" | "número" | "sí/no" | "objeto" | "lista" | "vacío";
  /** El primer número que se lee del valor (o del valor formateado). */
  numero: number | null;
  /** Si el valor es un objeto, una lista o un JSON: sus propiedades, sin valores. */
  propiedades: string[];
  /** El valor tal cual, solo si es de una medida o un precio. */
  valor: string | null;
  /** Lo que el CRM entiende que es: facturada, hoja, hojas, precio o nada. */
  reconocido: string | null;
};

const MAX = 80;
const recortar = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);

const NOMBRE_DE_MEDIDA =
  /longitud|ancho|alto|hoja|tamano|medida|unidad|metro|precio|length|width|height|sheet|size|unit|price|rate|meter|metre/;

function tipoDe(v: unknown): MetaDescrita["tipo"] {
  if (v === null || v === undefined || v === "") return "vacío";
  if (typeof v === "number") return "número";
  if (typeof v === "boolean") return "sí/no";
  if (Array.isArray(v)) return "lista";
  if (typeof v === "object") return "objeto";
  return "texto";
}

function comoObjeto(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.trim();
    if (/^[[{]/.test(s)) {
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

/** Los nombres de las propiedades, hasta dos niveles: «sheet.length_cm». */
function propiedadesDe(objeto: unknown, prefijo = "", nivel = 0): string[] {
  if (nivel > 1 || objeto === null || typeof objeto !== "object") return [];
  const entradas = Array.isArray(objeto)
    ? objeto.slice(0, 3).map((v, i) => [`[${i}]`, v] as const)
    : Object.entries(objeto as Record<string, unknown>);
  return entradas.flatMap(([k, v]) => {
    const nombre = prefijo ? `${prefijo}.${k}` : String(k);
    const hijas = propiedadesDe(v, nombre, nivel + 1);
    return hijas.length > 0 ? hijas : [nombre];
  });
}

export function describirMetaWoo(m: MetaWoo): MetaDescrita {
  const clave = String(m.key ?? "");
  const etiquetaCruda = typeof m.display_key === "string" ? m.display_key : null;
  const etiqueta = etiquetaCruda && etiquetaCruda !== clave ? recortar(etiquetaCruda) : null;
  const objeto = comoObjeto(m.value);
  const nombres = normalizarTexto(`${clave} ${etiquetaCruda ?? ""}`).replace(/[_-]+/g, " ");
  const esMedida = NOMBRE_DE_MEDIDA.test(nombres);
  const crudo = typeof m.value === "string" || typeof m.value === "number" ? String(m.value) : null;
  const esEnlace = crudo !== null && /https?:\/\/|www\.|\.(pdf|png|zip|jpe?g|svg)\b/i.test(crudo);
  return {
    clave: recortar(clave),
    etiqueta,
    tipo: tipoDe(m.value),
    numero: objeto
      ? null
      : ((primerNumero(m.value) ?? primerNumero(m.display_value))?.valor ?? null),
    propiedades: objeto ? propiedadesDe(objeto).slice(0, 30) : [],
    valor: esMedida && crudo !== null && !esEnlace && !objeto ? recortar(crudo) : null,
    reconocido: claseDeNombre(etiquetaCruda ?? "") ?? claseDeNombre(clave),
  };
}
