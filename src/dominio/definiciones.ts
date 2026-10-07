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

const GERENCIA_PEDIDOS_CLIENTES =
  "Toda la historia de pedidos de tiendas y textil, sin cancelados y con lo devuelto restado, con los filtros de tienda y canal.";

const GERENCIA_PRESUPUESTOS =
  "Presupuestos de tiendas y textil con fecha en el periodo. Con el filtro de canal: «Manual» son los de tienda y «Textil» los del textil; la web no hace presupuestos.";

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
      "Facturación bruta − metros vendidos × coste por metro (consumibles + packaging + electricidad) − envíos. El envío lo paga el cliente y se le paga a la agencia por lo mismo: es venta y coste a la vez. Cada pedido usa el coste por metro que había en Ajustes › Datos de la empresa al crearse, así que cambiarlo no altera el margen de meses pasados. Es una estimación: no incluye gastos fijos.",
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
    que: "Lo que queda de lo vendido después de lo que cuesta producirlo.",
    calculo:
      "Facturación bruta − coste. En DTF, metros × coste por metro congelado en cada pedido, más el envío, que se cobra al cliente y se paga a la agencia por lo mismo. En textil, lo que costó la ropa que salió del almacén para el pedido, al coste medio del momento; un pedido textil que aún no ha salido del almacén va sin coste. No incluye gastos fijos: eso es el beneficio estimado.",
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
      "(Facturación bruta − envíos) de los pedidos que llevan metros ÷ sus metros. Incluye lo que vaya en esos pedidos además del metro (diseño); el envío no.",
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

  // --- Gerencia › Clientes ----------------------------------------------------
  g_clientes_activos: {
    que: "Clientes distintos que han hecho algún pedido en el periodo.",
    calculo:
      "Se cuenta cada ficha de cliente una vez, haga uno o diez pedidos. Un cliente de tienda y uno del textil son fichas distintas aunque se llamen igual. Los pedidos sin cliente asociado no cuentan aquí.",
    fuente: GERENCIA_PEDIDOS_CLIENTES,
  },
  g_clientes_nuevos: {
    que: "Clientes cuyo primer pedido de toda su historia cae en el periodo.",
    calculo:
      "Se mira el primer pedido no cancelado de cada cliente desde el principio, no solo en el periodo. Con un filtro de tienda o canal, «nuevo» es nuevo en lo que estás mirando.",
    fuente: GERENCIA_PEDIDOS_CLIENTES,
  },
  g_clientes_recurrentes: {
    que: "Clientes que han pedido en el periodo y ya habían pedido antes.",
    calculo: "Clientes activos del periodo cuyo primer pedido es anterior al periodo.",
    fuente: GERENCIA_PEDIDOS_CLIENTES,
  },
  g_pareto: {
    que: "Cuántos clientes hacen el 80 % de lo vendido a clientes en el periodo.",
    calculo:
      "Se ordenan los clientes de más a menos vendido y se suman hasta llegar al 80 %. Cuantos menos hagan falta, más depende el negocio de unos pocos.",
    fuente: GERENCIA_PEDIDOS_CLIENTES,
  },
  g_dormidos: {
    que: "Clientes que llevan más de 60 días sin hacer un pedido.",
    calculo:
      "Días desde su último pedido no cancelado hasta hoy. Ordenados por lo que han comprado en toda su historia: los primeros son los que más cuesta perder.",
    fuente:
      "Toda la historia de pedidos de tiendas y textil, con los filtros de tienda y canal. No depende del periodo elegido: es la foto de hoy.",
  },

  // --- Gerencia › Comercial ---------------------------------------------------
  g_presupuestos_enviados: {
    que: "Presupuestos del periodo que llegaron al cliente.",
    calculo:
      "Los que están enviados, aceptados, rechazados o facturados (textil). Los borradores no cuentan: no han salido.",
    fuente: GERENCIA_PRESUPUESTOS,
  },
  g_presupuestos_aceptados: {
    que: "Presupuestos del periodo que el cliente aceptó.",
    calculo: "Los aceptados más los facturados del textil, que antes fueron aceptados.",
    fuente: GERENCIA_PRESUPUESTOS,
  },
  g_conversion: {
    que: "Qué parte de los presupuestos enviados se acepta.",
    calculo:
      "Aceptados ÷ enviados, en número. Debajo, lo mismo en importe. Los que siguen sin respuesta cuentan como no aceptados todavía, así que en un periodo reciente la tasa sube con los días.",
    fuente: GERENCIA_PRESUPUESTOS,
  },
  g_dias_a_pedido: {
    que: "Cuánto tarda de media un presupuesto en convertirse en pedido.",
    calculo:
      "Días desde la fecha del presupuesto hasta la del pedido creado desde él. Solo cuentan los presupuestos que se confirmaron como pedido en el CRM.",
    fuente: GERENCIA_PRESUPUESTOS,
  },
  g_presupuestos_pendientes: {
    que: "Lo que está en el aire: presupuestos enviados que siguen sin respuesta.",
    calculo:
      "En plazo: enviados cuya validez no ha pasado. Caducados: enviados con la validez ya pasada y sin aceptar ni rechazar.",
    fuente:
      "Presupuestos de tiendas y textil de cualquier fecha, con los filtros de tienda y canal. No depende del periodo: es la foto de hoy.",
  },

  // --- Gerencia › Producción --------------------------------------------------
  g_taller: {
    que: "Pedidos que todavía no han salido: pendientes, procesando, imprimiendo o listos.",
    calculo: "Número de pedidos en esos estados, sea cual sea su fecha, y sus metros.",
    fuente:
      "Pedidos de tiendas y textil, con los filtros de tienda y canal. No depende del periodo: es la foto de hoy.",
  },
  g_espera: {
    que: "El pedido abierto que más lleva esperando.",
    calculo: "Días desde la fecha del pedido hasta hoy, del más antiguo de los que no han salido.",
    fuente: "Los mismos pedidos que «En el taller».",
  },
  g_dias_envio: {
    que: "Cuánto se tarda de media desde que entra un pedido hasta que se envía.",
    calculo:
      "Días naturales desde la fecha del pedido hasta que se le pone el primer enlace de seguimiento, de los pedidos enviados en el periodo. Debajo, la mediana: la mitad se envía en ese tiempo o menos.",
    fuente:
      "Pedidos de tiendas con seguimiento. No incluye los que se recogen sin envío ni el textil, que no guarda cuándo se envió.",
  },
  g_enviados: {
    que: "Pedidos de tienda que salieron en el periodo.",
    calculo: "Pedidos cuyo primer enlace de seguimiento se creó en el periodo.",
    fuente: "Enlaces de seguimiento de los pedidos de tienda, con los filtros de tienda y canal.",
  },

  // --- Gerencia › Margen ------------------------------------------------------
  g_bruta: {
    que: "Lo vendido sin IVA: lo que es de la empresa.",
    calculo: "Suma de las bases imponibles de los pedidos no cancelados, menos lo devuelto.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_coste: {
    que: "Lo que ha costado producir lo vendido.",
    calculo:
      "DTF: metros × coste por metro (consumibles, embalaje y electricidad) congelado en cada pedido. Envíos: lo mismo que se cobra al cliente, que es lo que se paga a la agencia. Textil: la ropa que salió del almacén para cada pedido, al coste medio del momento, menos lo que devolvió el cliente.",
    fuente: "Pedidos del periodo y salidas del almacén textil. No incluye gastos fijos ni sueldos.",
  },
  g_margen_pct: {
    que: "Qué parte de cada euro vendido (sin IVA) queda después del coste.",
    calculo: "Margen ÷ facturación bruta.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_margen_metro: {
    que: "Cuánto queda de cada metro de DTF.",
    calculo:
      "Precio medio del metro ((base imponible − envío) ÷ metros) − coste medio del metro (coste DTF ÷ metros), solo de los pedidos que llevan metros.",
    fuente: GERENCIA_PEDIDOS,
  },

  // --- Gerencia › Fiscal ------------------------------------------------------
  g_iva_repercutido: {
    que: "El IVA de las facturas y tickets emitidos en el periodo.",
    calculo:
      "Suma del IVA de facturas, tickets y rectificativas con fecha en el periodo; las rectificativas restan. Los borradores no cuentan.",
    fuente:
      "Facturas de las tiendas y del textil. Con el filtro de tienda, solo esa tienda; el filtro de canal no se aplica a las facturas.",
  },
  g_iva_soportado: {
    que: "El IVA de las compras registradas en el CRM en el periodo.",
    calculo:
      "Suma del IVA de las facturas de compra registradas. Las que están en borrador no cuentan.",
    fuente:
      "Solo las compras del textil que se suben al CRM. Los gastos que no pasan por aquí (consumibles DTF, alquiler, servicios) no están, así que el IVA soportado real es mayor.",
  },
  g_iva_resultado: {
    que: "Por dónde va el IVA del periodo con lo que sabe el CRM.",
    calculo:
      "IVA repercutido − IVA soportado registrado. Es orientativo: el modelo 303 lo presenta la gestoría con todos los gastos.",
    fuente: "Facturas emitidas y compras registradas del periodo.",
  },
  g_sin_factura: {
    que: "Pedidos del periodo sin factura ni ticket vigente.",
    calculo:
      "Pedidos no cancelados sin documento emitido, o con el suyo anulado por una rectificativa. Los borradores no cuentan como emitidos.",
    fuente: GERENCIA_PEDIDOS,
  },
  g_huecos: {
    que: "Números de factura que el contador dio y no tienen factura.",
    calculo:
      "Para cada serie y año, los números del 1 al último asignado que no aparecen en ninguna factura de las tiendas ni del textil. La numeración tiene que ser correlativa y sin huecos: si sale alguno, hay que revisarlo.",
    fuente: "Todas las series y años, sin depender del periodo ni de los filtros.",
  },

  // --- Gerencia › Textil ------------------------------------------------------
  g_stock_valor: {
    que: "Lo que vale el almacén textil a precio de compra, hoy.",
    calculo: "Unidades de cada artículo activo × su coste medio ponderado.",
    fuente: "Almacén textil. No depende del periodo.",
  },
  g_compras_textil: {
    que: "Lo comprado para el textil en el periodo, sin IVA.",
    calculo: "Suma de la base de las facturas de compra registradas con fecha en el periodo.",
    fuente: "Compras del textil subidas al CRM.",
  },
} as const satisfies Record<string, Definicion>;

export type ClaveDefinicion = keyof typeof DEFINICIONES;
