/**
 * Qué es cada cifra de los cuadros de mando, cómo se calcula y de dónde sale.
 *
 * Es el texto del ⓘ de cada tarjeta. Vive aquí, junto a los cálculos de
 * kpis.ts y facturacion.ts, para que la explicación y la cuenta no puedan
 * contar cosas distintas: si cambia un cálculo, se cambia su definición en el
 * mismo commit.
 */

export type Definicion = {
  /** Qué significa, en una frase. */
  que: string;
  /** Cómo se calcula. */
  calculo: string;
  /** De dónde salen los datos y qué se deja fuera. */
  fuente: string;
};

const PEDIDOS_TIENDAS =
  "Pedidos de las tiendas (web y manuales) con fecha de pedido en el periodo. No incluye el textil.";

export const DEFINICIONES = {
  vendido: {
    que: "Lo vendido en el periodo, con IVA y envío.",
    calculo: "Suma del total de los pedidos no cancelados, menos lo devuelto.",
    fuente: PEDIDOS_TIENDAS,
  },
  bruta: {
    que: "Lo vendido sin IVA: la base imponible, con el envío dentro.",
    calculo:
      "Suma de la base de los pedidos no cancelados. Si un pedido tiene devoluciones, se le quita la misma proporción que se devolvió del total.",
    fuente: PEDIDOS_TIENDAS,
  },
  cobrado: {
    que: "El dinero que entró en el periodo por los pedidos, se vendieran cuando se vendieran.",
    calculo:
      "Suma de los cobros con fecha de cobro en el periodo, con IVA y sin propinas. Los pedidos de la web cuentan como cobrados al pagarse en la tienda online.",
    fuente: "Cobros de los pedidos de las tiendas. No incluye el textil ni la caja.",
  },
  margen: {
    que: "Lo que queda de la facturación bruta después del coste de producción.",
    calculo:
      "Facturación bruta − metros vendidos × coste por metro (consumibles + packaging + electricidad, de Ajustes › Datos de la empresa). Es una estimación: no incluye gastos fijos.",
    fuente: PEDIDOS_TIENDAS,
  },
  ticket: {
    que: "Lo que se vende de media en cada pedido.",
    calculo: "Vendido ÷ número de pedidos no cancelados.",
    fuente: PEDIDOS_TIENDAS,
  },
  metros: {
    que: "Metros lineales impresos vendidos.",
    calculo:
      "Suma de los metros de los pedidos no cancelados. Las devoluciones no los restan: lo impreso, impreso está.",
    fuente: PEDIDOS_TIENDAS,
  },
  pedidos: {
    que: "Cuántos pedidos se han hecho.",
    calculo: "Número de pedidos no cancelados.",
    fuente: PEDIDOS_TIENDAS,
  },
  devoluciones: {
    que: "Lo devuelto al cliente de los pedidos del periodo.",
    calculo:
      "Suma de los reembolsos, con IVA, de los pedidos no cancelados. Ya está restado de Vendido.",
    fuente: "Reembolsos de WooCommerce, que llegan al sincronizar la tienda.",
  },
  cancelados: {
    que: "Pedidos cancelados en el periodo.",
    calculo: "Número de pedidos en estado cancelado. No suman en ninguna otra cifra.",
    fuente: PEDIDOS_TIENDAS,
  },
  total_cobrado: {
    que: "Todo el dinero que entró: lo cobrado de los pedidos más las propinas.",
    calculo: "Suma de los cobros (con IVA y envíos) más sus propinas.",
    fuente:
      "Cobros de las tiendas y del textil, fechados por el pedido o por el cobro según el botón elegido.",
  },
  base_cobrada: {
    que: "La parte sin IVA de lo cobrado.",
    calculo: "Cada cobro se reparte entre base e IVA en la misma proporción que su pedido.",
    fuente: "Los mismos cobros que el total cobrado.",
  },
  iva_cobrado: {
    que: "El IVA de lo cobrado.",
    calculo: "Cada cobro se reparte entre base e IVA en la misma proporción que su pedido.",
    fuente: "Los mismos cobros que el total cobrado. Para el modelo 303 manda lo facturado.",
  },
  propinas: {
    que: "Lo que se dejó de más sobre el importe de los pedidos.",
    calculo: "Suma de las propinas apuntadas en los cobros.",
    fuente: "Cobros de las tiendas y del textil.",
  },
} as const satisfies Record<string, Definicion>;

export type ClaveDefinicion = keyof typeof DEFINICIONES;
