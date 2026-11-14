/**
 * La cuenta de resultados: un solo diccionario de cifras de dinero y una sola
 * forma de calcularlas.
 *
 * ## Por qué existe
 *
 * Cada pantalla tenía su «Vendido», su «Margen» y su «Facturado», con el mismo
 * nombre y fórmulas distintas: con o sin textil, con el envío real o
 * suponiendo que deja cero, con o sin IVA. Aquí está la lista cerrada de
 * conceptos (decisión de Javier, 14-11-2026) y la función que los calcula.
 * Las pantallas solo leen de aquí.
 *
 * ## Criterios (decisión de Javier, 14-11-2026)
 *
 * - **Fecha**: cada venta, por el día del pedido. Cada devolución, por el día
 *   en que se devolvió el dinero, no por el del pedido: un reembolso de
 *   noviembre no cambia octubre.
 * - **Qué cuenta**: los pedidos no cancelados de las tiendas y del textil. Los
 *   de la web sin pagar (estado «pendiente») no son venta todavía.
 * - **Sin IVA**, salvo «Ventas con IVA», «IVA» y el bloque de dinero (cobrado,
 *   pendiente), que es dinero de verdad.
 * - **Nada inventado**: lo que no se sabe vale `null` y dice qué falta; lo que
 *   se estima lleva la marca `estimado`.
 *
 * Reutiliza el cálculo que ya existía (kpis.ts, gerencia.ts, resumen-diario.ts,
 * por-linea.ts): no hay una segunda fórmula de nada.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { eachMonthOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { redondear } from "./importes";
import {
  ESTADO_CANCELADO,
  baseConEnvio,
  costeProduccion,
  COSTE_UV_POR_DEFECTO,
  variacion,
  type PedidoResumen,
} from "./kpis";
import type { GastoFijo, Venta } from "./gerencia";
import { costeEnvio } from "./resumen-diario";
import {
  cobrosDeLinea,
  ETIQUETA_FILTRO_LINEA,
  partirPedido,
  partirPedidos,
  pendientesDeLinea,
  type FiltroLinea,
} from "./por-linea";
import { gastosFijosPorGrupo } from "./grupos";
import { TIENDA_TEXTIL } from "./cobros";
import { totalizar, type CobroConsolidado } from "./facturacion";
import { tiendaDelPendiente, type PedidoPendiente } from "./pendientes";
import { diaDelPedido } from "./dia-pedido";
import { diaDeFecha, type Rango } from "./periodos";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// El diccionario
// ---------------------------------------------------------------------------

export type ClaveConcepto =
  | "ventas_con_iva"
  | "iva"
  | "portes_cobrados"
  | "ventas"
  | "devoluciones"
  | "ventas_netas"
  | "coste_produccion"
  | "resultado_portes"
  | "margen_bruto"
  | "gastos_estructura"
  | "beneficio_antes_impuestos"
  | "sociedades"
  | "beneficio_neto"
  | "cobrado"
  | "pendiente_cobro"
  | "pendiente_pago";

export type Concepto = {
  clave: ClaveConcepto;
  /** El nombre, el mismo en todas las pantallas. */
  nombre: string;
  /** Una línea para un socio que no es contable. */
  definicion: string;
  /** Cómo entra en la cascada: suma, resta o es un resultado. Informativo en «dinero». */
  signo: "+" | "−" | "=" | "·";
  bloque: "resultados" | "dinero";
  /** Si la cifra lleva IVA. */
  conIva: boolean;
  /** Un resultado de la cascada: se pinta destacado. */
  destacado?: boolean;
};

