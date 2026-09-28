/**
 * Cobros de los pedidos, de las tiendas y del textil.
 *
 * Un pedido se puede cobrar en varias veces —un anticipo al encargarlo, el
 * resto al recogerlo—, así que lo que importa es cuánto lleva cobrado y
 * cuánto le falta, no un «pagado sí/no». Lo recibido de más es propina, y
 * solo si se marca: no reduce lo pendiente.
 *
 * Todo cobro cuenta en la Facturación Consolidada, con su método para poder
 * separarlo. El efectivo, además, entra en Caja.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos. Quien garantiza
 * que nunca se aplica al pedido más que lo pendiente es la base
 * (registrar_cobro, con el pedido bloqueado); aquí se calcula lo mismo para
 * enseñarlo antes de enviar.
 */

import { redondear } from "./importes";

/** Los que se registran a mano. */
export type MetodoCobroManual = "efectivo" | "tarjeta" | "transferencia";

/**
 * Todos los que puede tener un cobro guardado: además de los manuales, el web
 * que pone la sincronización de WooCommerce y el «sin especificar» de los
 * cobros previos de los que no consta cómo se cobraron.
 */
export type MetodoCobro = MetodoCobroManual | "web" | "sin_especificar";

export const METODOS_COBRO: readonly { valor: MetodoCobroManual; etiqueta: string }[] = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "transferencia", etiqueta: "Transferencia" },
];

const ETIQUETAS_METODO: Record<MetodoCobro, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  web: "Web",
  sin_especificar: "Sin especificar",
};

export function etiquetaMetodo(metodo: MetodoCobro | string): string {
  return ETIQUETAS_METODO[metodo as MetodoCobro] ?? metodo;
}

/** El efectivo, además de contar en la Consolidada, entra en Caja. */
export function pasaPorCaja(metodo: MetodoCobro): boolean {
  return metodo === "efectivo";
}

export type EstadoCobro = "pendiente" | "parcial" | "cobrado" | "excedido";

export type ResumenCobros = {
  cobrado: number;
  /** Negativo si se ha cobrado de más: el total del pedido se bajó después. */
  pendiente: number;
  estado: EstadoCobro;
};

/** Medio céntimo: por debajo, dos importes son el mismo. */
const EPSILON = 0.005;

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/**
 * Cuánto lleva cobrado un pedido y cuánto le falta.
 *
 * `excedido` existe porque el total de un pedido se puede editar después de
 * cobrarlo: si baja por debajo de lo cobrado, hay que decirlo en vez de
 * enseñar un pendiente negativo como si fuera normal.
 *
 * La propina no cuenta: `importe` es lo aplicado al pedido, ya sin ella.
 */
export function resumenCobros(
  total: number | string | null | undefined,
  cobros: readonly { importe: number | string | null | undefined }[],
): ResumenCobros {
  const t = redondear(num(total));
  const cobrado = redondear(cobros.reduce((s, c) => s + num(c.importe), 0));
  const pendiente = redondear(t - cobrado);

  let estado: EstadoCobro;
  if (pendiente < -EPSILON) estado = "excedido";
  else if (pendiente <= EPSILON) estado = "cobrado";
  else if (cobrado > EPSILON) estado = "parcial";
  else estado = "pendiente";

  return { cobrado, pendiente, estado };
}

/**
 * Cómo se reparte lo recibido: lo que cabe en lo pendiente se aplica al
 * pedido; lo que sobra es propina. Lo mismo que hace registrar_cobro() en la
 * base, para saber antes de enviar si hay que marcar «propina».
 */
export function repartirCobro(
  recibido: number,
  pendiente: number,
): { importe: number; propina: number } {
  const r = redondear(Math.max(recibido, 0));
  const importe = redondear(Math.min(r, Math.max(redondear(pendiente), 0)));
  return { importe, propina: redondear(r - importe) };
}

/**
 * Qué parte de un cobro es base imponible y qué parte IVA.
 *
 * Un cobro parcial no dice a qué líneas corresponde, así que se reparte en la
 * misma proporción que el pedido entero. El IVA se redondea y la base es lo que
 * queda, para que base + IVA sea exactamente lo cobrado.
 */
export function desglosarCobro(
  importe: number | string,
  pedido: { iva: number | string | null; total: number | string | null } | null,
): { base: number; iva: number } {
  const i = redondear(num(importe));
  const total = num(pedido?.total);
  if (!pedido || total <= 0) return { base: i, iva: 0 };
  const iva = redondear((i * num(pedido.iva)) / total);
  return { base: redondear(i - iva), iva };
}

/** El identificador con el que el textil aparece entre las tiendas. */
export const TIENDA_TEXTIL = { id: "textil-personalizado", nombre: "Textil personalizado" };
