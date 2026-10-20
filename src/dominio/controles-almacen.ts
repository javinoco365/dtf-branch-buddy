/**
 * Controles del almacén: cifras que tienen que dar 0.
 *
 *   - Cada compra textil registrada contra la suma del valor de sus entradas
 *     de stock (motivo `compra`, enlazadas por `compra_id`): tiene que cuadrar
 *     al céntimo (I1).
 *   - Variantes cuya caché (`textil_stock.cantidad`) no es la suma de su libro
 *     y reservas descuadradas: las cuentan `stock_descuadres()` y
 *     `stock_reservas_descuadres()` en la base; aquí solo se resumen.
 *
 * «No se pudo comprobar» no es «en cero»: si falta un dato, `todoEnCero` es
 * false.
 *
 * Lógica pura: sin base de datos ni red.
 */

import { valorMovimiento, type MovimientoAlmacen } from "./cuenta-almacen";
import { redondear } from "./importes";

export type CompraControl = {
  id: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  base: number | string;
  categoria?: string | null;
  estado: string;
  borrada_en?: string | null;
};

export type EntradaControl = Pick<
  MovimientoAlmacen,
  "motivo" | "cantidad" | "coste_unitario" | "compra_id"
>;

export type FilaControlCompra = {
  compra: CompraControl;
  base: number;
  entradas: number;
  diferencia: number;
  estado: "cuadra" | "descuadre" | "sin_enlace";
};

export type ControlCompras = {
  filas: FilaControlCompra[]; // las con descuadre primero
  revisadas: number;
  descuadres: number;
  sinEnlace: number;
  diferenciaTotal: number; // Σ diferencias de las enlazadas: tiene que ser 0
};

const ORDEN_ESTADO: Record<FilaControlCompra["estado"], number> = {
  descuadre: 0,
  sin_enlace: 1,
  cuadra: 2,
};

/**
 * Compras textil (o sin categoría) registradas y sin borrar, contra Σ
 * valorMovimiento de sus entradas `compra`. Sin entradas enlazadas →
 * "sin_enlace" (no cuenta como descuadre ni en la diferencia total).
 */
export function controlComprasEntradas(
  compras: readonly CompraControl[],
  entradas: readonly EntradaControl[],
): ControlCompras {
  const porCompra = new Map<string, number>();
  for (const e of entradas) {
    if (e.motivo !== "compra" || !e.compra_id) continue;
    porCompra.set(e.compra_id, (porCompra.get(e.compra_id) ?? 0) + valorMovimiento(e));
  }

  const filas: FilaControlCompra[] = compras
    .filter(
      (c) =>
        c.estado === "registrada" && !c.borrada_en && (!c.categoria || c.categoria === "textil"),
    )
    .map((c) => {
      const base = redondear(Number(c.base) || 0);
      const enlazada = porCompra.has(c.id);
      const valor = redondear(porCompra.get(c.id) ?? 0);
      const diferencia = redondear(valor - base);
      const estado: FilaControlCompra["estado"] = !enlazada
        ? "sin_enlace"
        : Math.abs(diferencia) < 0.005
          ? "cuadra"
          : "descuadre";
      return { compra: c, base, entradas: valor, diferencia, estado };
    })
    .sort(
      (a, b) =>
        ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
        (b.compra.fecha ?? "").localeCompare(a.compra.fecha ?? ""),
    );

  return {
    filas,
    revisadas: filas.length,
    descuadres: filas.filter((f) => f.estado === "descuadre").length,
    sinEnlace: filas.filter((f) => f.estado === "sin_enlace").length,
    diferenciaTotal: redondear(
      filas.filter((f) => f.estado !== "sin_enlace").reduce((a, f) => a + f.diferencia, 0),
    ),
  };
}

export type ResumenControles = {
  comprasConDescuadre: number;
  diferenciaCompras: number;
  comprasSinEnlace: number;
  variantesDescuadradas: number | null; // filas de stock_descuadres(); null si no se pudo leer
  reservasDescuadradas: number | null; // filas de stock_reservas_descuadres()
  /**
   * Informativa, NO cuenta para todoEnCero: valor de la caché (Σ cantidad × coste_unitario
   * de textil_stock, redondeado por variante) − valor del libro a hoy (valorAFecha). Con
   * coste medio ponderado y todas las salidas al coste medio (1.3.4) solo la mueven los
   * redondeos y los saldos negativos (con saldo ≤ 0 la entrada manda). null sin datos.
   */
  diferenciaValorCache: number | null;
  /** descuadres 0, diferencia 0 y las dos de arriba 0. Si alguna es null (no se pudo leer),
   *  false: «no comprobado» no es «en cero». */
  todoEnCero: boolean;
};

export function resumenControles(
  c: ControlCompras | null,
  variantes: number | null,
  reservas: number | null,
  diferenciaValorCache: number | null = null,
): ResumenControles {
  return {
    comprasConDescuadre: c?.descuadres ?? 0,
    diferenciaCompras: c?.diferenciaTotal ?? 0,
    comprasSinEnlace: c?.sinEnlace ?? 0,
    variantesDescuadradas: variantes,
    reservasDescuadradas: reservas,
    diferenciaValorCache: diferenciaValorCache === null ? null : redondear(diferenciaValorCache),
    todoEnCero:
      c !== null &&
      c.descuadres === 0 &&
      Math.abs(c.diferenciaTotal) < 0.005 &&
      variantes === 0 &&
      reservas === 0,
  };
}