export const CONCEPTOS: readonly Concepto[] = [
  {
    clave: "ventas_con_iva",
    nombre: "Ventas con IVA",
    definicion: "Lo que pagan los clientes por sus pedidos, con IVA y envío.",
    signo: "·",
    bloque: "resultados",
    conIva: true,
  },
  {
    clave: "iva",
    nombre: "IVA",
    definicion: "La parte que es de Hacienda: no es nuestra.",
    signo: "−",
    bloque: "resultados",
    conIva: true,
  },
  {
    clave: "portes_cobrados",
    nombre: "Portes cobrados",
    definicion: "Lo que pagan los clientes por el envío, sin IVA.",
    signo: "−",
    bloque: "resultados",
    conIva: false,
  },
  {
    clave: "ventas",
    nombre: "Ventas",
    definicion: "Lo que facturamos por nuestro trabajo: sin IVA y sin el envío.",
    signo: "=",
    bloque: "resultados",
    conIva: false,
    destacado: true,
  },
  {
    clave: "devoluciones",
    nombre: "Devoluciones",
    definicion: "El dinero devuelto a clientes, sin IVA, el día que se devolvió.",
    signo: "−",
    bloque: "resultados",
    conIva: false,
  },
  {
    clave: "ventas_netas",
    nombre: "Ventas netas",
    definicion: "Ventas menos devoluciones.",
    signo: "=",
    bloque: "resultados",
    conIva: false,
    destacado: true,
  },
  {
    clave: "coste_produccion",
    nombre: "Coste de producción",
    definicion:
      "Lo que cuesta fabricar: metros de DTF, lo que cobra la subcontrata del UV y la ropa.",
    signo: "−",
    bloque: "resultados",
    conIva: false,
  },
  {
    clave: "resultado_portes",
    nombre: "Resultado de los envíos",
    definicion:
      "Portes cobrados menos lo que cobra la agencia: lo que se gana o se pierde enviando.",
    signo: "+",
    bloque: "resultados",
    conIva: false,
  },
  {
    clave: "margen_bruto",
    nombre: "Margen bruto",
    definicion: "Lo que queda de las ventas tras fabricar y enviar.",
    signo: "=",
    bloque: "resultados",
    conIva: false,
    destacado: true,
  },
  {
    clave: "gastos_estructura",
    nombre: "Gastos de estructura",
    definicion:
      "Lo que cuesta tener la empresa abierta: alquiler, sueldos, cuotas, compras, amortizaciones y mermas.",
    signo: "−",
    bloque: "resultados",
    conIva: false,
  },
  {
    clave: "beneficio_antes_impuestos",
    nombre: "Beneficio antes de impuestos",
    definicion: "Lo que gana la empresa antes del Impuesto sobre Sociedades.",
    signo: "=",
    bloque: "resultados",
    conIva: false,
    destacado: true,
  },
  {
    clave: "sociedades",
    nombre: "Impuesto sobre Sociedades",
    definicion: "Estimado: el de verdad lo calcula la gestoría.",
    signo: "−",
    bloque: "resultados",
    conIva: false,
  },
  {
    clave: "beneficio_neto",
    nombre: "Beneficio neto",
    definicion: "Lo que queda para la empresa después de todo, impuestos incluidos.",
    signo: "=",
    bloque: "resultados",
    conIva: false,
    destacado: true,
  },
  {
    clave: "cobrado",
    nombre: "Cobrado",
    definicion: "El dinero que ha entrado de clientes en el periodo, con IVA.",
    signo: "·",
    bloque: "dinero",
    conIva: true,
  },
  {
    clave: "pendiente_cobro",
    nombre: "Pendiente de cobro",
    definicion: "Lo que nos deben hoy los clientes, con IVA.",
    signo: "·",
    bloque: "dinero",
    conIva: true,
  },
  {
    clave: "pendiente_pago",
    nombre: "Pendiente de pago",
    definicion: "Lo que debemos hoy a proveedores, con IVA.",
    signo: "·",
    bloque: "dinero",
    conIva: true,
  },
];

export function concepto(clave: ClaveConcepto): Concepto {
  return CONCEPTOS.find((c) => c.clave === clave)!;
}

// ---------------------------------------------------------------------------
// Las cifras
// ---------------------------------------------------------------------------

/**
 * Una cifra de la cuenta. `valor` nulo: no se puede saber, y `falta` dice
 * por qué. `estimado`: se sabe a medias, y `nota` dice qué se ha supuesto.
 */
