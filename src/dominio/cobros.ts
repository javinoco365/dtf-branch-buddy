/**
 * Cobros de los pedidos, de las tiendas y del textil.
 *
 * Un pedido se puede cobrar en varias veces —un anticipo al encargarlo, el
 * resto al recogerlo—, así que lo que importa es cuánto lleva cobrado y
 * cuánto le falta, no un «pagado sí/no». Lo recibido de más es propina, y
 * solo si se marca: no reduce lo pendiente.
 *
 * Adónde va cada cobro lo decide el método: el efectivo entra en Caja; lo
 * demás cuenta en la Facturación Consolidada.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos. Quien garantiza
 * que nunca se aplica al pedido más que lo pendiente es la base
 * (registrar_cobro, con el pedido bloqueado); aquí se calcula lo mismo para
 * enseñarlo antes de enviar.
 */

import { redondear } from "./importes";
import type { PedidoResumen } from "./kpis";

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

export type DestinoCobro = "caja" | "facturacion";

/** El efectivo va a Caja; lo demás, a la Facturación Consolidada. */
export function destinoDelCobro(metodo: MetodoCobro): DestinoCobro {
  return metodo === "efectivo" ? "caja" : "facturacion";
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

export type CobroFacturable = {
  fecha: string;
  importe: number | string;
  metodo: MetodoCobro;
  /** Nulo solo si la lectura no pudo traer el pedido; entonces no se reparte IVA. */
  pedido: { iva: number | string | null; total: number | string | null } | null;
};

/**
 * Los cobros textil que cuentan como facturación, con la forma de un pedido
 * para que la Facturación Consolidada los sume con las mismas funciones que a
 * las tiendas.
 *
 * Cada cobro cuenta como una operación: un pedido cobrado en dos veces con
 * tarjeta suma dos al número de pedidos del periodo. Se fechan por el día del
 * cobro, no del pedido, porque es cuando pasan a facturación.
 *
 * El cobro guarda un día sin hora. Se sitúa a mediodía, hora local: a
 * medianoche en UTC, un cobro del lunes caería el domingo por la noche en
 * cualquier huso por detrás de Greenwich y saltaría de semana.
 */
export function cobrosComoPedidos(cobros: readonly CobroFacturable[]): PedidoResumen[] {
  return cobros
    .filter((c) => destinoDelCobro(c.metodo) === "facturacion")
    .map((c) => {
      const { base, iva } = desglosarCobro(c.importe, c.pedido);
      return {
        fecha_pedido: `${c.fecha.slice(0, 10)}T12:00:00`,
        tienda_id: TIENDA_TEXTIL.id,
        estado: "cobrado",
        subtotal: base,
        iva,
        envio: 0,
        total: redondear(base + iva),
        metros_total: 0,
      };
    });
}
