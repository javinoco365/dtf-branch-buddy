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
import { diaDelPedido } from "./dia-pedido";
import { diasDelRango, type Tramo } from "./periodos";
import { partirPedidos } from "./por-linea";
import {
  cifrasGerencia,
  cifrasGerenciaPorLinea,
  gastosFijosDelRango,
  type GastoFijo,
  type Venta,
} from "./gerencia";

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
  // Cada venta en el día de su pedido, como el filtro del periodo (ver
  // dia-pedido.ts). Se calcula una vez y se compara con cada tramo.
  const dias = ventas.map((v) => diaDelPedido(v));
  // Los tramos que aún no han empezado no tienen nada que contar.
  return tramos
    .filter((t) => t.desde <= finHoy)
    .map((t) => {
      const r = diasDelRango(t);
      const k = cifrasGerencia(
        r ? ventas.filter((_, i) => dias[i] >= r.desde && dias[i] <= r.hasta) : [],
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
  // Solo la parte de DTF: lo del UV de un pedido mixto (su importe y lo que
  // cobra la subcontrata) no va en el metro de DTF (ver por-linea.ts).
  const conMetros = partirPedidos(ventas).dtf.filter((v) => Number(v.metros_total ?? 0) > 0);
  const k = cifrasGerencia(conMetros, costeActual);
  if (k.metros <= 0) return null;
  const precio = k.euroMetro;
  const coste = redondear(k.costeDtf / k.metros);
  return { precio, coste, margen: redondear(precio - coste) };
}

/**
 * El margen de cada línea de producto: DTF, DTF UV (lo que deja sobre lo que
 * cobra la subcontrata) y Textil. Suman el margen de «Todo» al céntimo (ver
 * cifrasGerenciaPorLinea). Sin pedidos de una línea, no sale.
 */
export function margenPorLinea(ventas: readonly Venta[], costeActual: number): FilaMargen[] {
  return cifrasGerenciaPorLinea(ventas, costeActual).map((f) => ({
    clave: f.clave,
    nombre: f.etiqueta,
    pedidos: f.cifras.pedidos,
    bruta: f.cifras.bruta,
    coste: f.cifras.coste,
    margen: f.cifras.margen,
    porcentaje: porcentajeMargen(f.cifras.margen, f.cifras.bruta),
  }));
}

/**
 * Precio, coste y margen medios del metro de DTF UV: lo que se cobra, lo que
 * cobra la subcontrata y lo que queda. Nulo sin metros de UV.
 */
export function margenPorMetroUv(
  ventas: readonly Venta[],
  costeActual: number,
): MargenMetro | null {
  const uv = cifrasGerenciaPorLinea(ventas, costeActual).find((f) => f.clave === "uv")?.cifras;
  if (!uv || uv.metrosUv <= 0) return null;
  const precio = redondear(uv.bruta / uv.metrosUv);
  const coste = redondear(uv.costeUv / uv.metrosUv);
  return { precio, coste, margen: redondear(precio - coste) };
}