export type Cifra = {
  valor: number | null;
  estimado?: boolean;
  nota?: string;
  falta?: string;
};

const cifra = (valor: number, extra: Omit<Cifra, "valor"> = {}): Cifra => ({
  valor: redondear(valor),
  ...extra,
});
const sinDato = (falta: string): Cifra => ({ valor: null, falta });

/** Una venta con lo que hace falta para el envío (ver resumen-diario.ts, costeEnvio). */
export type VentaCuenta = Venta & {
  /** Lo que cobró la agencia, sin IVA; vacío si no se apuntó. */
  coste_envio_real?: Numerico;
  /** Si el pedido lleva envío (se cobró envío o tiene seguimiento). */
  con_envio?: boolean;
};

/** Un reembolso, con su día y lo justo de su pedido para quitarle el IVA. */
export type DevolucionCuenta = {
  /** 'yyyy-mm-dd': el día en que se devolvió el dinero. */
  fecha: string;
  /** Lo devuelto, con IVA. */
  importe: Numerico;
  /** La tienda del pedido: para filtrar y separar por tienda. */
  tienda_id?: string;
  /**
   * El pedido: con su base y su total para quitarle el IVA; con su estado
   * (un pedido cancelado no es venta, y su reembolso no la resta) y con lo
   * del DTF UV para repartir el reembolso por línea.
   */
  pedido: Pick<PedidoResumen, "subtotal" | "iva" | "envio" | "total"> &
    Partial<Pick<PedidoResumen, "estado" | "metros_total" | "metros_uv" | "bruta_uv" | "iva_uv">>;
};

/** Gastos de estructura del periodo, sin IVA (ver grupos.ts, gastosFijosPorGrupo). */
export type EstructuraCuenta = {
  fijos: number;
  compras: number;
  amortizacion: number;
  /** Mermas y ajustes del almacén textil. */
  almacen: number;
  /** Si entre los gastos fijos hay nóminas dadas de alta. Sin ellas, la cifra está incompleta. */
  conNominas: boolean;
};

export type EntradaCuenta = {
  /** Las ventas con fecha de pedido en el periodo (las canceladas se quitan aquí). */
  ventas: readonly VentaCuenta[];
  /** Los reembolsos con fecha en el periodo. */
  devoluciones: readonly DevolucionCuenta[];
  /** Coste por metro de hoy, para los pedidos sin coste congelado. */
  costeMetroActual: number;
  /** Lo que cobra la subcontrata por metro de UV hoy. */
  costeUvActual?: number;
  /** Lo que se estima que cobra la agencia por envío, sin IVA. */
  costeEnvioDefecto: number;
  /**
   * Los gastos de estructura. Nulo cuando hay un filtro de tienda o línea:
   * el alquiler no es de una tienda, y repartirlo sería inventar.
   */
  estructura: EstructuraCuenta | null;
  /** Tipo del Impuesto sobre Sociedades, en %. Nulo si no está en Ajustes. */
  tipoIs: number | null;
  /**
   * Base sobre la que se estima el impuesto (el beneficio de lo documentado,
   * ver grupos.ts). Sin ella, el beneficio antes de impuestos.
   */
  baseSociedades?: number | null;
  /** El bloque de dinero. Cada cifra, nula si la pantalla no la ha leído. */
  dinero?: {
    cobrado?: number | null;
    pendienteCobro?: number | null;
    pendientePago?: number | null;
  };
};

export type Cuenta = Record<ClaveConcepto, Cifra> & {
  /** Pedidos que cuentan (no cancelados ni web sin pagar). */
  pedidos: number;
  /** Metros de DTF y de DTF UV, aparte: no se suman nunca. */
  metros: number;
  metrosUv: number;
  /** Margen bruto ÷ ventas netas, en %. Nulo sin ventas. */
  margenPct: number | null;
  /** Ventas netas ÷ pedidos, sin IVA. Nulo sin pedidos. */
  ticketMedio: number | null;
};

