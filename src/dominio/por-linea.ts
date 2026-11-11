/**
 * Las cifras de cada línea de producto: DTF (impresión propia) y DTF UV
 * (subcontratado). Ver linea-producto.ts.
 *
 * Todas las pantallas que separan DTF y UV salen de aquí, así que cuadran
 * entre sí. La regla de fondo: cada pedido se parte en dos pedidos «virtuales»
 * —su parte de DTF y su parte de UV— que suman exactamente el pedido. Con
 * ellos, las funciones de siempre (`calcularKpis`, `costeProduccion`) sirven
 * tal cual para cada línea.
 *
 * Cómo se parte un pedido:
 *
 *   - Solo de UV: entero al UV, envío incluido (lo envía la subcontrata).
 *   - Con UV y algo más (mixto): al UV, la base y el IVA de sus líneas de UV
 *     (`bruta_uv`, `iva_uv`, migración 20261111100000) y sus metros; al DTF,
 *     el resto, con el envío. Las devoluciones se reparten en proporción.
 *   - Mixto sin `bruta_uv` (pedido de antes, o la migración sin aplicar):
 *     entero al DTF salvo los metros de UV, que van al UV sin importe. Es lo
 *     que se hacía antes; no se inventa un reparto.
 *   - Sin UV: entero al DTF.
 *
 * Los metros no se suman nunca entre líneas: son productos distintos.
 *
 * Lógica pura: sin Supabase ni red.
 */

import { calcularLinea, redondear } from "./importes";
import {
  calcularKpis,
  COSTE_UV_POR_DEFECTO,
  costeProduccion,
  ESTADO_CANCELADO,
  type KpisPeriodo,
  type PedidoResumen,
} from "./kpis";
import { esSoloUv, type LineaProducto } from "./linea-producto";

type Valor = number | string | null | undefined;
const num = (v: Valor) => Number(v ?? 0) || 0;

/** Lo que hace falta del pedido para partirlo: `bruta_uv` e `iva_uv` (ver kpis.ts). */
export type PedidoPartible = PedidoResumen;

/** La selección de las pantallas: las dos líneas juntas o una sola. */
export type FiltroLinea = "todo" | LineaProducto;

export const FILTROS_LINEA: readonly FiltroLinea[] = ["todo", "dtf", "uv"];

export const ETIQUETA_FILTRO_LINEA: Record<FiltroLinea, string> = {
  todo: "Todo",
  dtf: "DTF",
  uv: "DTF UV",
};

/** ¿Es un filtro de línea válido? Para leerlo de la dirección. */
export const esFiltroLinea = (v: unknown): v is FiltroLinea =>
  v === "todo" || v === "dtf" || v === "uv";

/** Una parte vacía con las fechas y el estado del pedido. */
function vacia<P extends PedidoResumen>(p: P): P {
  return {
    ...p,
    subtotal: 0,
    iva: 0,
    envio: 0,
    total: 0,
    devuelto: 0,
    metros_total: 0,
    metros_uv: 0,
    bruta_uv: 0,
    iva_uv: 0,
  };
}

/**
 * Un pedido partido en su parte de DTF y su parte de UV. Las dos conservan
 * el resto de campos del pedido (fecha, tienda, estado, cliente…), así que se
 * pueden agrupar por día o por tienda como el pedido entero.
 */
