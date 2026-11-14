/**
 * Los totales del pie de las tablas de Gerencia que no cubre `sumatorios.ts`:
 * Clientes, Comercial y Fiscal.
 *
 * La regla de esta parte: cuando la pestaña ya enseña el total en una tarjeta
 * de arriba, el pie da la MISMA cifra, sacada con la misma cuenta. Si el pie
 * sumara las filas ya redondeadas, podría quedarse a un céntimo de la tarjeta
 * y parecería que una de las dos está mal. Lo que sí puede pasar es lo
 * contrario: que las filas, cada una redondeada por su lado, sumen un céntimo
 * de más o de menos que el pie. El pie es la cifra buena.
 *
 * Cuando no hay tarjeta que diga lo mismo, el pie suma las filas.
 *
 * Los porcentajes no se suman: el del pie es el del total.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { sumarImportes } from "./sumatorios";
import type { ClienteDormido, ResumenClientes } from "./clientela";
import type { Cuenta, PendientesPresupuesto } from "./comercial";

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

/** El pie de una lista de clientes: cuántos, cuántos pedidos y cuánto compraron. */
export type TotalClientes = { clientes: number; pedidos: number; vendido: number };

/**
 * El pie del ranking de clientes del periodo, de todo el ranking aunque la
 * tabla enseñe solo los primeros.
 *
 * Lo vendido es lo de los nuevos más lo de los recurrentes, las dos tarjetas
 * de arriba: cada cliente del ranking es una cosa o la otra, así que es lo
 * mismo que sumar el ranking, y así el pie cuadra con las tarjetas. Los
 * pedidos sin cliente no están en el ranking y no suman aquí.
 */
export function totalRankingClientes(
  r: Pick<ResumenClientes, "ranking" | "vendidoNuevos" | "vendidoRecurrentes">,
): TotalClientes {
  return {
    clientes: r.ranking.length,
    pedidos: r.ranking.reduce((s, c) => s + c.pedidos, 0),
    vendido: redondear(r.vendidoNuevos + r.vendidoRecurrentes),
  };
}

/**
 * El pie de los clientes dormidos: lo que compraron en toda su historia. No
 * hay tarjeta que diga lo mismo, así que suma las filas, todas, también las
 * que la tabla no enseña.
 */
export function totalDormidos(
  dormidos: readonly Pick<ClienteDormido, "pedidos" | "vendido">[],
): TotalClientes {
  return {
    clientes: dormidos.length,
    pedidos: dormidos.reduce((s, c) => s + c.pedidos, 0),
    vendido: sumarImportes(dormidos, (c) => c.vendido),
  };
}

// ---------------------------------------------------------------------------
// Comercial
// ---------------------------------------------------------------------------

/**
 * Todo lo que espera respuesta a día de hoy: los que siguen en plazo más los
 * caducados. No se solapan (un presupuesto o está en plazo o ha caducado), así
 * que se suman.
 */
export function totalEsperandoRespuesta(
  p: Pick<PendientesPresupuesto, "vigentes" | "caducados">,
): Cuenta {
  return {
    n: p.vigentes.n + p.caducados.n,
    importe: redondear(p.vigentes.importe + p.caducados.importe),
  };
}

// ---------------------------------------------------------------------------
// Fiscal
// ---------------------------------------------------------------------------

/**
 * El pie del desglose por tipo de IVA: suma las filas, porque salen del
 * desglose guardado en cada documento y no de su base y su IVA totales. Si un
 * documento tiene un desglose que no suma su base, este pie no cuadra con el
 * IVA repercutido de la tarjeta, y debe verse: es el dato el que está mal.
 */
export function totalTiposIva(filas: readonly { base: number; cuota: number }[]): {
  base: number;
  cuota: number;
} {
  return {
    base: sumarImportes(filas, (f) => f.base),
    cuota: sumarImportes(filas, (f) => f.cuota),
  };
}