/**
 * Qué ventas cuentan: ni las canceladas ni las de la web sin pagar
 * (decisión de Javier, 14-11-2026: no pagado no es venta).
 */
export function ventasQueCuentan<T extends Pick<Venta, "estado" | "canal">>(
  ventas: readonly T[],
): T[] {
  return ventas.filter(
    (v) => v.estado !== ESTADO_CANCELADO && !(v.canal === "web" && v.estado === "pendiente"),
  );
}

/**
 * Las ventas de una línea: DTF, DTF UV (de cada pedido, su parte) o todo. El
 * textil (ropa) es otro negocio: solo sale en «Todo», como en por-linea.ts.
 */
export function ventasDeLaLinea<T extends VentaCuenta>(
  ventas: readonly T[],
  linea: FiltroLinea,
): T[] {
  if (linea === "todo") return [...ventas];
  return partirPedidos(ventas.filter((v) => v.canal !== "textil"))[linea];
}

/**
 * Una devolución sin IVA: su parte de la base del pedido. WooCommerce da
 * solo el importe con IVA; se reparte en la proporción base/total del pedido
 * (ver kpis.ts, parteVendida).
 */
export function devolucionSinIva(d: DevolucionCuenta): number {
  const total = num(d.pedido.total);
  if (total <= 0) return 0;
  return (num(d.importe) * baseConEnvio(d.pedido)) / total;
}

/** Los reembolsos que restan: no los de pedidos cancelados (no son venta). */
export function devolucionesQueCuentan<T extends DevolucionCuenta>(devs: readonly T[]): T[] {
  return devs.filter((d) => d.pedido.estado !== ESTADO_CANCELADO);
}