export function partirPedido<P extends PedidoPartible>(p: P): Record<LineaProducto, P> {
  if (esSoloUv(p)) return { dtf: vacia(p), uv: { ...p, metros_total: 0 } };

  const metrosUv = num(p.metros_uv);
  const brutaUv = num(p.bruta_uv);
  const ivaUv = num(p.iva_uv);
  if (metrosUv <= 0 && brutaUv <= 0)
    return { dtf: { ...p, metros_uv: 0, bruta_uv: 0, iva_uv: 0 }, uv: vacia(p) };

  // Mixto: el UV, sus líneas; el DTF, el resto. Sin importes de UV guardados,
  // el UV se queda solo con sus metros.
  const totalUv = redondear(brutaUv + ivaUv);
  const total = num(p.total);
  const parteUv = total > 0 ? Math.min(1, totalUv / total) : 0;
  const devuelto = num(p.devuelto);
  // Sin redondear: cada parte devuelve la misma proporción que el pedido, y
  // redondear aquí descuadraba un céntimo las sumas.
  const devueltoUv = devuelto * parteUv;
  return {
    dtf: {
      ...p,
      subtotal: redondear(num(p.subtotal) - brutaUv),
      iva: redondear(num(p.iva) - ivaUv),
      total: redondear(total - totalUv),
      devuelto: devuelto - devueltoUv,
      metros_uv: 0,
      // La parte de DTF ya no lleva UV: partirla otra vez no cambia nada.
      bruta_uv: 0,
      iva_uv: 0,
    },
    uv: {
      ...p,
      subtotal: brutaUv,
      iva: ivaUv,
      envio: 0,
      total: totalUv,
      devuelto: devueltoUv,
      metros_total: 0,
      metros_uv: metrosUv,
    },
  };
}

/** Los pedidos partidos, cada parte en su lista. */
export function partirPedidos<P extends PedidoPartible>(
  pedidos: readonly P[],
): Record<LineaProducto, P[]> {
  const dtf: P[] = [];
  const uv: P[] = [];
  for (const p of pedidos) {
    const partes = partirPedido(p);
    dtf.push(partes.dtf);
    uv.push(partes.uv);
  }
  return { dtf, uv };
}

/** ¿Lleva algo esta parte? Un pedido sin UV deja una parte de UV vacía. */
export const parteConAlgo = (p: PedidoResumen) =>
  num(p.total) !== 0 || num(p.metros_total) > 0 || num(p.metros_uv) > 0;

/** Las cifras de una línea (o de las dos juntas). */
export type CifrasLinea = KpisPeriodo & {
  /** Pedidos con algo de esta línea (no cancelados). Un mixto cuenta en las dos. */
  pedidos: number;
  /** Metros de DTF (`metros_total`). 0 en la línea UV. */
  metros: number;
  /** Metros de DTF UV. 0 en la línea DTF. */
  metrosUv: number;
  /** Producción del DTF propio y lo que cobra la subcontrata por el UV. */
  coste: number;
  /** Bruta − coste. El envío no deja ni quita: se paga lo que se cobra. */
  ganancia: number;
  /** Bruta por metro de su línea, o 0 sin metros. En «todo», sin sentido: 0. */
  euroMetro: number;
  /** Ganancia por metro de su línea, o 0 sin metros. En «todo», 0. */
  gananciaMetro: number;
};

function cifras(
  partes: readonly PedidoResumen[],
  costeDtf: number,
  costeUv: number | undefined,
  linea: FiltroLinea,
): CifrasLinea {
  // En «todo» van todos los pedidos, como siempre; en una línea, solo los
  // que llevan algo de ella (un pedido sin UV deja una parte de UV vacía).
  const conAlgo = linea === "todo" ? partes : partes.filter(parteConAlgo);
  const k = calcularKpis(conAlgo);
  const validos = conAlgo.filter((p) => p.estado !== ESTADO_CANCELADO);
  const metrosUv = redondear(
    validos.reduce((s, p) => s + num(p.metros_uv), 0),
    3,
  );
  const coste = costeProduccion(validos, costeDtf, costeUv);
  const metrosDeLinea = linea === "dtf" ? k.metros : linea === "uv" ? metrosUv : 0;
  const ganancia = redondear(k.bruta - coste);
  return {
    ...k,
    metrosUv,
    coste,
    ganancia,
    euroMetro: metrosDeLinea > 0 ? redondear(k.bruta / metrosDeLinea) : 0,
    gananciaMetro: metrosDeLinea > 0 ? redondear(ganancia / metrosDeLinea) : 0,
  };
}

