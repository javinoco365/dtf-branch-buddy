/**
 * Las ventas de DTF UV, aparte de las de DTF.
 *
 * El DTF UV lo imprime y lo envía una subcontrata (ver linea-producto.ts): no
 * es venta de DTF. En la Facturación de una tienda no cuenta como vendido, ni
 * en la facturación, ni en los metros vendidos: va en su propia tarjeta.
 *
 * Un pedido mixto (DTF y UV juntos) va entero con el DTF, porque su importe
 * no se puede partir por líneas con los datos del pedido; sus metros sí van
 * cada uno a su sitio (`metros_total` es solo DTF). Se cuentan aparte para
 * poder avisar.
 *
 * Lógica pura: sin Supabase ni red.
 */

import { redondear } from "./importes";
import { calcularKpis, costeProduccion, ESTADO_CANCELADO, type PedidoResumen } from "./kpis";
import { esSoloUv, lineasDelPedido } from "./linea-producto";

export type PedidosPorLinea<P> = {
  /** Los de DTF, los mixtos incluidos, y los que no llevan metros. */
  dtf: P[];
  /** Los que son solo de DTF UV. */
  uv: P[];
  /** Cuántos de `dtf` llevan también UV (sin contar los cancelados). */
  mixtos: number;
};

export function separarPorLinea<P extends PedidoResumen>(
  pedidos: readonly P[],
): PedidosPorLinea<P> {
  const dtf: P[] = [];
  const uv: P[] = [];
  let mixtos = 0;
  for (const p of pedidos) {
    if (esSoloUv(p)) {
      uv.push(p);
      continue;
    }
    dtf.push(p);
    if (p.estado !== ESTADO_CANCELADO && lineasDelPedido(p) === "mixto") mixtos++;
  }
  return { dtf, uv, mixtos };
}

export type CifrasUv = {
  pedidos: number;
  metros: number;
  /** Lo vendido, con IVA y después de las devoluciones. */
  vendido: number;
  /** Sin IVA y sin envío: lo que se cobra por el UV. */
  bruta: number;
  /** Lo que cobra la subcontrata por esos metros. */
  coste: number;
  /** Bruta − coste. El envío no deja ni quita: se paga lo mismo que se cobra. */
  ganancia: number;
  /** Ganancia por metro, o 0 sin metros. */
  gananciaMetro: number;
};

/** Las cifras de unos pedidos de DTF UV (los cancelados no cuentan). */
export function cifrasUv(pedidos: readonly PedidoResumen[]): CifrasUv {
  const k = calcularKpis(pedidos);
  const validos = pedidos.filter((p) => p.estado !== ESTADO_CANCELADO);
  const metros = redondear(
    validos.reduce((s, p) => s + (Number(p.metros_uv ?? 0) || 0), 0),
    3,
  );
  const coste = costeProduccion(validos, 0);
  const ganancia = redondear(k.bruta - coste);
  return {
    pedidos: k.pedidos,
    metros,
    vendido: k.total,
    bruta: k.bruta,
    coste,
    ganancia,
    gananciaMetro: metros > 0 ? redondear(ganancia / metros) : 0,
  };
}