/** La cuenta de resultados de un periodo. */
export function calcularCuenta(e: EntradaCuenta): Cuenta {
  const ventas = ventasQueCuentan(e.ventas);

  // 1-4. Las ventas del periodo, enteras: lo devuelto va en su propio día (5).
  const conIva = ventas.reduce((s, v) => s + num(v.total), 0);
  const iva = ventas.reduce((s, v) => s + num(v.iva), 0);
  const portes = ventas.reduce((s, v) => s + num(v.envio), 0);
  const base = ventas.reduce((s, v) => s + baseConEnvio(v), 0);
  const ventasSinPortes = base - portes;

  // 5-6. Las devoluciones, por el día del reembolso.
  // Un reembolso de un pedido cancelado no resta: ese pedido no es venta.
  const devuelto = devolucionesQueCuentan(e.devoluciones).reduce(
    (s, d) => s + devolucionSinIva(d),
    0,
  );
  const netas = ventasSinPortes - devuelto;

  // 7. Producción: DTF y UV con su coste congelado, y la ropa del textil.
  const textilSinCoste = ventas.filter(
    (v) => v.canal === "textil" && v.coste_textil == null,
  ).length;
  const produccion =
    costeProduccion(ventas, e.costeMetroActual, e.costeUvActual ?? COSTE_UV_POR_DEFECTO) +
    ventas.reduce((s, v) => s + num(v.coste_textil), 0);

  // 8. Envíos: lo cobrado menos lo que cobra la agencia.
  let costeEnvios = 0;
  let enviosEstimados = 0;
  for (const v of ventas) {
    const c = costeEnvio(
      { ...v, coste_envio_real: v.coste_envio_real, con_envio: v.con_envio ?? num(v.envio) > 0 },
      e.costeEnvioDefecto,
    );
    costeEnvios += c.coste;
    if (c.estimado) enviosEstimados++;
  }
  const resultadoPortes = portes - costeEnvios;
  const margen = netas - produccion + resultadoPortes;

  // 10-12. Estructura e impuesto: solo sin filtros.
  let estructura: Cifra;
  let bai: Cifra;
  let sociedades: Cifra;
  let neto: Cifra;
  if (!e.estructura) {
    const motivo =
      "Solo con todas las tiendas y todas las líneas: los gastos no son de una tienda.";
    estructura = sinDato(motivo);
    bai = sinDato(motivo);
    sociedades = sinDato(motivo);
    neto = sinDato(motivo);
  } else {
    const g = e.estructura;
    const total = g.fijos + g.compras + g.amortizacion + g.almacen;
    estructura = cifra(
      total,
      g.conNominas ? {} : { estimado: true, nota: "Incompleto: no hay nóminas dadas de alta." },
    );
    const valorBai = margen - total;
    bai = cifra(valorBai, estructura.estimado ? { estimado: true, nota: estructura.nota } : {});
    if (e.tipoIs == null) {
      sociedades = sinDato("Falta el tipo del impuesto en Ajustes de Gerencia.");
      neto = sinDato("Falta el tipo del impuesto en Ajustes de Gerencia.");
    } else {
      const baseIs = e.baseSociedades ?? valorBai;
      const is = baseIs > 0 ? (baseIs * e.tipoIs) / 100 : 0;
      sociedades = cifra(is, { estimado: true, nota: "Lo calcula la gestoría." });
      neto = cifra(valorBai - is, { estimado: true, nota: "Con el impuesto estimado." });
    }
  }

  const dinero = (v: number | null | undefined, falta: string): Cifra =>
    v == null ? sinDato(falta) : cifra(v);

  const valorNetas = redondear(netas);
  const valorMargen = redondear(margen);
  return {
    ventas_con_iva: cifra(conIva),
    iva: cifra(iva),
    portes_cobrados: cifra(portes),
    ventas: cifra(ventasSinPortes),
    devoluciones: cifra(devuelto),
    ventas_netas: cifra(netas),
    coste_produccion: cifra(
      produccion,
      textilSinCoste > 0
        ? {
            estimado: true,
            nota: `${textilSinCoste} ${textilSinCoste === 1 ? "pedido textil" : "pedidos textil"} sin la ropa sacada del almacén: van sin coste.`,
          }
        : {},
    ),
    resultado_portes: cifra(
      resultadoPortes,
      enviosEstimados > 0
        ? {
            estimado: true,
            nota: `Coste del envío estimado en ${enviosEstimados} ${enviosEstimados === 1 ? "pedido" : "pedidos"}.`,
          }
        : {},
    ),
    margen_bruto: cifra(
      margen,
      textilSinCoste > 0 || enviosEstimados > 0
        ? { estimado: true, nota: "Lleva costes estimados: mira producción y envíos." }
        : {},
    ),
    gastos_estructura: estructura,
    beneficio_antes_impuestos: bai,
    sociedades,
    beneficio_neto: neto,
    cobrado: dinero(e.dinero?.cobrado, "No se ha leído lo cobrado."),
    pendiente_cobro: dinero(e.dinero?.pendienteCobro, "No se ha leído lo pendiente."),
    pendiente_pago: dinero(e.dinero?.pendientePago, "No se han leído los pagos pendientes."),
    pedidos: ventas.length,
    metros: redondear(
      ventas.reduce((s, v) => s + num(v.metros_total), 0),
      3,
    ),
    metrosUv: redondear(
      ventas.reduce((s, v) => s + num(v.metros_uv), 0),
      3,
    ),
    margenPct: valorNetas > 0 ? redondear((valorMargen / valorNetas) * 100, 1) : null,
    ticketMedio: ventas.length > 0 ? redondear(netas / ventas.length) : null,
  };
}

// ---------------------------------------------------------------------------
// El bloque de dinero
// ---------------------------------------------------------------------------

/**
 * Lo que nos deben hoy: de cada pedido que cuenta, el total menos lo cobrado
 * y lo devuelto, nunca por debajo de cero (un pedido cobrado de más no
 * compensa lo que debe otro). Una sola definición para toda la aplicación.
 */
export function pendienteDeCobro(
  pedidos: readonly {
    estado: string;
    canal?: string;
    total: Numerico;
    devuelto?: Numerico;
    cobrado: Numerico;
  }[],
): number {
  return redondear(
    pedidos
      .filter((p) => p.estado !== ESTADO_CANCELADO)
      .reduce((s, p) => s + Math.max(0, num(p.total) - num(p.devuelto) - num(p.cobrado)), 0),
  );
}

