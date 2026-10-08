/**
 * Agregación de pedidos para las pantallas de cuadro de mando y facturación.
 *
 * Lógica pura: recibe filas ya leídas de la base y devuelve cifras. No consulta
 * nada, no conoce Supabase y se prueba sin base de datos.
 *
 * Las tres pantallas que muestran facturación (cuadro de mando global,
 * facturación consolidada y facturación por tienda) calculaban lo mismo cada
 * una a su manera sobre datos inventados. Ahora comparten estas funciones, así
 * que un cambio de criterio se aplica a las tres a la vez.
 */

import { redondear } from "./importes";

/**
 * Una fila de `pedidos` con lo mínimo para agregar. Los importes llegan de
 * Postgres como `numeric`, que supabase-js entrega como cadena o número según
 * el caso, así que se normalizan aquí.
 */
export type PedidoResumen = {
  fecha_pedido: string;
  tienda_id: string;
  estado: string;
  subtotal: number | string | null;
  iva: number | string | null;
  envio: number | string | null;
  total: number | string | null;
  metros_total: number | string | null;
  /**
   * Lo devuelto al cliente (reembolsos de WooCommerce), con IVA. Se resta de
   * lo vendido: un pedido de 100 € con 30 € devueltos son 70 € de venta.
   */
  devuelto?: number | string | null;
  /**
   * Coste de producción por metro congelado al crear el pedido. Nulo en los
   * pedidos de antes de congelarlo, o si la migración no está aplicada.
   */
  coste_metro_snapshot?: number | string | null;
  /** `manual` o `woocommerce`. Solo lo traen las consultas que lo necesitan. */
  origen?: string | null;
  cliente_id?: string | null;
};

/** Una línea de pedido con lo mínimo para agrupar por producto. */
export type LineaResumen = {
  descripcion: string | null;
  cantidad: number | string | null;
  unidad?: string | null;
};

/** El único estado que se excluye de la facturación. */
export const ESTADO_CANCELADO = "cancelado";

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export type KpisPeriodo = {
  /** Pedidos no cancelados. */
  pedidos: number;
  /** Lo devuelto de esos pedidos, con IVA. Ya está restado de lo demás. */
  devuelto: number;
  /** Suma de las bases imponibles, con el envío dentro: la base de la factura. */
  base: number;
  /**
   * Facturación bruta: lo vendido sin IVA y sin el envío cobrado (base −
   * envíos). El envío se cobra al cliente y se paga a la agencia: no es venta
   * de la empresa, y se enseña aparte.
   */
  bruta: number;
  iva: number;
  /** El envío cobrado a los clientes, sin IVA. Va dentro de `base`, no de `bruta`. */
  envios: number;
  /** Suma de totales con IVA y envío. */
  total: number;
  metros: number;
  cancelados: number;
  /** Total entre número de pedidos no cancelados. Cero si no hay ninguno. */
  ticket: number;
};

export const KPIS_VACIOS: KpisPeriodo = {
  pedidos: 0,
  devuelto: 0,
  base: 0,
  bruta: 0,
  iva: 0,
  envios: 0,
  total: 0,
  metros: 0,
  cancelados: 0,
  ticket: 0,
};

/**
 * Qué parte del pedido sigue vendida después de las devoluciones, de 0 a 1.
 *
 * WooCommerce da el importe devuelto con IVA, no qué líneas ni cuánto era
 * base o envío. Se reparte en proporción: si se devuelve el 30 % del total,
 * se descuenta el 30 % de la base, del IVA y del envío. Para el IVA es exacto
 * cuando todo el pedido va al mismo tipo, que es lo normal aquí.
 */
export function parteVendida(p: Pick<PedidoResumen, "total" | "devuelto">): number {
  const total = num(p.total);
  if (total <= 0) return 1;
  const queda = (total - num(p.devuelto)) / total;
  return Math.min(1, Math.max(0, queda));
}

