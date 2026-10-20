/**
 * Controles del almacén: cifras que tienen que dar 0.
 *
 *   - Cada compra textil registrada contra la suma del valor de sus entradas
 *     de stock (motivo `compra`, enlazadas por `compra_id`): tiene que cuadrar
 *     al céntimo (I1). Una factura casada con su proforma se comprueba junto
 *     con ella (P7): las entradas de las dos, los ajustes de coste y las
 *     salidas de la regularización contra la base de la factura menos lo que
 *     no se pudo llevar al stock. Una proforma sin factura se comprueba sola y
 *     se cuenta aparte: es una espera, no un descuadre.
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
import type { ResumenCasado } from "./tipos-textil";

export type CompraControl = {
  id: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  base: number | string;
  categoria?: string | null;
  estado: string;
  borrada_en?: string | null;
  /** Sin la migración, undefined = factura. */
  tipo_documento?: string | null;
  /** En la factura casada, su proforma. */
  proforma_id?: string | null;
  /** En la factura casada, lo que hizo la regularización. */
  casado_resumen?: ResumenCasado | null;
};

export type EntradaControl = Pick<
  MovimientoAlmacen,
  "motivo" | "cantidad" | "coste_unitario" | "compra_id" | "importe_ajuste"
>;

export type FilaControlCompra = {
  /** En un par, la factura. */
  compra: CompraControl;
  tipo: "compra" | "par" | "proforma_sin_factura";
  /** En un par, la proforma; si no, null. */
  proforma: CompraControl | null;
  base: number;
  entradas: number;
  /** En un par, lo que no se pudo llevar al stock (diferencia_sin_aplicar); si no, 0. */
  sinAplicar: number;
  diferencia: number;
  estado: "cuadra" | "descuadre" | "sin_enlace";
};

export type ControlCompras = {
  filas: FilaControlCompra[]; // las con descuadre primero
  revisadas: number;
  descuadres: number;
  sinEnlace: number;
  diferenciaTotal: number; // Σ diferencias de las enlazadas: tiene que ser 0
  /** Filas de proformas todavía sin factura. */
  proformasSinFactura: number;
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
 *
 * `compras` trae las del rango más el otro miembro de cada par. Una factura
 * con `proforma_id` cuya proforma está en la lista da una sola fila «par»
 * (la proforma casada no tiene fila propia): entradas `compra` de las dos +
 * `ajuste_coste` de la factura + valor_devoluciones de la regularización,
 * contra base de la factura − diferencia_sin_aplicar. Una proforma sin
 * factura en la lista, fila «proforma_sin_factura» con la regla de siempre.
 * Las entradas que no son `compra` ni `ajuste_coste` se ignoran.
 */
export function controlComprasEntradas(
  compras: readonly CompraControl[],
  entradas: readonly EntradaControl[],
): ControlCompras {
  const porCompra = new Map<string, number>();
  const ajustes = new Map<string, number>();
  for (const e of entradas) {
    if (!e.compra_id) continue;
    if (e.motivo === "compra") {
      porCompra.set(e.compra_id, (porCompra.get(e.compra_id) ?? 0) + valorMovimiento(e));
    } else if (e.motivo === "ajuste_coste") {
      ajustes.set(e.compra_id, (ajustes.get(e.compra_id) ?? 0) + valorMovimiento(e));
    }
  }

  const cuenta = compras.filter(
    (c) => c.estado === "registrada" && !c.borrada_en && (!c.categoria || c.categoria === "textil"),
  );
  const porId = new Map(cuenta.map((c) => [c.id, c]));
  // Proformas con su factura en la lista: van en la fila del par.
  const casadas = new Set<string>();
  for (const c of cuenta)
    if (c.tipo_documento !== "proforma" && c.proforma_id && porId.has(c.proforma_id))
      casadas.add(c.proforma_id);

  const estadoDe = (enlazada: boolean, diferencia: number): FilaControlCompra["estado"] =>
    !enlazada ? "sin_enlace" : Math.abs(diferencia) < 0.005 ? "cuadra" : "descuadre";

  const filas: FilaControlCompra[] = [];
  for (const c of cuenta) {
    if (casadas.has(c.id)) continue;
    const base = redondear(Number(c.base) || 0);
    const proforma =
      c.tipo_documento !== "proforma" && c.proforma_id ? (porId.get(c.proforma_id) ?? null) : null;
    if (proforma) {
      const stock = c.casado_resumen?.stock ?? null;
      const sinAplicar = redondear(stock?.diferencia_sin_aplicar ?? 0);
      const enlazada = porCompra.has(c.id) || porCompra.has(proforma.id) || ajustes.has(c.id);
      const valor = redondear(
        (porCompra.get(proforma.id) ?? 0) +
          (porCompra.get(c.id) ?? 0) +
          (ajustes.get(c.id) ?? 0) +
          (stock?.valor_devoluciones ?? 0),
      );
      const diferencia = redondear(valor - (base - sinAplicar));
      filas.push({
        compra: c,
        tipo: "par",
        proforma,
        base,
        entradas: valor,
        sinAplicar,
        diferencia,
        estado: estadoDe(enlazada, diferencia),
      });
      continue;
    }
    const valor = redondear(porCompra.get(c.id) ?? 0);
    const diferencia = redondear(valor - base);
    filas.push({
      compra: c,
      tipo: c.tipo_documento === "proforma" ? "proforma_sin_factura" : "compra",
      proforma: null,
      base,
      entradas: valor,
      sinAplicar: 0,
      diferencia,
      estado: estadoDe(porCompra.has(c.id), diferencia),
    });
  }

  filas.sort(
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
    proformasSinFactura: filas.filter((f) => f.tipo === "proforma_sin_factura").length,
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
  /** Proformas registradas todavía sin factura. Informativa: NO cuenta para todoEnCero. */
  proformasSinFactura: number;
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
    proformasSinFactura: c?.proformasSinFactura ?? 0,
    todoEnCero:
      c !== null &&
      c.descuadres === 0 &&
      Math.abs(c.diferenciaTotal) < 0.005 &&
      variantes === 0 &&
      reservas === 0,
  };
}
