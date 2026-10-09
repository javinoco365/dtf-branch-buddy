/**
 * El día de un pedido de tienda, el mismo en todas partes: en la lista de
 * pedidos, en sus totales por día, en el CSV, en el filtro por periodo y en
 * el ticket o la factura que se le emite.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 *
 * ## El problema
 *
 * `fecha_pedido` no guarda lo mismo en todos los pedidos (ver
 * fecha-documento.ts):
 *
 * - Los creados en el CRM guardan el instante de verdad, en UTC.
 * - Los de WooCommerce guardan la hora de la web, sin zona, grabada como si
 *   fuera UTC.
 *
 * El ticket ya lo tenía en cuenta, pero la lista agrupaba con la hora del
 * navegador: un pedido web de las 23:15 salía en el día siguiente, en otro
 * total del día y, a fin de mes, fuera del periodo, mientras su ticket
 * llevaba el día bueno.
 */

import { fechaDocumentoDePedido } from "./fecha-documento";

const ZONA = "Europe/Madrid";

/** Lo justo de un pedido para saber su día y su hora. */
export type FechaPedido = {
  fecha_pedido: string | null | undefined;
  /** `woocommerce` o `manual`. */
  origen?: string | null;
};

/** La fecha del pedido es la hora de la web guardada como si fuera UTC. */
function horaDeLaWeb(p: FechaPedido): boolean {
  return p.origen === "woocommerce";
}

/**
 * El día del pedido ('yyyy-mm-dd'), en hora de España: el mismo con el que
 * sale su ticket o su factura.
 */
export function diaDelPedido(p: FechaPedido): string {
  return fechaDocumentoDePedido(p.fecha_pedido, { horaDeLaWeb: horaDeLaWeb(p) });
}

const reloj = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * El día y la hora del pedido en el reloj de España, 'yyyy-mm-ddThh:mm:ss',
 * para ordenar los pedidos de un día: comparar `fecha_pedido` tal cual pone
 * un pedido web de las 9:00 después de uno del CRM de las 10:00 (el web lleva
 * su hora local como UTC, dos horas «más tarde»). Un pedido con solo el día,
 * o sin fecha, va a las 00:00 de su día.
 */
export function momentoDelPedido(p: FechaPedido): string {
  const dia = diaDelPedido(p);
  const texto = String(p.fecha_pedido ?? "").trim();
  const instante = new Date(texto);
  if (texto.length <= 10 || Number.isNaN(instante.getTime())) return `${dia}T00:00:00`;
  if (horaDeLaWeb(p)) return instante.toISOString().slice(0, 19);
  const partes = Object.fromEntries(reloj.formatToParts(instante).map((x) => [x.type, x.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}`;
}

/**
 * Los pedidos por su momento en el reloj de España: del más reciente al más
 * antiguo, o al revés. Los que coinciden se quedan en el orden en que venían.
 * Devuelve una lista nueva.
 */
export function ordenarPedidos<P extends FechaPedido>(
  pedidos: readonly P[],
  orden: "reciente" | "antiguo",
): P[] {
  const signo = orden === "reciente" ? -1 : 1;
  return pedidos
    .map((p) => ({ p, m: momentoDelPedido(p) }))
    .sort((a, b) => signo * (a.m < b.m ? -1 : a.m > b.m ? 1 : 0))
    .map((x) => x.p);
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Qué pedir a la base para tener todos los pedidos de los días `desde` a
 * `hasta` (los dos incluidos): `fecha_pedido >= desde` y `< hasta`.
 *
 * El día D de un pedido web cae entre las 00:00 y las 24:00 UTC de D; el de
 * uno del CRM, entre las 22:00 o las 23:00 UTC del día anterior y las 22:00 o
 * las 23:00 UTC de D. Ningún tramo UTC exacto vale para los dos, así que se
 * pide un día más por cada lado y lo que sobra se quita con `pedidoEnDias`.
 */
export function tramoDeConsulta(desde: string, hasta: string): { desde: string; hasta: string } {
  if (!DIA.test(desde) || !DIA.test(hasta)) {
    throw new Error("Las fechas del periodo tienen que ser días (aaaa-mm-dd)");
  }
  return {
    desde: `${sumarDias(desde, -1)}T00:00:00Z`,
    hasta: `${sumarDias(hasta, 2)}T00:00:00Z`,
  };
}

/** Si el día del pedido está entre `desde` y `hasta` ('yyyy-mm-dd', incluidos). */
export function pedidoEnDias(p: FechaPedido, desde: string, hasta: string): boolean {
  const dia = diaDelPedido(p);
  return dia >= desde && dia <= hasta;
}