/**
 * Lo que nos deben hoy, desde la vista de pendientes de cobro (la misma que
 * la pantalla Cobros pendientes), con los filtros de la cuenta. Sin los
 * pedidos de la web sin pagar: no son venta todavía (decisión de Javier,
 * 14-11-2026), así que tampoco son una deuda del cliente.
 */
export function pendienteDeCobroHoy(
  pendientes: readonly PedidoPendiente[],
  f: FiltroCuenta,
  soloUv: ReadonlySet<string> = new Set(),
): number {
  const deTienda =
    f.tienda === TODAS ? pendientes : pendientes.filter((p) => tiendaDelPendiente(p) === f.tienda);
  return redondear(
    pendientesDeLinea(deTienda, f.linea, soloUv)
      .filter((p) => !esWebSinPagar(p))
      .reduce((s, p) => s + num(p.pendiente), 0),
  );
}

/** Un pedido de la web que el cliente aún no ha pagado: no es venta. */
export const esWebSinPagar = (p: Pick<PedidoPendiente, "tipo" | "origen" | "estado">) =>
  p.tipo === "tienda" && p.origen === "woocommerce" && p.estado === "pendiente";

/**
 * Lo cobrado en el periodo (con IVA, sin propinas), de las tiendas y del
 * textil, con los filtros de la cuenta. Los cobros llegan ya fechados por el
 * día del cobro (useCobrosPeriodo con criterio «cobro»).
 */
export function cobradoDelPeriodo(
  cobros: readonly CobroConsolidado[],
  f: FiltroCuenta,
  soloUv: ReadonlySet<string> = new Set(),
): number {
  const deTienda = f.tienda === TODAS ? cobros : cobros.filter((c) => c.tienda_id === f.tienda);
  return totalizar(cobrosDeLinea(deTienda, f.linea, soloUv, TIENDA_TEXTIL.id)).cobrado;
}

// ---------------------------------------------------------------------------
// Filtros y columnas
// ---------------------------------------------------------------------------

/** «Todas las tiendas»: el valor del filtro de tienda sin filtrar. */
export const TODAS = "todas";

/** Lo que se mira: una tienda (o el textil, TIENDA_TEXTIL.id) o todas, y una línea. */
export type FiltroCuenta = { tienda: string; linea: FiltroLinea };

export const FILTRO_CUENTA_TODO: FiltroCuenta = { tienda: TODAS, linea: "todo" };

/**
 * Si los gastos de estructura (y lo que sale de ellos) se pueden enseñar: solo
 * sin filtros. El alquiler no es de una tienda ni de una línea, y repartirlo
 * sería inventar.
 */
export const conEstructura = (f: FiltroCuenta) => f.tienda === TODAS && f.linea === "todo";

/** Las ventas de una tienda (o del textil) y de una línea. */
export function ventasDelFiltro<T extends VentaCuenta>(ventas: readonly T[], f: FiltroCuenta): T[] {
  const deTienda = f.tienda === TODAS ? ventas : ventas.filter((v) => v.tienda_id === f.tienda);
  return ventasDeLaLinea(deTienda, f.linea);
}

/**
 * Los reembolsos de una línea. Un reembolso es de un pedido entero; el de un
 * pedido mixto (DTF y DTF UV) se reparte en la misma proporción que su total
 * (ver partirPedido). El textil no tiene reembolsos.
 */
export function devolucionesDeLaLinea<T extends DevolucionCuenta>(
  devs: readonly T[],
  linea: FiltroLinea,
): T[] {
  if (linea === "todo") return [...devs];
  return devs
    .map((d) => {
      const pedido: PedidoResumen = {
        fecha_pedido: "",
        tienda_id: d.tienda_id ?? "",
        estado: d.pedido.estado ?? "",
        metros_total: d.pedido.metros_total ?? 0,
        ...d.pedido,
      };
      const parte = partirPedido(pedido)[linea];
      const total = num(d.pedido.total);
      const proporcion = total > 0 ? num(parte.total) / total : linea === "dtf" ? 1 : 0;
      return {
        ...d,
        importe: num(d.importe) * proporcion,
        pedido: { ...d.pedido, ...parte },
      };
    })
    .filter((d) => num(d.importe) !== 0);
}

