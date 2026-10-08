/**
 * Los totales del pie de las tablas de Gerencia (Producción y Resultados) que
 * no cubre `sumatorios.ts`.
 *
 * Las reglas, como allí, están aquí y no en cada tabla:
 *
 * - Los días de media y el más antiguo no se suman: el pie lleva la media de
 *   todos los pedidos (la media de las filas pesada por sus pedidos) y el
 *   máximo de las filas.
 * - Los pedidos cancelados no suman: se cuentan aparte, como en el resto de
 *   Gerencia (`calcularKpis`).
 * - En los impuestos, lo que sale a compensar (un 303 negativo) no resta de
 *   lo que hay que ingresar: se compensa en otro 303, no en el 111 ni en el
 *   115. Van por separado, como en `ImpuestosTrimestre.aPagar`.
 *
 * Lógica pura: recibe las filas que se ven y devuelve cifras redondeadas.
 */

import { redondear } from "./importes";
import { diaLocal } from "./facturacion";
import { diasDesde } from "./pendientes";
import { ESTADO_CANCELADO } from "./kpis";
import { trabajoAbierto, type FilaEstado, type PedidoTaller } from "./produccion";
import type { FilaComparada } from "./compras";
import type { ImpuestosTrimestre } from "./impuestos";
import { sumarCantidades, sumarImportes } from "./sumatorios";

/** El pie de «Ahora en el taller». */
export type TotalTaller = {
  pedidos: number;
  metros: number;
  importe: number;
  /** Días de media desde el pedido de todos los que están en el taller; nulo sin pedidos. */
  diasMedios: number | null;
  /** El que más lleva esperando, en días; nulo sin pedidos. */
  diasMaximo: number | null;
};

/**
 * El total de lo que está en el taller. Pedidos, metros e importe son la suma
 * de las filas de `trabajoAbierto`, las mismas que se ven encima.
 *
 * Los días de media se sacan de los pedidos y no de las filas: la media de
 * cada fila ya va redondeada a un decimal, y pesarlas así arrastraría ese
 * redondeo. Es la misma media ponderada, pero exacta.
 */
export function totalTaller(pedidos: readonly PedidoTaller[], hoy: Date): TotalTaller {
  const filas = trabajoAbierto(pedidos, hoy);
  const abiertos = new Set<string>(filas.map((f) => f.estado));
  const dias = pedidos
    .filter((p) => abiertos.has(p.estado))
    .map((p) => diasDesde(diaLocal(p.fecha_pedido), hoy));
  return {
    pedidos: filas.reduce((s, f) => s + f.pedidos, 0),
    metros: sumarCantidades(filas, (f) => f.metros),
    importe: sumarImportes(filas, (f) => f.importe),
    diasMedios: dias.length ? redondear(dias.reduce((s, d) => s + d, 0) / dias.length, 1) : null,
    // Con reduce y no con Math.max(...dias): no revienta la pila con muchos pedidos.
    diasMaximo: dias.length ? dias.reduce((m, d) => (d > m ? d : m), 0) : null,
  };
}

/** El pie de «Pedidos del periodo, por estado». */
export type TotalPorEstado = {
  /** Los que cuentan: todos menos los cancelados. */
  pedidos: number;
  metros: number;
  /** Los cancelados, que se ven en su fila pero no suman. */
  cancelados: number;
};

/**
 * Suma las filas de `pedidosPorEstado` sin la de los cancelados: no se
 * hicieron, y así el total cuadra con «Pedidos» y «Metros» del resto de
 * Gerencia.
 */
export function totalPorEstado(filas: readonly FilaEstado[]): TotalPorEstado {
  const cuentan = filas.filter((f) => f.estado !== ESTADO_CANCELADO);
  return {
    pedidos: cuentan.reduce((s, f) => s + f.pedidos, 0),
    metros: sumarCantidades(cuentan, (f) => f.metros),
    cancelados: filas
      .filter((f) => f.estado === ESTADO_CANCELADO)
      .reduce((s, f) => s + f.pedidos, 0),
  };
}

/** El pie de «Compras frente a lo estimado». */
export type TotalComparacion = Omit<FilaComparada, "concepto">;

/**
 * Lo comprado y lo estimado de todas las filas, y la diferencia entre los
 * dos totales, con su signo: positiva, se compra más de lo que se cuenta.
 */
export function totalComparacion(filas: readonly FilaComparada[]): TotalComparacion {
  const comprado = sumarImportes(filas, (f) => f.comprado);
  const estimado = sumarImportes(filas, (f) => f.estimado);
  return { comprado, estimado, diferencia: redondear(comprado - estimado) };
}

/** El pie de «Impuestos por trimestre». */
export type TotalImpuestos = {
  /** Lo que hay que ingresar: la suma de lo positivo de cada modelo. */
  aIngresar: number;
  /** Modelos con algo que ingresar. */
  modelosAIngresar: number;
  /** Lo que sale a compensar (303 negativos), en positivo. */
  aCompensar: number;
  /** Modelos que salen a compensar. */
  modelosACompensar: number;
};

/**
 * Lo que hay que ingresar y lo que queda a compensar en los trimestres que se
 * ven. Lo que se ingresa es la suma de `aPagar` de cada trimestre, la misma
 * cifra que la tarjeta «A Hacienda este trimestre».
 */
export function totalImpuestos(impuestos: readonly ImpuestosTrimestre[]): TotalImpuestos {
  const lineas = impuestos.flatMap((t) => t.lineas);
  const negativas = lineas.filter((l) => l.importe < 0);
  return {
    aIngresar: sumarImportes(impuestos, (t) => t.aPagar),
    modelosAIngresar: lineas.filter((l) => l.importe > 0).length,
    aCompensar: sumarImportes(negativas, (l) => -l.importe),
    modelosACompensar: negativas.length,
  };
}