/** El total del pedido después de las devoluciones. */
export function totalNeto(p: Pick<PedidoResumen, "total" | "devuelto">): number {
  return num(p.total) * parteVendida(p);
}

/**
 * La base imponible del pedido con el envío dentro, sea como sea que se
 * guardó.
 *
 * Desde el 2-9-2026 (y siempre en los de WooCommerce) `subtotal` ya lleva el
 * envío y total = subtotal + IVA. Los manuales y textil de antes lo guardaban
 * fuera: total = subtotal + IVA + envío. Se distingue por cuál de las dos
 * sumas da el total; restarles el envío a esos sería quitárselo dos veces.
 */
export function baseConEnvio(
  p: Pick<PedidoResumen, "subtotal" | "iva" | "envio" | "total">,
): number {
  const subtotal = num(p.subtotal);
  const envio = num(p.envio);
  if (envio <= 0) return subtotal;
  const iva = num(p.iva);
  const total = num(p.total);
  const cuadraDentro = Math.abs(subtotal + iva - total) < 0.015;
  const cuadraFuera = Math.abs(subtotal + iva + envio - total) < 0.015;
  return cuadraFuera && !cuadraDentro ? subtotal + envio : subtotal;
}

/**
 * Los pedidos cancelados no facturan, pero sí se cuentan aparte. Las
 * devoluciones parciales se restan (ver `parteVendida`); los metros no,
 * porque no se sabe qué se devolvió y lo impreso, impreso está.
 */
export function calcularKpis(pedidos: readonly PedidoResumen[]): KpisPeriodo {
  const validos = pedidos.filter((p) => p.estado !== ESTADO_CANCELADO);
  const total = validos.reduce((s, p) => s + totalNeto(p), 0);
  const parte = (valor: (p: PedidoResumen) => number) =>
    redondear(validos.reduce((s, p) => s + valor(p) * parteVendida(p), 0));

  const base = parte(baseConEnvio);
  const envios = parte((p) => num(p.envio));
  return {
    pedidos: validos.length,
    devuelto: redondear(validos.reduce((s, p) => s + num(p.total) - totalNeto(p), 0)),
    base,
    bruta: parte((p) => baseConEnvio(p) - num(p.envio)),
    iva: parte((p) => num(p.iva)),
    envios,
    total: redondear(total),
    metros: redondear(
      validos.reduce((s, p) => s + num(p.metros_total), 0),
      3,
    ),
    cancelados: pedidos.length - validos.length,
    ticket: validos.length ? redondear(total / validos.length) : 0,
  };
}

/**
 * Coste de producción de los pedidos no cancelados: metros × coste por metro.
 *
 * Cada pedido con su coste congelado; los que no lo tienen, con el coste de
 * hoy (`costeActual`), que es lo único que se sabe de ellos.
 */
export function costeProduccion(pedidos: readonly PedidoResumen[], costeActual: number): number {
  return redondear(
    pedidos
      .filter((p) => p.estado !== ESTADO_CANCELADO)
      .reduce((s, p) => {
        const congelado = p.coste_metro_snapshot;
        const coste = congelado == null || congelado === "" ? costeActual : num(congelado);
        return s + num(p.metros_total) * coste;
      }, 0),
  );
}

/**
 * Lo que cuesta servir los pedidos no cancelados: la producción más el envío.
 *
 * El envío lo paga el cliente y la empresa se lo paga a la agencia por el
 * mismo importe: no deja margen. La facturación bruta ya va sin él, así que el
 * margen es bruta − producción; `total` (con el envío) solo cuadra contra la
 * base, que sí lo lleva.
 */
export function costeVariable(
  pedidos: readonly PedidoResumen[],
  costeActual: number,
): { produccion: number; envios: number; total: number } {
  const produccion = costeProduccion(pedidos, costeActual);
  const envios = calcularKpis(pedidos).envios;
  return { produccion, envios, total: redondear(produccion + envios) };
}

