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
  /** Facturación bruta: suma de bases imponibles. */
  bruta: number;
  iva: number;
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
  bruta: 0,
  iva: 0,
  envios: 0,
  total: 0,
  metros: 0,
  cancelados: 0,
  ticket: 0,
};

/** Los pedidos cancelados no facturan, pero sí se cuentan aparte. */
export function calcularKpis(pedidos: readonly PedidoResumen[]): KpisPeriodo {
  const validos = pedidos.filter((p) => p.estado !== ESTADO_CANCELADO);
  const total = validos.reduce((s, p) => s + num(p.total), 0);

  return {
    pedidos: validos.length,
    bruta: redondear(validos.reduce((s, p) => s + num(p.subtotal), 0)),
    iva: redondear(validos.reduce((s, p) => s + num(p.iva), 0)),
    envios: redondear(validos.reduce((s, p) => s + num(p.envio), 0)),
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
    porDia.set(clave, (porDia.get(clave) ?? 0) + num(p.total));
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
      .reduce((s, p) => s + num(p.total), 0);
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
