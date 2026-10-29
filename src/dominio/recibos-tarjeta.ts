/**
 * Qué compras paga cada recibo de una tarjeta de crédito.
 *
 * El banco cobra la tarjeta una vez al mes por la suma de las compras
 * (BBVA: «ADEUDO MENSUAL DE TARJETA» en la cuenta y «RECIBO MES ANTERIOR» en
 * la tarjeta). Ese par es un traspaso entre cuentas propias: no es un gasto.
 * Los gastos son las compras, que se concilian una a una con sus facturas.
 *
 * Para ver de qué compras sale cada recibo: las compras pendientes más
 * antiguas, por orden de fecha, hasta llegar al importe del recibo. Probado
 * con tres recibos reales de BBVA (agosto a octubre de 2026): cuadran al
 * céntimo los tres.
 *
 * Si el extracto empieza a mitad de un periodo, las primeras compras pueden
 * ser de un recibo que no está: se salta las más antiguas hasta que cuadre, y
 * esas quedan «sin recibo». Un recibo que no cuadra con ningún tramo se dice
 * con lo que le falta o le sobra; no se inventa el reparto.
 *
 * Lógica pura: sin base de datos ni red.
 */

export type MovimientoTarjeta = {
  id: string;
  fecha: string;
  concepto: string;
  /** Con signo: compras en negativo; recibos y devoluciones en positivo. */
  importe: number;
  /** El recibo: el abono que viene de otra cuenta propia (traspaso). */
  es_recibo: boolean;
};

export type DesgloseRecibo = {
  recibo: MovimientoTarjeta;
  /** Las compras (y devoluciones) que paga, de la más antigua a la más reciente. */
  compras: MovimientoTarjeta[];
  /** Recibo − compras, en euros. 0 si cuadra. */
  diferencia: number;
  cuadra: boolean;
};

const centimos = (n: number) => Math.round(n * 100);

const porFecha = (a: MovimientoTarjeta, b: MovimientoTarjeta) =>
  a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id);

/**
 * El desglose de todos los recibos de una tarjeta, del más antiguo al más
 * reciente. `movimientos` son los de la cuenta de la tarjeta, en cualquier
 * orden.
 */
export function desgloseRecibos(movimientos: readonly MovimientoTarjeta[]): DesgloseRecibo[] {
  const ordenados = [...movimientos].sort(porFecha);
  const recibos = ordenados.filter((m) => m.es_recibo);
  // Compras y devoluciones aún sin recibo, por orden.
  let pendientes = ordenados.filter((m) => !m.es_recibo);
  const resultado: DesgloseRecibo[] = [];

  for (const recibo of recibos) {
    const objetivo = centimos(recibo.importe);
    const antes = pendientes.filter((m) => m.fecha < recibo.fecha);
    let elegido: { desde: number; hasta: number } | null = null;
    // El tramo que cuadra empezando lo más atrás posible.
    for (let desde = 0; desde < antes.length && !elegido; desde++) {
      let suma = 0;
      for (let hasta = desde; hasta < antes.length; hasta++) {
        suma -= centimos(antes[hasta].importe);
        if (suma === objetivo) {
          elegido = { desde, hasta };
          break;
        }
      }
    }
    if (elegido) {
      const compras = antes.slice(elegido.desde, elegido.hasta + 1);
      const usados = new Set(compras.map((c) => c.id));
      pendientes = pendientes.filter((m) => !usados.has(m.id));
      resultado.push({ recibo, compras, diferencia: 0, cuadra: true });
    } else {
      // No cuadra: se enseña lo pendiente de antes del recibo, sin darlo por pagado.
      const suma = -antes.reduce((s, m) => s + centimos(m.importe), 0);
      resultado.push({
        recibo,
        compras: antes,
        diferencia: (objetivo - suma) / 100,
        cuadra: false,
      });
    }
  }
  return resultado;
}

/** El desglose de un recibo concreto, o null si no es un recibo de esos movimientos. */
export function desgloseDeRecibo(
  movimientos: readonly MovimientoTarjeta[],
  reciboId: string,
): DesgloseRecibo | null {
  return desgloseRecibos(movimientos).find((d) => d.recibo.id === reciboId) ?? null;
}
