/**
 * Piezas compartidas del escáner textil que no son de servidor: el aviso de la
 * migración, la comprobación de si está aplicada, el texto de los errores del
 * dominio y el paso de las líneas leídas a lo que pide el registro.
 *
 * Sin dependencias de servidor: lo importan de forma estática los
 * `*.functions.ts`, `gerencia.ts` y los componentes. Solo importación estática
 * (src/arquitectura/importaciones-mixtas.test.ts).
 */

import { faltaLaFuncion, llamarRpcConError } from "./rpc";
import { numero, numeroJusto } from "./format";
import type { LineaLeida } from "@/dominio/factura-compra";
import {
  TIPOS_LINEA_COMPRA,
  type ErrorEscaner,
  type LineaRegistro,
  type TipoLineaCompra,
} from "@/dominio/tipos-textil";

/** La primera de las tres migraciones del escáner textil. */
export const MIGRACION_ESCANER = "20261028100000";

export const AVISO_MIGRACION_ESCANER =
  "Faltan aplicar las migraciones 20261028100000, 20261028100100 y 20261028100200 " +
  "(escáner textil: esquema, datos y reglas), en ese orden. Hasta entonces, Textil › Compras " +
  "funciona como antes: casado a mano y sin repartir portes.";

/**
 * true si existe `escaner_textil_version()` (la última sentencia de la última
 * de las tres migraciones: si está, están las tres); false si falta la
 * migración. Cualquier otro error se lanza: un fallo de red o de permisos no es
 * «falta la migración».
 */
export async function escanerAplicado(cliente: unknown): Promise<boolean> {
  const { error } = await llamarRpcConError<number>(cliente, "escaner_textil_version", {});
  if (!error) return true;
  if (faltaLaFuncion(error)) return false;
  throw new Error(error.message);
}

/** La segunda (la grande) de las dos migraciones de proformas. */
export const MIGRACION_PROFORMAS = "20261029100100";

export const AVISO_MIGRACION_PROFORMAS =
  "Falta aplicar las migraciones 20261029100000 y 20261029100100 (proformas): hasta entonces no se pueden registrar proformas ni casar facturas con ellas.";

/**
 * true si existe `proformas_version()` (la última sentencia de 20261029100100:
 * si está, están las dos migraciones de proformas); false si falta. Cualquier
 * otro error se lanza: un fallo de red o de permisos no es «falta la migración».
 */
export async function proformasAplicado(cliente: unknown): Promise<boolean> {
  const { error } = await llamarRpcConError<number>(cliente, "proformas_version", {});
  if (!error) return true;
  if (faltaLaFuncion(error)) return false;
  throw new Error(error.message);
}

/** «Línea N» para una posición 0…n−1. */
const linea = (e: ErrorEscaner) => `Línea ${(e.linea ?? 0) + 1}`;

/** Un dato del error como importe (dos decimales) o como texto si ya lo es. */
const importe = (v: number | string | undefined) =>
  typeof v === "number" ? numero(v, 2) : String(v ?? "");

/** Un dato del error como cantidad, con los decimales que tenga. */
const cantidad = (v: number | string | undefined) =>
  typeof v === "number" ? numeroJusto(v, 6) : String(v ?? "");

/**
 * El texto de la tabla 1.4 del contrato para un error del dominio, con los
 * números en formato español (src/lib/format.ts). Lo usan el servidor al
 * lanzar y la interfaz al enseñar el reparto.
 */
export function mensajeErrorEscaner(e: ErrorEscaner): string {
  const d = e.datos;
  switch (e.codigo) {
    case "E-REG-8":
      return "Una factura textil necesita al menos una línea de artículo.";
    case "E-REG-9":
      return `${linea(e)}: un artículo no puede tener importe negativo; si es un abono o un descuento, márcala como descuento.`;
    case "E-REG-10":
      return `${linea(e)}: las unidades de una prenda tienen que ser enteras y mayores que cero (${cantidad(d[0])} × ${cantidad(d[1])} = ${cantidad(d[2])}).`;
    case "E-REG-13":
      return `${linea(e)}: un porte no puede ser negativo ni un descuento positivo.`;
    case "E-REG-14":
      return `Las líneas suman ${importe(d[0])} y la base dice ${importe(d[1])}: falta o sobra una línea (porte, descuento…) o hay un importe mal leído.`;
    case "E-REP-1":
      return `${linea(e)}: el descuento deja el artículo en negativo; revisa el descuento.`;
    case "E-EAN-1":
      return `${linea(e)}: el EAN ${String(d[0] ?? "")} no es válido.`;
  }
}

/** Un texto sin espacios a los lados, o nulo si queda vacío. */
export const textoONulo = (t: string | null | undefined): string | null => {
  const s = (t ?? "").trim();
  return s === "" ? null : s;
};

/** El tipo de una línea leída: sin tipo, es un artículo (como antes del escáner). */
export const tipoDe = (l: LineaLeida): TipoLineaCompra => l.tipo ?? "articulo";

/** Las unidades por pack de una línea leída: sin dato, 1. */
export const packDe = (l: LineaLeida): number => l.unidades_por_pack ?? 1;

/** Una línea tal como la recibe guardarYRegistrarCompra (sin los costes: los pone el servidor). */
export type LineaEnvio = Omit<
  LineaRegistro,
  "unidades_stock" | "coste_total_entrada" | "coste_unitario_entrada"
>;

/** Una línea de la cola (fila de textil_compra_lineas) → LineaLeida. */
export function lineaDesdeFila(l: Record<string, unknown>): LineaLeida {
  const pack = Number(l.unidades_por_pack);
  const t = l.tipo;
  const papel = l.linea_papel == null ? NaN : Number(l.linea_papel);
  return {
    descripcion: String(l.descripcion ?? ""),
    cantidad: Number(l.cantidad),
    precio_unitario: Number(l.precio_unitario),
    importe: Number(l.importe),
    unidad: (l.unidad as string | null) ?? null,
    tipo: (TIPOS_LINEA_COMPRA as readonly unknown[]).includes(t)
      ? (t as TipoLineaCompra)
      : "articulo",
    referencia: (l.referencia as string | null) ?? null,
    marca: (l.marca as string | null) ?? null,
    modelo: (l.modelo as string | null) ?? null,
    color: (l.color as string | null) ?? null,
    talla: (l.talla as string | null) ?? null,
    ean: (l.ean as string | null) ?? null,
    unidades_por_pack: Number.isFinite(pack) && pack >= 1 ? pack : 1,
    linea_papel: Number.isInteger(papel) && papel > 0 ? papel : null,
  };
}

/** La línea de la revisión de siempre (casado a mano) tal como la pide guardarYRegistrarCompra. */
export function lineaEnvioSimple(l: LineaLeida, stock_id: string | null): LineaEnvio {
  return {
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precio_unitario: l.precio_unitario,
    importe: l.importe,
    unidad: l.unidad ?? null,
    tipo: tipoDe(l),
    referencia: textoONulo(l.referencia),
    marca: textoONulo(l.marca),
    modelo: textoONulo(l.modelo),
    color: textoONulo(l.color),
    talla: textoONulo(l.talla),
    ean: textoONulo(l.ean),
    unidades_por_pack: packDe(l),
    stock_id,
    nueva_variante: null,
    casado_metodo: stock_id ? "manual" : null,
    linea_papel: l.linea_papel ?? null,
  };
}
