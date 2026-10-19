/**
 * Cuándo entra y cuándo se realiza un pedido: la hora del pedido, si entró
 * después de la hora de corte, y el día en que se realizó de verdad.
 *
 * Un pedido que entra tarde se imprime al día siguiente. Para saber los metros
 * tirados cada día cuenta el día en que se realizó (`realizado_en`: cuando
 * pasó a enviado, o la fecha de completado de WooCommerce), no el del pedido.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 */

import { diaDelPedido, momentoDelPedido, type FechaPedido } from "./dia-pedido";

/** La hora de corte de siempre: lo que entra después se hace al día siguiente. */
export const HORA_CORTE_POR_DEFECTO = "13:30";

/** 'hh:mm' de un 'hh:mm' o 'hh:mm:ss' (como llega un TIME de la base). */
export function horaCorta(hora: string | null | undefined, porDefecto = HORA_CORTE_POR_DEFECTO) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : porDefecto;
}

/**
 * La hora del pedido en el reloj de España, 'hh:mm'. Null si solo tiene día
 * (los textil) o no tiene fecha.
 */
export function horaDelPedido(p: FechaPedido): string | null {
  const texto = String(p.fecha_pedido ?? "").trim();
  if (texto.length <= 10) return null;
  const momento = momentoDelPedido(p);
  return momento.slice(11, 16) || null;
}

/** Si el pedido entró a la hora de corte o después: se hace al día siguiente. */
export function fueraDeHora(p: FechaPedido, corte: string = HORA_CORTE_POR_DEFECTO): boolean {
  const hora = horaDelPedido(p);
  return hora != null && hora >= horaCorta(corte);
}

/** El día y la hora en España de un instante guardado con zona (realizado_en). */
export function momentoDeInstante(iso: string | null | undefined): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  // Un instante con zona, como los pedidos creados en el CRM.
  return momentoDelPedido({ fecha_pedido: iso, origen: "manual" });
}

/** El día ('yyyy-mm-dd') en España en que se realizó; null si no consta. */
export function diaRealizado(realizado_en: string | null | undefined): string | null {
  if (!realizado_en || Number.isNaN(Date.parse(realizado_en))) return null;
  return diaDelPedido({ fecha_pedido: realizado_en, origen: "manual" });
}

/** Si se realizó otro día que el del pedido (lo normal con los que entran tarde). */
export function realizadoOtroDia(p: FechaPedido & { realizado_en?: string | null }): boolean {
  const dia = diaRealizado(p.realizado_en);
  return dia != null && dia !== diaDelPedido(p);
}

/**
 * Los metros realizados cada día ('yyyy-mm-dd' → metros), de los pedidos que
 * se le pasen. Cuentan también los que se cancelaron después de realizarse:
 * lo impreso, impreso está. Sin fecha de realizado, no cuentan en ningún día.
 */
export function metrosRealizadosPorDia(
  pedidos: readonly { realizado_en?: string | null; metros_total?: number | string | null }[],
): Map<string, number> {
  const porDia = new Map<string, number>();
  for (const p of pedidos) {
    const dia = diaRealizado(p.realizado_en);
    if (!dia) continue;
    const m = Number(p.metros_total ?? 0) || 0;
    porDia.set(dia, Math.round(((porDia.get(dia) ?? 0) + m) * 100) / 100);
  }
  return porDia;
}

/**
 * El instante (ISO con zona) de una hora del reloj de España escrita como
 * 'yyyy-mm-ddThh:mm' (lo que da un <input type="datetime-local">). Null si no
 * es una hora válida. En el cambio de hora de otoño, la hora repetida se toma
 * como la primera.
 */
export function instanteDeRelojEspana(reloj: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(reloj.trim());
  if (!m) return null;
  const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(comoUtc)) return null;
  // Se prueban los dos desfases de España (+2 en verano, +1 en invierno) y se
  // queda el que, leído en Madrid, da la hora escrita.
  for (const horas of [2, 1]) {
    const iso = new Date(comoUtc - horas * 3_600_000).toISOString();
    if (momentoDeInstante(iso)?.slice(0, 16) === reloj.trim()) return iso;
  }
  return null;
}