/** Los reembolsos de una tienda y de una línea. */
export function devolucionesDelFiltro<T extends DevolucionCuenta>(
  devs: readonly T[],
  f: FiltroCuenta,
): T[] {
  const deTienda = f.tienda === TODAS ? devs : devs.filter((d) => d.tienda_id === f.tienda);
  return devolucionesDeLaLinea(deTienda, f.linea);
}

/**
 * Los gastos de estructura de un rango, sin IVA: los gastos fijos (con y sin
 * justificante), las compras que cuestan como gasto y las amortizaciones
 * (gastosFijosPorGrupo, hasta hoy si el rango sigue en curso), más las
 * mermas y ajustes del almacén textil (costeAlmacenPeriodo).
 */
export function estructuraDelPeriodo(
  gastos: readonly GastoFijo[],
  rango: Rango,
  almacen: number,
  hoy?: Date,
): EstructuraCuenta {
  const g = gastosFijosPorGrupo(gastos, rango, hoy);
  return {
    fijos: g.total,
    compras: g.compras,
    amortizacion: g.amortizacion,
    almacen: redondear(almacen),
    conNominas: gastos.some((x) => (x.origen ?? "gasto") === "gasto" && x.tipo === "nomina"),
  };
}

/** Cómo se separa la cuenta en columnas. */
export type SepararPor = "nada" | "tienda" | "linea" | "mes";

export const OPCIONES_SEPARAR: readonly { valor: SepararPor; etiqueta: string }[] = [
  { valor: "nada", etiqueta: "Nada" },
  { valor: "tienda", etiqueta: "Tienda" },
  { valor: "linea", etiqueta: "Línea" },
  { valor: "mes", etiqueta: "Mes" },
];

export const esSepararPor = (v: unknown): v is SepararPor =>
  OPCIONES_SEPARAR.some((o) => o.valor === v);

/** Los meses que toca un rango, recortados a él. */
export function mesesDelRango(r: Rango): (Rango & { etiqueta: string })[] {
  if (r.desde > r.hasta) return [];
  const varios = r.desde.getFullYear() !== r.hasta.getFullYear();
  return eachMonthOfInterval({ start: r.desde, end: r.hasta }).map((m) => ({
    desde: m < r.desde ? r.desde : startOfMonth(m),
    hasta: endOfMonth(m) > r.hasta ? r.hasta : endOfMonth(m),
    etiqueta: format(m, varios ? "MMM yy" : "MMMM", { locale: es }),
  }));
}

export type ColumnaCuenta = {
  clave: string;
  titulo: string;
  cuenta: Cuenta;
};

/**
 * La cuenta separada en columnas, cada una calculada por separado con
 * calcularCuenta: por tienda (y el textil), por línea (DTF, DTF UV y, aparte,
 * el textil) o por mes. Por tienda o por línea, sin estructura: los gastos no
 * son de una tienda ni de una línea. Por mes, la de cada mes si la entrada
 * la trae (`estructuraDe` da la de un mes).
 */