/**
 * Las cifras de unos pedidos: las dos líneas juntas (`todo`) y cada una.
 * `todo` es la suma exacta de `dtf` y `uv` en importes; los metros van
 * siempre separados (`metros` el DTF, `metrosUv` el UV).
 *
 * `costeDtf`: el coste por metro de hoy para los pedidos sin coste congelado.
 * `costeUv`: lo mismo para el UV (por defecto, el de kpis.ts).
 */
export function cifrasPorLinea(
  pedidos: readonly PedidoPartible[],
  costeDtf = 0,
  costeUv?: number,
): Record<FiltroLinea, CifrasLinea> {
  const { dtf, uv } = partirPedidos(pedidos);
  const todo = cifras(pedidos, costeDtf, costeUv, "todo");
  const deUv = cifras(uv, costeDtf, costeUv, "uv");
  const deDtf = cifras(dtf, costeDtf, costeUv, "dtf");
  // Los euros del DTF, por diferencia: redondear cada línea por su lado podía
  // descuadrar un céntimo, y DTF + UV tiene que dar el total exacto.
  const resto = (k: (typeof DINERO)[number]) => redondear(todo[k] - deUv[k]);
  const dinero = Object.fromEntries(DINERO.map((k) => [k, resto(k)])) as Pick<
    CifrasLinea,
    (typeof DINERO)[number]
  >;
  return {
    todo,
    dtf: {
      ...deDtf,
      ...dinero,
      ticket: deDtf.pedidos ? redondear(dinero.total / deDtf.pedidos) : 0,
      euroMetro: deDtf.metros > 0 ? redondear(dinero.bruta / deDtf.metros) : 0,
      gananciaMetro: deDtf.metros > 0 ? redondear(dinero.ganancia / deDtf.metros) : 0,
    },
    uv: deUv,
  };
}

/** Los importes que se cuadran por diferencia entre líneas. */
const DINERO = [
  "base",
  "bruta",
  "iva",
  "envios",
  "total",
  "devuelto",
  "coste",
  "ganancia",
] as const;

/** Los pedidos de una línea (sus partes), o todos con `todo`. */
export function pedidosDeLinea<P extends PedidoPartible>(
  pedidos: readonly P[],
  linea: FiltroLinea,
): P[] {
  if (linea === "todo") return [...pedidos];
  return partirPedidos(pedidos)[linea].filter(parteConAlgo);
}

// ---------------------------------------------------------------------------
// Gerencia: las ventas, los cobros y los pendientes de una línea
// ---------------------------------------------------------------------------

/**
 * La parte de DTF UV de un pedido, presentada como si fuera la única línea:
 * sus metros en `metros_total` y lo que cobra la subcontrata como coste por
 * metro. Así todo lo que en Gerencia lee metros, €/m, coste y margen de un
 * pedido (kpis.ts, gerencia.ts) da las cifras del UV sin tocar cada pantalla.
 */
function uvComoUnicaLinea<P extends PedidoPartible>(p: P): P {
  const coste = p.coste_uv_snapshot;
  return {
    ...p,
    metros_total: p.metros_uv ?? 0,
    metros_uv: 0,
    coste_metro_snapshot: coste == null || coste === "" ? COSTE_UV_POR_DEFECTO : coste,
    coste_uv_snapshot: null,
    // Ya es una sola línea: partirla otra vez no le quita nada.
    bruta_uv: 0,
    iva_uv: 0,
  };
}

