/**
 * La cola de facturas recibidas: lo que lee la IA, si se puede creer y si
 * está repetido.
 *
 * La IA propone y la persona confirma. Por eso aquí:
 *
 *   - La salida de la IA se valida contra un esquema antes de guardarla. Si
 *     no valida, se reintenta una vez; si sigue sin validar, la factura queda
 *     en la cola como error, visible y con el motivo. Nunca a medias ni en
 *     silencio.
 *   - Se escribe por qué hay que mirar cada factura: dudas de la IA, poca
 *     confianza, cuentas que no cuadran, tipo de IVA que no se deduce o un
 *     posible duplicado.
 *   - Los duplicados se buscan en tres niveles, de más seguro a menos: el
 *     mismo fichero, la misma factura (proveedor y número) y la que tiene el
 *     mismo proveedor, fecha e importe.
 *
 * Las claves se normalizan igual que en la base (20261015100000_compras_cola).
 *
 * Lógica pura: se prueba sin base de datos ni red.
 */

import { z } from "zod";
import { redondear } from "./importes";
import { CATEGORIAS_COMPRA } from "./compras";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// Claves: «F-0123» y «f 0123» son la misma factura
// ---------------------------------------------------------------------------

// Igual que la base: fuera todo lo que no sea letra sin acento o cifra.
const limpiar = (t: string | null | undefined) =>
  (t ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** El NIF sin adornos; sin NIF, el nombre del proveedor. */
export function claveProveedor(
  nif: string | null | undefined,
  proveedor: string | null | undefined,
) {
  return limpiar(nif) || limpiar(proveedor);
}

export const claveNumero = (numero: string | null | undefined) => limpiar(numero);

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------

/** Lo justo de una compra para buscar duplicados. */
export type CompraComparable = {
  id?: string;
  proveedor?: string | null;
  nif_proveedor?: string | null;
  numero?: string | null;
  fecha?: string | null;
  /** El líquido (o, sin él, el total). */
  liquido?: Numerico;
  total?: Numerico;
  fichero_huella?: string | null;
  estado?: string | null;
  borrada_en?: string | null;
};

export type NivelDuplicado = "archivo" | "factura" | "probable";

export type Duplicado = {
  nivel: NivelDuplicado;
  de: CompraComparable;
  /** La otra está borrada: se avisa, pero no impide nada. */
  borrada: boolean;
};

const importe = (c: CompraComparable) => num(c.liquido ?? c.total);

/**
 * Las otras compras que parecen la misma, la más segura primero. Cada otra
 * sale una vez, con su nivel más alto.
 */
export function duplicadosDe(c: CompraComparable, otras: readonly CompraComparable[]): Duplicado[] {
  const proveedor = claveProveedor(c.nif_proveedor, c.proveedor);
  const numero = claveNumero(c.numero);
  const encontrados: Duplicado[] = [];
  for (const o of otras) {
    if (o.id && o.id === c.id) continue;
    const borrada = !!o.borrada_en;
    const mismoProveedor =
      proveedor !== "" && claveProveedor(o.nif_proveedor, o.proveedor) === proveedor;
    let nivel: NivelDuplicado | null = null;
    if (c.fichero_huella && o.fichero_huella === c.fichero_huella) nivel = "archivo";
    else if (mismoProveedor && numero !== "" && claveNumero(o.numero) === numero) nivel = "factura";
    else if (
      mismoProveedor &&
      c.fecha &&
      o.fecha === c.fecha &&
      Math.abs(redondear(importe(o) - importe(c))) < 0.01
    )
      nivel = "probable";
    if (nivel) encontrados.push({ nivel, de: o, borrada });
  }
  const orden: Record<NivelDuplicado, number> = { archivo: 0, factura: 1, probable: 2 };
  return encontrados.sort(
    (a, b) => orden[a.nivel] - orden[b.nivel] || Number(a.borrada) - Number(b.borrada),
  );
}

/** El aviso de un duplicado, para la persona. */
export function avisoDuplicado(d: Duplicado): string {
  const cual = [
    d.de.proveedor,
    d.de.numero && `n.º ${d.de.numero}`,
    d.de.fecha && `del ${d.de.fecha}`,
  ]
    .filter(Boolean)
    .join(" ");
  if (d.borrada) return `Ya la subiste y la borraste: ${cual}.`;
  if (d.nivel === "archivo") return `Este fichero ya está subido: ${cual}.`;
  if (d.nivel === "factura")
    return `Esta factura ya está ${d.de.estado === "registrada" ? "registrada" : "en la cola"}: ${cual}.`;
  return `Posible duplicado de ${cual} (mismo proveedor, fecha e importe).`;
}

/**
 * Si un duplicado impide registrar: la misma factura (o el mismo fichero) ya
 * registrada y sin borrar. La base también lo impide.
 */
export const bloqueaRegistro = (d: Duplicado) =>
  !d.borrada && d.nivel !== "probable" && d.de.estado === "registrada";

// ---------------------------------------------------------------------------
// La lectura de la IA, validada
// ---------------------------------------------------------------------------

/** Por debajo de esta confianza, la IA no se cree a sí misma: hay que mirarla. */
export const UMBRAL_CONFIANZA = 0.85;

const texto = z.string().nullable();

/**
 * Lo que tiene que devolver la IA. Los importes van como texto, tal como
 * están escritos en la factura («1.234,56»): los convierte el dominio
 * (factura-compra.ts), no el modelo.
 */
export const esquemaLectura = z.object({
  proveedor: texto,
  nif_proveedor: texto,
  numero: texto,
  fecha: texto,
  concepto: texto,
  categoria: z.enum(CATEGORIAS_COMPRA.map((c) => c.valor) as [string, ...string[]]).nullable(),
  base: texto,
  iva: texto,
  irpf: texto,
  total: texto,
  confianza: z.number().min(0).max(1),
  dudas: z.array(z.string()),
  lineas: z.array(
    z.object({
      descripcion: z.string(),
      cantidad: texto,
      unidad: texto,
      precio_unitario: texto,
      importe: texto,
    }),
  ),
});

export type LecturaIa = z.infer<typeof esquemaLectura>;

const tOn = { anyOf: [{ type: "string" }, { type: "null" }] };

/**
 * El mismo esquema en JSON Schema, para pedírselo a la API (salida
 * estructurada). Los rangos (confianza de 0 a 1) no se pueden expresar ahí:
 * los comprueba `validarLectura`.
 */
export const ESQUEMA_LECTURA_JSON = {
  type: "object",
  additionalProperties: false,
  required: [
    "proveedor",
    "nif_proveedor",
    "numero",
    "fecha",
    "concepto",
    "categoria",
    "base",
    "iva",
    "irpf",
    "total",
    "confianza",
    "dudas",
    "lineas",
  ],
  properties: {
    proveedor: tOn,
    nif_proveedor: tOn,
    numero: tOn,
    fecha: tOn,
    concepto: tOn,
    categoria: {
      anyOf: [{ type: "string", enum: CATEGORIAS_COMPRA.map((c) => c.valor) }, { type: "null" }],
    },
    base: tOn,
    iva: tOn,
    irpf: tOn,
    total: tOn,
    confianza: { type: "number" },
    dudas: { type: "array", items: { type: "string" } },
    lineas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["descripcion", "cantidad", "unidad", "precio_unitario", "importe"],
        properties: {
          descripcion: { type: "string" },
          cantidad: tOn,
          unidad: tOn,
          precio_unitario: tOn,
          importe: tOn,
        },
      },
    },
  },
} as const;