export function separarCuenta(
  e: EntradaCuenta,
  por: SepararPor,
  opciones: {
    tiendas?: readonly { id: string; nombre: string }[];
    rango?: Rango;
    estructuraDe?: (r: Rango) => EstructuraCuenta | null;
  } = {},
): ColumnaCuenta[] {
  const sinEstructura: EntradaCuenta = {
    ...e,
    estructura: null,
    baseSociedades: undefined,
    dinero: undefined,
  };
  if (por === "tienda") {
    const tiendas = [...(opciones.tiendas ?? []), TIENDA_TEXTIL];
    const ids = new Set(e.ventas.map((v) => v.tienda_id));
    for (const d of e.devoluciones) if (d.tienda_id) ids.add(d.tienda_id);
    return tiendas
      .filter((t) => ids.has(t.id))
      .map((t) => {
        const f: FiltroCuenta = { tienda: t.id, linea: "todo" };
        return {
          clave: t.id,
          titulo: t.nombre,
          cuenta: calcularCuenta({
            ...sinEstructura,
            ventas: ventasDelFiltro(e.ventas, f),
            devoluciones: devolucionesDelFiltro(e.devoluciones, f),
          }),
        };
      });
  }
  if (por === "linea") {
    const columnas: ColumnaCuenta[] = (["dtf", "uv"] as const).map((l) => ({
      clave: l,
      titulo: ETIQUETA_FILTRO_LINEA[l],
      cuenta: calcularCuenta({
        ...sinEstructura,
        ventas: ventasDeLaLinea(e.ventas, l),
        devoluciones: devolucionesDeLaLinea(e.devoluciones, l),
      }),
    }));
    const textil = e.ventas.filter((v) => v.canal === "textil");
    if (textil.length > 0) {
      columnas.push({
        clave: "textil",
        titulo: "Textil",
        cuenta: calcularCuenta({ ...sinEstructura, ventas: textil, devoluciones: [] }),
      });
    }
    return columnas;
  }
  if (por === "mes" && opciones.rango) {
    return mesesDelRango(opciones.rango).map((m) => {
      const desde = diaDeFecha(m.desde);
      const hasta = diaDeFecha(m.hasta);
      const enMes = (dia: string) => dia >= desde && dia <= hasta;
      return {
        clave: desde,
        titulo: m.etiqueta,
        cuenta: calcularCuenta({
          ...e,
          dinero: undefined,
          baseSociedades: undefined,
          ventas: e.ventas.filter((v) => enMes(diaDelPedido(v))),
          devoluciones: e.devoluciones.filter((d) => enMes(d.fecha.slice(0, 10))),
          estructura: e.estructura && opciones.estructuraDe ? opciones.estructuraDe(m) : null,
        }),
      };
    });
  }
  return [];
}

// ---------------------------------------------------------------------------
// Para pintar
// ---------------------------------------------------------------------------

/** La variación de una cifra frente al periodo anterior, en %. Nula si falta alguna. */
export function variacionCifra(actual: Cifra, anterior: Cifra | undefined): number | null {
  if (!anterior || actual.valor === null || anterior.valor === null) return null;
  return variacion(actual.valor, anterior.valor);
}

/** Una cifra de la cascada sobre las ventas netas, en %. Nula sin ventas netas. */
export function sobreVentasNetas(c: Cifra, netas: Cifra): number | null {
  if (c.valor === null || netas.valor === null || netas.valor <= 0) return null;
  return redondear((c.valor / netas.valor) * 100, 1);
}

/** El IVA sobre la base (las ventas más los portes), en %. Nulo sin base. */
export function pctIva(iva: number, base: number): number | null {
  return base > 0 ? redondear((iva / base) * 100, 1) : null;
}

/**
 * El coste por metro de hoy: consumibles + packaging + electricidad, de los
 * datos de la empresa. Una sola suma para toda la aplicación.
 */
export function costeMetroDeEmpresa(
  e:
    | {
        coste_consumibles_metro?: Numerico;
        coste_packaging_metro?: Numerico;
        coste_electricidad_metro?: Numerico;
      }
    | null
    | undefined,
): number {
  return redondear(
    num(e?.coste_consumibles_metro) +
      num(e?.coste_packaging_metro) +
      num(e?.coste_electricidad_metro),
    4,
  );
}

/** Las filas de la cascada (bloque «resultados»), en su orden. */
export const FILAS_RESULTADOS = CONCEPTOS.filter((c) => c.bloque === "resultados");
/** Las filas del bloque de dinero. */
export const FILAS_DINERO = CONCEPTOS.filter((c) => c.bloque === "dinero");
