/**
 * Gerencia › Textil: qué marcas y prendas venden, y cómo está el almacén.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

/** Una línea de pedido textil, ya sin los pedidos cancelados. */
export type LineaTextil = { descripcion: string | null; cantidad: Numerico; subtotal: Numerico };

export type FilaProducto = { nombre: string; unidades: number; importe: number };

/**
 * Lo más vendido, agrupado por la descripción de la línea (sin distinguir
 * mayúsculas ni espacios), de más a menos importe sin IVA.
 */
export function productosTextil(lineas: readonly LineaTextil[], limite = 10): FilaProducto[] {
  const grupos = new Map<string, FilaProducto>();
  for (const l of lineas) {
    const nombre = (l.descripcion ?? "").trim() || "Sin descripción";
    const clave = nombre.toLocaleLowerCase("es").replace(/\s+/g, " ");
    const g = grupos.get(clave) ?? { nombre, unidades: 0, importe: 0 };
    g.unidades += num(l.cantidad);
    g.importe += num(l.subtotal);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, unidades: redondear(g.unidades, 2), importe: redondear(g.importe) }))
    .sort((a, b) => b.importe - a.importe || b.unidades - a.unidades)
    .slice(0, limite);
}

/** Un artículo del almacén. */
export type ArticuloStock = {
  id: string;
  nombre: string;
  talla?: string | null;
  color?: string | null;
  cantidad: Numerico;
  cantidad_minima: Numerico;
  cantidad_reservada: Numerico;
  /** Coste medio ponderado de lo que hay. */
  coste_unitario: Numerico;
  activa?: boolean | null;
};

export type ResumenStock = {
  articulos: number;
  unidades: number;
  /** Unidades × coste medio: lo que vale el almacén a precio de compra. */
  valor: number;
  reservadas: number;
  /** Activos con un mínimo puesto y en él o por debajo, los más justos primero. */
  bajoMinimo: (ArticuloStock & { faltan: number })[];
};

/** El almacén a día de hoy. Solo los artículos activos. */
export function resumenStock(stock: readonly ArticuloStock[]): ResumenStock {
  const activos = stock.filter((a) => a.activa !== false);
  const bajoMinimo = activos
    .filter((a) => num(a.cantidad_minima) > 0 && num(a.cantidad) <= num(a.cantidad_minima))
    .map((a) => ({ ...a, faltan: num(a.cantidad_minima) - num(a.cantidad) }))
    .sort((a, b) => b.faltan - a.faltan || a.nombre.localeCompare(b.nombre));
  return {
    articulos: activos.length,
    unidades: activos.reduce((s, a) => s + num(a.cantidad), 0),
    valor: redondear(
      activos.reduce((s, a) => s + Math.max(0, num(a.cantidad)) * num(a.coste_unitario), 0),
    ),
    reservadas: activos.reduce((s, a) => s + num(a.cantidad_reservada), 0),
    bajoMinimo,
  };
}

/** Un movimiento de almacén con lo justo para el coste de lo vendido. */
export type MovimientoCoste = {
  textil_pedido_id: string | null;
  motivo: string;
  /** Con signo: la venta sale en negativo, la devolución del cliente entra en positivo. */
  cantidad: Numerico;
  coste_unitario: Numerico;
};

/**
 * Lo que costó la ropa de cada pedido: las salidas por venta menos lo que el
 * cliente devolvió, al coste medio congelado en cada movimiento. Los pedidos
 * sin ninguna salida no aparecen: su coste aún no se conoce.
 */
export function costePorPedido(movs: readonly MovimientoCoste[]): Map<string, number> {
  const costes = new Map<string, number>();
  for (const m of movs) {
    if (!m.textil_pedido_id) continue;
    if (m.motivo !== "venta" && m.motivo !== "devolucion_cliente") continue;
    const coste = -num(m.cantidad) * num(m.coste_unitario);
    costes.set(m.textil_pedido_id, (costes.get(m.textil_pedido_id) ?? 0) + coste);
  }
  for (const [k, v] of costes) costes.set(k, redondear(v));
  return costes;
}