/** Valida la salida de la IA. Si no vale, dice por qué, en castellano. */
export function validarLectura(
  bruto: unknown,
): { ok: true; lectura: LecturaIa } | { ok: false; error: string } {
  const r = esquemaLectura.safeParse(bruto);
  if (r.success) return { ok: true, lectura: r.data };
  const primero = r.error.issues[0];
  const donde = primero?.path.join(".") || "la respuesta";
  // Los mensajes de zod vienen en inglés: aquí, en castellano.
  const que =
    primero?.code === "invalid_type"
      ? primero.received === "undefined"
        ? "falta"
        : "no es del tipo esperado"
      : primero?.code === "too_big" || primero?.code === "too_small"
        ? "está fuera de rango"
        : primero?.code === "invalid_enum_value"
          ? "no es un valor permitido"
          : "no es válido";
  return { ok: false, error: `La lectura no tiene la forma esperada: ${donde} ${que}.` };
}

// ---------------------------------------------------------------------------
// Por qué hay que mirar una factura
// ---------------------------------------------------------------------------

/**
 * Los motivos para revisar una factura leída. Vacío no significa «buena»:
 * toda factura de la cola la confirma una persona. Significa que no hay
 * nada en especial que mirar.
 */
export function motivosRevision(d: {
  confianza: number;
  dudas: readonly string[];
  avisos: readonly { linea: number | null; mensaje: string }[];
  /** Nulo si ningún tipo de IVA explica la cuota leída. */
  tipoIva: number | null;
  categoria: string | null;
  duplicados: readonly Duplicado[];
}): string[] {
  const motivos: string[] = [];
  for (const dup of d.duplicados) motivos.push(avisoDuplicado(dup));
  if (d.confianza < UMBRAL_CONFIANZA) {
    motivos.push(
      `La IA no está segura de su lectura (confianza ${Math.round(d.confianza * 100)} %).`,
    );
  }
  for (const duda of d.dudas) if (duda.trim()) motivos.push(`La IA duda: ${duda.trim()}`);
  for (const a of d.avisos)
    motivos.push(a.linea === null ? a.mensaje : `Línea ${a.linea + 1}: ${a.mensaje}`);
  if (d.tipoIva === null)
    motivos.push("El IVA leído no cuadra con ningún tipo: elige el tipo a mano.");
  if (!d.categoria) motivos.push("La IA no sabe qué es: elige la categoría.");
  return motivos;
}

/**
 * Los avisos de la aritmética que importan según lo que se compra: sin
 * líneas solo es raro en el textil, que las necesita para el stock.
 */
export function avisosQueImportan<T extends { linea: number | null; mensaje: string }>(
  avisos: readonly T[],
  categoria: string | null | undefined,
): T[] {
  if (categoria === "textil" || !categoria) return [...avisos];
  return avisos.filter((a) => !(a.linea === null && a.mensaje === MENSAJE_SIN_LINEAS));
}

/** El aviso de `revisarCompra` cuando no hay líneas. */
export const MENSAJE_SIN_LINEAS = "No se ha leído ninguna línea.";
