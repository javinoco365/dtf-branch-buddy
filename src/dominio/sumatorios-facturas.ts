/**
 * Los totales del pie de las listas de documentos: presupuestos, facturas de
 * compra, la cola de la IA y el archivo.
 *
 * Completa a sumatorios.ts con lo propio de cada lista; las reglas comunes
 * (borradores fuera, rectificativas con su signo, canjes una vez) siguen
 * estando allí y aquí se reutilizan, no se repiten.
 *
 * Lógica pura: recibe las filas que se ven y devuelve cifras redondeadas.
 */

import type { DocArchivo } from "./archivo";
import { estadoVisible, type EstadoPresupuesto } from "./presupuestos";
import { sumarImportes, totalesDocumentos, type TotalesDocumentos } from "./sumatorios";

type Valor = number | string | null | undefined;

// ---------------------------------------------------------------------------
// Presupuestos
// ---------------------------------------------------------------------------

export type TotalesPresupuestos = {
  /** Los que suman: borradores, enviados y aceptados que siguen en plazo. */
  presupuestos: number;
  total: number;
  /** Los que se ven pero no suman. */
  rechazados: number;
  caducados: number;
};

/**
 * El pie de una lista de presupuestos. Un rechazado o uno caducado (el estado
 * que se enseña, no el guardado) ya no es una oferta viva: sumarlo con los
 * aceptados daría un «presupuestado» que nadie va a pagar. Se cuentan aparte.
 */
export function totalesPresupuestos(
  presupuestos: readonly {
    estado: EstadoPresupuesto;
    fecha: string;
    validez_dias: number;
    total: Valor;
  }[],
  hoy: Date,
): TotalesPresupuestos {
  const visibles = presupuestos.map((p) => ({ p, estado: estadoVisible(p, hoy) }));
  const cuentan = visibles.filter((v) => v.estado !== "rechazado" && v.estado !== "caducado");
  return {
    presupuestos: cuentan.length,
    total: sumarImportes(cuentan, (v) => v.p.total),
    rechazados: visibles.filter((v) => v.estado === "rechazado").length,
    caducados: visibles.filter((v) => v.estado === "caducado").length,
  };
}

// ---------------------------------------------------------------------------
// Facturas de compra
// ---------------------------------------------------------------------------

export type TotalesCompras = {
  /** Las que suman: todas menos los borradores. */
  facturas: number;
  /** Sin IVA. */
  base: number;
  /** Lo que se paga: total con IVA menos la retención. El total si no hay líquido. */
  liquido: number;
  borradores: number;
};

/**
 * El pie de la lista de facturas de compra. Un borrador no ha contado en
 * Gerencia ni en el IVA: no suma. El importe es el mismo que pinta la fila,
 * el líquido o, en las que no lo tienen, el total.
 *
 * Las borradas no se apartan aquí: la lista solo las enseña con su filtro, y
 * entonces lo que se pide es precisamente cuánto se borró.
 */
export function totalesCompras(
  compras: readonly {
    estado?: string | null;
    base?: Valor;
    liquido?: Valor;
    total?: Valor;
  }[],
): TotalesCompras {
  const cuentan = compras.filter((c) => c.estado !== "borrador");
  return {
    facturas: cuentan.length,
    base: sumarImportes(cuentan, (c) => c.base),
    liquido: sumarImportes(cuentan, (c) => c.liquido ?? c.total),
    borradores: compras.length - cuentan.length,
  };
}

export type TotalesCola = {
  /** Las que la IA leyó (aunque nadie las haya confirmado). */
  leidas: number;
  /** Lo que dicen que hay que pagar, sin confirmar. */
  total: number;
  /** Las que no se pudieron leer: no tienen importe. */
  sinLeer: number;
};

/**
 * El pie de la cola de revisión. Es lo leído por la IA, sin confirmar y con
 * posibles duplicados: no cuenta en ningún sitio, solo da idea de lo que hay
 * pendiente de registrar. Las que dieron error no tienen importe.
 */
export function totalesCola(
  compras: readonly { revision?: string | null; total?: Valor }[],
): TotalesCola {
  const leidas = compras.filter((c) => c.revision !== "error");
  return {
    leidas: leidas.length,
    total: sumarImportes(leidas, (c) => c.total),
    sinLeer: compras.length - leidas.length,
  };
}

// ---------------------------------------------------------------------------
// Archivo
// ---------------------------------------------------------------------------

export type TotalesArchivo = {
  /** Facturas emitidas, tickets y rectificativas, con las reglas de siempre. */
  ventas: TotalesDocumentos;
  /** Facturas de compra: su total es el líquido. */
  compras: { documentos: number; total: number };
};

/**
 * El pie del archivo, en dos sumas que no se mezclan: ventas y compras. Una
 * suma de las dos no significa nada (y en compras el total es el líquido, que
 * descuenta la retención, no el total con IVA de una venta).
 *
 * El archivo ya llega sin borradores ni compras borradas o sin registrar. Los
 * documentos del archivo no traen a qué ticket sustituye una factura, así que
 * aquí un canje no se puede detectar: el ticket y su factura suman los dos.
 */
export function totalesArchivo(docs: readonly DocArchivo[]): TotalesArchivo {
  const compras = docs.filter((d) => d.clase === "compra");
  const ventas = docs.filter((d) => d.clase !== "compra");
  return {
    ventas: totalesDocumentos(ventas),
    compras: { documentos: compras.length, total: sumarImportes(compras, (d) => d.total) },
  };
}
