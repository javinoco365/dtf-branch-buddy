/**
 * Los totales del pie de las tablas del textil que no cubre `sumatorios.ts`:
 * presupuestos, el almacén y el libro de movimientos de una variante.
 *
 * Las reglas, como allí, están aquí y no en cada tabla:
 *
 * - Un presupuesto rechazado no suma: el cliente dijo que no.
 * - En el almacén, las unidades se suman tal cual se ven (también las
 *   negativas); el valor a coste cuenta como cero lo que está en negativo,
 *   porque no se puede valorar lo que no hay.
 * - En el libro de movimientos, entradas y salidas por separado: un saldo solo
 *   esconde cuánto entró y cuánto salió.
 *
 * Lógica pura: recibe las filas que se ven y devuelve cifras redondeadas.
 */

import { redondear } from "./importes";
import { sumarCantidades, sumarImportes } from "./sumatorios";

type Valor = number | string | null | undefined;

const num = (v: Valor) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Lo que se suma de una lista de presupuestos. */
export type TotalesPresupuestos = {
  /** Los que suman: todos menos los rechazados. */
  presupuestos: number;
  rechazados: number;
  total: number;
};

/**
 * El pie de una lista de presupuestos. Un rechazado no es una venta posible:
 * no suma y se cuenta aparte, para que se sepa que está en la lista.
 */
export function totalesPresupuestos(
  presupuestos: readonly { estado?: string | null; total: Valor }[],
): TotalesPresupuestos {
  const cuentan = presupuestos.filter((p) => p.estado !== "rechazado");
  return {
    presupuestos: cuentan.length,
    rechazados: presupuestos.length - cuentan.length,
    total: sumarImportes(cuentan, (p) => p.total),
  };
}

/** Lo que se suma de una lista de variantes del almacén. */
export type TotalesStock = {
  variantes: number;
  /** Unidades que hay, con su signo: una variante vendida sin existencias resta. */
  fisico: number;
  reservado: number;
  /** Físico menos reservado. */
  disponible: number;
  /** Lo que vale el almacén a precio de compra. */
  valor: number;
};

/** Lo que significa `TotalesStock.valor`, para decirlo junto a la cifra. */
export const EXPLICACION_VALOR_STOCK =
  "Lo que vale el stock a precio de compra: las unidades físicas de cada variante por su coste medio. Las variantes en negativo cuentan como cero.";

/**
 * El pie de la tabla del almacén. Suma las variantes que se le dan, sin
 * descartar las desactivadas: tiene que cuadrar con las filas que se ven
 * encima (`resumenStock()` de textil.ts, en cambio, solo cuenta las activas).
 *
 * El coste y el PVP son precios por unidad y no se suman; lo que sí tiene
 * sentido es el valor del almacén, Σ max(0, unidades) × coste medio.
 */
export function totalesStock(
  variantes: readonly {
    cantidad: Valor;
    cantidad_reservada?: Valor;
    coste_unitario: Valor;
  }[],
): TotalesStock {
  const fisico = sumarCantidades(variantes, (v) => v.cantidad);
  const reservado = sumarCantidades(variantes, (v) => v.cantidad_reservada);
  return {
    variantes: variantes.length,
    fisico,
    reservado,
    disponible: redondear(fisico - reservado, 3),
    valor: sumarImportes(variantes, (v) => Math.max(0, num(v.cantidad)) * num(v.coste_unitario)),
  };
}

/** Lo que se suma del libro de movimientos de una variante. */
export type TotalesMovimientosStock = {
  movimientos: number;
  /** Unidades que entraron (compras, devoluciones de cliente, ajustes al alza…). */
  entradas: number;
  /** Unidades que salieron, en positivo. */
  salidas: number;
  /** entradas − salidas. */
  saldo: number;
  /**
   * La lista llega cortada por el servidor: el saldo es solo el de los
   * movimientos que se ven, no las existencias de la variante.
   */
  recortada: boolean;
};

/**
 * El pie del libro de una variante. `limite` es el corte del servidor: si
 * llegan tantos movimientos como el límite, puede haber más que no se ven, y
 * el saldo deja de ser el de toda la historia.
 */
export function totalesMovimientosStock(
  movimientos: readonly { cantidad: Valor }[],
  limite?: number,
): TotalesMovimientosStock {
  const entradas = sumarCantidades(
    movimientos.filter((m) => num(m.cantidad) > 0),
    (m) => m.cantidad,
  );
  const salidas = sumarCantidades(
    movimientos.filter((m) => num(m.cantidad) < 0),
    (m) => -num(m.cantidad),
  );
  return {
    movimientos: movimientos.length,
    entradas,
    salidas,
    saldo: redondear(entradas - salidas, 3),
    recortada: limite !== undefined && movimientos.length >= limite,
  };
}