/**
 * Las ventas de Gerencia de una línea. «Todo», tal cual. «DTF», la parte de
 * DTF de los pedidos de tienda: el textil (ropa) es otro negocio y solo sale
 * en «Todo». «DTF UV», la parte de UV, presentada como única línea (ver
 * uvComoUnicaLinea).
 *
 * Ojo con «DTF UV»: como va de única línea, `cifrasGerencia` da su coste en
 * `costeDtf` (no en `costeUv`), sus metros en `metros` y sus portes en
 * `costeEnvios`. Las pantallas lo rotulan según la línea elegida;
 * cifrasGerenciaPorLinea sí los pone en su sitio.
 */
export function ventasDeLinea<P extends PedidoPartible & { canal?: string }>(
  ventas: readonly P[],
  linea: FiltroLinea,
): P[] {
  if (linea === "todo") return [...ventas];
  const deTienda = ventas.filter((v) => v.canal !== "textil");
  const partes = pedidosDeLinea(deTienda, linea);
  return linea === "uv" ? partes.map(uvComoUnicaLinea) : partes;
}

/**
 * Los cobros de una línea. Un cobro es de un pedido entero, así que va con
 * la línea del pedido: los de pedidos solo de UV (`soloUv`, sus ids) al UV y
 * el resto de tienda al DTF; los de un pedido mixto, con el DTF. El textil,
 * solo en «Todo».
 */
export function cobrosDeLinea<C extends { pedido_id: string; tienda_id: string }>(
  cobros: readonly C[],
  linea: FiltroLinea,
  soloUv: ReadonlySet<string>,
  tiendaTextil: string,
): C[] {
  if (linea === "todo") return [...cobros];
  if (linea === "uv") return cobros.filter((c) => soloUv.has(c.pedido_id));
  return cobros.filter((c) => c.tienda_id !== tiendaTextil && !soloUv.has(c.pedido_id));
}

/** Los pedidos pendientes de cobro de una línea, con la misma regla que los cobros. */
export function pendientesDeLinea<P extends { id: string; tipo: string }>(
  pendientes: readonly P[],
  linea: FiltroLinea,
  soloUv: ReadonlySet<string>,
): P[] {
  if (linea === "todo") return [...pendientes];
  if (linea === "uv") return pendientes.filter((p) => p.tipo !== "textil" && soloUv.has(p.id));
  return pendientes.filter((p) => p.tipo !== "textil" && !soloUv.has(p.id));
}

/**
 * Lo de cada línea de producto en las líneas de un pedido hecho a mano (o de
 * un presupuesto): los metros de DTF (`metros_total`, la suma de cantidades
 * de las líneas de DTF, como hasta ahora), los de DTF UV y la base y el IVA
 * de las líneas de UV (`bruta_uv`, `iva_uv`). Una línea sin `linea` es de DTF.
 */
export function lineasDeUnPedido(
  items: readonly {
    cantidad: number;
    precio_unitario: number;
    iva_rate: number;
    descuento_pct?: number;
    linea?: LineaProducto | null;
  }[],
): { metros_total: number; metros_uv: number; bruta_uv: number; iva_uv: number } {
  let metros_total = 0;
  let metros_uv = 0;
  let bruta_uv = 0;
  let iva_uv = 0;
  for (const it of items) {
    if (it.linea === "uv") {
      const l = calcularLinea(it);
      metros_uv += Number(it.cantidad) || 0;
      bruta_uv += l.base;
      iva_uv += l.cuota;
    } else metros_total += Number(it.cantidad) || 0;
  }
  return {
    metros_total: redondear(metros_total, 3),
    metros_uv: redondear(metros_uv, 3),
    bruta_uv: redondear(bruta_uv),
    iva_uv: redondear(iva_uv),
  };
}

/**
 * Los metros de un pedido tal como los ve el cliente (correos): los de DTF y
 * los de DTF UV juntos. Es lo único que los suma: en las cifras de la empresa
 * van siempre separados.
 */
export function metrosDelPedidoParaElCliente(p: {
  metros_total?: number | string | null;
  metros_uv?: number | string | null;
}): number {
  return redondear(num(p.metros_total) + num(p.metros_uv), 3);
}