/**
 * Variación porcentual respecto al periodo anterior.
 *
 * Devuelve `null` cuando no hay comparación posible, es decir, cuando el
 * periodo anterior fue cero. La versión anterior devolvía 100 % en ese caso, un
 * número inventado que la pantalla presentaba como si fuera real.
 */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return redondear(((actual - anterior) / anterior) * 100, 1);
}

/**
 * Total facturado por día, sobre el esqueleto de días que se le pase.
 *
 * Recibe los días en lugar de deducirlos para que los días sin ventas aparezcan
 * a cero y la gráfica no se colapse.
 */
export function agruparPorDia(
  pedidos: readonly PedidoResumen[],
  dias: readonly Date[],
): { dia: Date; total: number }[] {
  const porDia = new Map<string, number>();
  for (const p of pedidos) {
    if (p.estado === ESTADO_CANCELADO) continue;
    const clave = claveDia(new Date(p.fecha_pedido));
    porDia.set(clave, (porDia.get(clave) ?? 0) + totalNeto(p));
  }
  return dias.map((dia) => ({
    dia,
    total: redondear(porDia.get(claveDia(dia)) ?? 0),
  }));
}

function claveDia(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Total facturado dentro de cada uno de los rangos que se le pasen.
 *
 * Sirve para las series temporales (por semana, por mes) sin lanzar una
 * consulta por cada punto de la gráfica: se lee el periodo completo una vez y
 * se reparte aquí.
 */
export function agruparPorRangos(
  pedidos: readonly PedidoResumen[],
  rangos: readonly { desde: Date; hasta: Date }[],
): { desde: Date; hasta: Date; total: number }[] {
  const validos = pedidos.filter((p) => p.estado !== ESTADO_CANCELADO);
  return rangos.map((r) => {
    const desde = r.desde.getTime();
    const hasta = r.hasta.getTime();
    const total = validos
      .filter((p) => {
        const t = new Date(p.fecha_pedido).getTime();
        return t >= desde && t <= hasta;
      })
      .reduce((s, p) => s + totalNeto(p), 0);
    return { desde: r.desde, hasta: r.hasta, total: redondear(total) };
  });
}

export type FilaTienda = {
  tienda_id: string;
  nombre: string;
} & KpisPeriodo;

/**
 * Desglose por tienda, ordenado de mayor a menor facturación.
 *
 * Las tiendas sin pedidos en el periodo aparecen con ceros: que una tienda no
 * haya vendido nada es información, y desaparecer de la tabla la ocultaría.
 */
export function agruparPorTienda(
  pedidos: readonly PedidoResumen[],
  tiendas: readonly { id: string; nombre: string }[],
): FilaTienda[] {
  return tiendas
    .map((t) => ({
      tienda_id: t.id,
      nombre: t.nombre,
      ...calcularKpis(pedidos.filter((p) => p.tienda_id === t.id)),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Productos más vendidos por metros lineales.
 *
 * Agrupa por la descripción congelada en la línea, no por `producto_id`: la
 * sincronización con WooCommerce no siempre rellena la referencia al producto,
 * y la descripción es lo que el cliente compró de verdad.
 */
export function topPorMetros(
  lineas: readonly LineaResumen[],
  limite = 6,
): { producto: string; metros: number }[] {
  const porProducto = new Map<string, number>();
  for (const l of lineas) {
    if ((l.unidad ?? "m").toLowerCase() !== "m") continue;
    const nombre = (l.descripcion ?? "").trim() || "Sin descripción";
    porProducto.set(nombre, (porProducto.get(nombre) ?? 0) + num(l.cantidad));
  }
  return Array.from(porProducto.entries())
    .map(([producto, metros]) => ({ producto, metros: redondear(metros, 2) }))
    .sort((a, b) => b.metros - a.metros)
    .slice(0, limite);
}
