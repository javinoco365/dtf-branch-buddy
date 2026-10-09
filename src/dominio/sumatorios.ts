/**
 * Los totales del pie de las tablas.
 *
 * Una fila de total tiene que decir lo mismo que las filas de encima, y lo
 * mismo en todas las pantallas. Por eso las reglas están aquí y no en cada
 * tabla:
 *
 * - Los pedidos cancelados no suman: se cuentan aparte.
 * - De los tickets y facturas, los borradores no suman; las rectificativas
 *   restan con su signo (una anulada y su rectificativa suman cero); en un
 *   canje solo cuenta la factura, para no contar la venta dos veces.
 * - Lo que tiene signo (banco, caja, inversión) se da en entradas, salidas y
 *   neto: un neto solo esconde cuánto entra y cuánto sale.
 *
 * Lógica pura: recibe las filas que se ven y devuelve cifras redondeadas.
 */

import { redondear } from "./importes";
import { resumenCobros } from "./cobros";

type Valor = number | string | null | undefined;

const num = (v: Valor) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Suma de importes, al céntimo. */
export function sumarImportes<T>(filas: readonly T[], valor: (f: T) => Valor): number {
  return redondear(filas.reduce((s, f) => s + num(valor(f)), 0));
}

/** Suma de metros o de cantidades, a tres decimales. */
export function sumarCantidades<T>(filas: readonly T[], valor: (f: T) => Valor): number {
  return redondear(
    filas.reduce((s, f) => s + num(valor(f)), 0),
    3,
  );
}

/** Lo que se suma de una lista de pedidos. */
export type TotalesPedidos = {
  /** Pedidos que cuentan: los no cancelados. */
  pedidos: number;
  cancelados: number;
  total: number;
  cobrado: number;
  /** Lo que falta por cobrar; un pedido cobrado de más cuenta como 0, como en su fila. */
  pendiente: number;
};

/**
 * El pie de una lista de pedidos (de tienda o textil). Los cancelados no
 * suman en nada: se cuentan aparte.
 */
export function totalesPedidos(
  pedidos: readonly {
    total: Valor;
    estado?: string | null;
    cancelado?: boolean;
    cobros?: readonly { importe: Valor }[] | null;
  }[],
): TotalesPedidos {
  const esCancelado = (p: (typeof pedidos)[number]) => p.cancelado ?? p.estado === "cancelado";
  const validos = pedidos.filter((p) => !esCancelado(p));
  const resumenes = validos.map((p) => resumenCobros(num(p.total), p.cobros ?? []));
  return {
    pedidos: validos.length,
    cancelados: pedidos.length - validos.length,
    total: sumarImportes(validos, (p) => p.total),
    cobrado: sumarImportes(resumenes, (r) => r.cobrado),
    pendiente: sumarImportes(resumenes, (r) => Math.max(r.pendiente, 0)),
  };
}

/** Lo que se suma de una lista de tickets, facturas y rectificativas. */
export type TotalesDocumentos = {
  /** Los que suman. */
  documentos: number;
  base: number;
  iva: number;
  total: number;
  /** Los que se ven pero no suman: borradores y tickets canjeados por factura. */
  borradores: number;
  canjeados: number;
};

/** Lo justo de un documento para saber si canjea un ticket o lo corrige una rectificativa. */
export type DocumentoCanjeable = {
  id: string;
  estado?: string | null;
  sustituye_a_id?: string | null;
  rectifica_a_id?: string | null;
};

/**
 * Los tickets de la lista que no cuentan porque los cuenta la factura que los
 * canjea. La regla de `totalesDocumentos`, aparte para que la use también el
 * IVA de Gerencia:
 *
 * - Solo canjea una factura emitida de la lista: un borrador no.
 * - Si esa factura está anulada (estado «anulada») o una rectificativa de la
 *   lista la corrige (`rectifica_a_id`), el ticket vuelve a contar, como en
 *   `documentoDelPedido`: la factura y su rectificativa suman cero.
 * - Si la factura del canje no está en la lista (otro periodo, otro filtro),
 *   el ticket cuenta.
 */
export function ticketsCanjeados(docs: readonly DocumentoCanjeable[]): Set<string> {
  const emitidos = docs.filter((d) => d.estado !== "borrador");
  // Una factura se anula con una rectificativa nueva, no cambiándole el estado.
  const rectificados = new Set(
    emitidos.flatMap((d) => (d.rectifica_a_id ? [d.rectifica_a_id] : [])),
  );
  return new Set(
    emitidos.flatMap((d) =>
      d.sustituye_a_id && d.estado !== "anulada" && !rectificados.has(d.id)
        ? [d.sustituye_a_id]
        : [],
    ),
  );
}

/**
 * El pie de una lista de documentos emitidos.
 *
 * - Un borrador no es un documento: no suma.
 * - Una rectificativa suma con su signo (la de una anulación va en negativo).
 * - Un ticket canjeado por una factura que está en la misma lista no suma: la
 *   venta ya la cuenta la factura. Si la factura del canje no está en la
 *   lista (otro periodo, otro filtro), el ticket sí suma.
 * - Si la factura del canje está anulada, es decir, una rectificativa de la
 *   lista la corrige (`rectifica_a_id`), el ticket vuelve a contar, como en
 *   `documentoDelPedido`: la factura y su rectificativa suman cero.
 *
 * Los canjes los decide `ticketsCanjeados`.
 */
export function totalesDocumentos(
  docs: readonly (DocumentoCanjeable & {
    base?: Valor;
    iva?: Valor;
    total: Valor;
  })[],
): TotalesDocumentos {
  const emitidos = docs.filter((d) => d.estado !== "borrador");
  const canjeados = ticketsCanjeados(docs);
  const cuentan = emitidos.filter((d) => !canjeados.has(d.id));
  return {
    documentos: cuentan.length,
    base: sumarImportes(cuentan, (d) => d.base),
    iva: sumarImportes(cuentan, (d) => d.iva),
    total: sumarImportes(cuentan, (d) => d.total),
    borradores: docs.length - emitidos.length,
    canjeados: emitidos.length - cuentan.length,
  };
}

/** Entradas, salidas y neto de unos importes con signo. */
export type TotalesConSigno = {
  n: number;
  /** Lo que entra (positivos). */
  entradas: number;
  /** Lo que sale, en positivo. */
  salidas: number;
  /** entradas − salidas. */
  neto: number;
};

/**
 * Para lo que tiene signo: movimientos del banco, apuntes de caja o de
 * inversión. `valor` devuelve el importe con su signo (positivo, entra).
 */
export function totalesConSigno<T>(filas: readonly T[], valor: (f: T) => Valor): TotalesConSigno {
  const importes = filas.map((f) => num(valor(f)));
  const entradas = sumarImportes(
    importes.filter((v) => v > 0),
    (v) => v,
  );
  const salidas = sumarImportes(
    importes.filter((v) => v < 0),
    (v) => -v,
  );
  return { n: filas.length, entradas, salidas, neto: redondear(entradas - salidas) };
}
