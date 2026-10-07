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

const GERENCIA_PEDIDOS =
  "Pedidos de las tiendas (web y manuales) y del textil con fecha de pedido en el periodo, con los filtros de tienda y canal.";

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
      "Facturación bruta − metros vendidos × coste por metro (consumibles + packaging + electricidad). Cada pedido usa el coste que había en Ajustes › Datos de la empresa al crearse, así que cambiar el coste no altera el margen de meses pasados. Es una estimación: no incluye gastos fijos.",
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

  // --- Gerencia: tiendas y textil, con los filtros de arriba ---------------
  g_vendido: {
    que: "Lo vendido en el periodo, con IVA y envío, en tiendas y textil.",
    calculo:
      "Suma del total de los pedidos no cancelados, menos lo devuelto. Los pedidos web sin pagar cuentan o no según lo elegido en Gerencia › Ajustes; eso vale para todas las cifras de pedidos de Gerencia.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_cobrado: {
    que: "El dinero que entró en el periodo por los pedidos, se vendieran cuando se vendieran.",
    calculo:
      "Suma de los cobros con fecha de cobro en el periodo, con IVA y sin propinas. Los pedidos web cuentan como cobrados al pagarse en la tienda online.",
    fuente: "Cobros de tiendas y textil, con los filtros de tienda y canal. Sin la caja.",
  },
  g_pendiente: {
    que: "Lo que los clientes deben hoy, sea del periodo que sea.",
    calculo: "Por cada pedido no cancelado: total − cobrado, si queda algo.",
    fuente:
      "Todos los pedidos de tiendas y textil con algo por cobrar. No depende del periodo elegido: es la foto de hoy.",
  },
  g_margen: {
    que: "Lo que queda de lo vendido en DTF después del coste de producción.",
    calculo:
      "Facturación bruta − metros × coste por metro congelado en cada pedido. El textil todavía no tiene coste en el CRM: su margen aquí es su bruta. No incluye gastos fijos: eso es el beneficio estimado.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_beneficio: {
    que: "Lo que queda del margen después de pagar los gastos fijos del periodo.",
    calculo:
      "Margen estimado − gastos fijos. Cada gasto fijo, que se apunta al mes y sin IVA, se reparte por los días del periodo en que está vigente: medio mes de un alquiler de 800 € son 400 €. Si el periodo está en curso, solo cuentan los días hasta hoy, igual que las ventas.",
    fuente:
      "Pedidos de tiendas y textil del periodo y los gastos fijos de Gerencia › Ajustes. Solo sin filtros de tienda ni canal: los gastos fijos son de toda la empresa. Sin impuestos sobre beneficios.",
  },
  g_objetivo_vendido: {
    que: "Cuánto se lleva vendido frente al objetivo del periodo.",
    calculo:
      "Vendido ÷ objetivo de ventas. El objetivo, que se pone al mes, se reparte por días: el periodo de una quincena tiene la mitad del objetivo del mes. «A este ritmo» compara con lo que tocaría llevar hoy si se vendiera lo mismo cada día.",
    fuente:
      "Objetivos de Gerencia › Ajustes y pedidos del periodo. Solo sin filtros de tienda ni canal: el objetivo es de toda la empresa.",
  },
  g_objetivo_metros: {
    que: "Cuántos metros se llevan vendidos frente al objetivo del periodo.",
    calculo:
      "Metros vendidos ÷ objetivo de metros. El objetivo, que se pone al mes, se reparte por días, igual que el de ventas.",
    fuente:
      "Objetivos de Gerencia › Ajustes y pedidos del periodo. Solo sin filtros de tienda ni canal: el objetivo es de toda la empresa.",
  },
  g_pedidos: {
    que: "Cuántos pedidos se han hecho.",
    calculo: "Número de pedidos no cancelados.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_ticket: {
    que: "Lo que se vende de media en cada pedido.",
    calculo: "Vendido ÷ número de pedidos no cancelados.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_metros: {
    que: "Metros lineales impresos vendidos.",
    calculo: "Suma de los metros de los pedidos no cancelados. El textil no lleva metros.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_euro_metro: {
    que: "A cuánto se vende de media el metro, sin IVA.",
    calculo:
      "Facturación bruta de los pedidos que llevan metros ÷ sus metros. Incluye lo que vaya en esos pedidos además del metro (diseño, envío).",
    fuente: GERENCIA_PEDIDOS,
  },
  g_dias_cobro: {
    que: "Cuánto se tarda de media en cobrar un pedido.",
    calculo:
      "Días del pedido al cobro, de los cobros del periodo, pesando cada uno por su importe. Los de la web cuentan con 0 días.",
    fuente: "Cobros de tiendas y textil del periodo, con los filtros de tienda y canal.",
  },
  g_caja: {
    que: "Lo que entró y salió en efectivo en el periodo.",
    calculo: "Ingresos − gastos de los apuntes de caja del periodo.",
    fuente: "Libro de caja. No se filtra por tienda ni por canal: la caja es de toda la empresa.",
  },
  g_banco: {
    que: "Lo que entró y salió del banco en el periodo, según los extractos subidos.",
    calculo:
      "Entradas − salidas de los movimientos del periodo. «Sin casar» son entradas que todavía no se han emparejado con una factura.",
    fuente: "Extractos subidos en Conciliación bancaria. No se filtra por tienda ni por canal.",
  },
} as const satisfies Record<string, Definicion>;

export type ClaveDefinicion = keyof typeof DEFINICIONES;
