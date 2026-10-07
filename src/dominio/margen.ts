/**
 * Gerencia › Margen: de dónde sale el margen y cuánto queda tras los gastos
 * fijos, mes a mes.
 *
 * Todo sale de cifrasGerencia, la misma cuenta que el Resumen: si el margen
 * de aquí y el de allí no cuadraran, alguno estaría mal.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { enRango, type Tramo } from "./periodos";
import { cifrasGerencia, gastosFijosDelRango, type GastoFijo, type Venta } from "./gerencia";

export type FilaMargen = {
  clave: string;
  nombre: string;
  pedidos: number;
  /** Sin IVA. */
  bruta: number;
  coste: number;
  margen: number;
  /** Margen ÷ bruta, en %. Nulo sin ventas. */
  porcentaje: number | null;
};

/** Margen ÷ bruta, en %, con un decimal. Nulo sin ventas. */
export function porcentajeMargen(margen: number, bruta: number): number | null {
  return bruta > 0 ? redondear((margen / bruta) * 100, 1) : null;
}

/** El margen agrupado por lo que diga `clave` (tienda, canal…), de más a menos margen. */
export function margenPor(
  ventas: readonly Venta[],
  clave: (v: Venta) => string,
  nombres: ReadonlyMap<string, string>,
  costeActual: number,
): FilaMargen[] {
  const grupos = new Map<string, Venta[]>();
  for (const v of ventas) {
    const c = clave(v);
    grupos.set(c, [...(grupos.get(c) ?? []), v]);
  }
  return [...grupos.entries()]
    .map(([c, lista]) => {
      const k = cifrasGerencia(lista, costeActual);
      return {
        clave: c,
        nombre: nombres.get(c) ?? c,
        pedidos: k.pedidos,
        bruta: k.bruta,
        coste: k.coste,
        margen: k.margen,
        porcentaje: porcentajeMargen(k.margen, k.bruta),
      };
    })
    .sort((a, b) => b.margen - a.margen);
}

export type TramoMargen = {
  etiqueta: string;
  bruta: number;
  coste: number;
  margen: number;
  /** Gastos fijos que tocan al tramo, prorrateados por días. */
  gastos: number;
  /** Margen − gastos fijos. */
  beneficio: number;
};

/**
 * El margen y el beneficio de cada tramo de la gráfica (día o mes), hasta
 * hoy. Los gastos fijos del tramo se cuentan solo hasta hoy, como en el
 * Resumen.
 */
export function margenPorTramos(
  ventas: readonly Venta[],
  tramos: readonly Tramo[],
  costeActual: number,
  gastos: readonly GastoFijo[],
  hoy: Date,
): TramoMargen[] {
  const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);
  // Los tramos que aún no han empezado no tienen nada que contar.
  return tramos
    .filter((t) => t.desde <= finHoy)
    .map((t) => {
      const k = cifrasGerencia(
        ventas.filter((v) => enRango(v.fecha_pedido, t)),
        costeActual,
      );
      const hasta = t.hasta < finHoy ? t.hasta : finHoy;
      const g = hasta < t.desde ? 0 : gastosFijosDelRango(gastos, { desde: t.desde, hasta });
      return {
        etiqueta: t.etiqueta,
        bruta: k.bruta,
        coste: k.coste,
        margen: k.margen,
        gastos: g,
        beneficio: redondear(k.margen - g),
      };
    });
}

export type MargenMetro = {
  /** Base imponible media por metro. */
  precio: number;
  /** Coste de producción medio por metro. */
  coste: number;
  /** Lo que queda de cada metro. */
  margen: number;
};

/** Precio, coste y margen medios del metro, solo de los pedidos que llevan metros. */
export function margenPorMetro(ventas: readonly Venta[], costeActual: number): MargenMetro | null {
  const conMetros = ventas.filter((v) => Number(v.metros_total ?? 0) > 0);
  const k = cifrasGerencia(conMetros, costeActual);
  if (k.metros <= 0) return null;
  const precio = redondear(k.bruta / k.metros);
  const coste = redondear(k.costeDtf / k.metros);
  return { precio, coste, margen: redondear(precio - coste) };
}
