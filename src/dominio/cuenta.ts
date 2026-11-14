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
  cambioDeSigno,
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
  parteConAlgo,
  partirPedido,
  pendientesDeLinea,
  type FiltroLinea,
} from "./por-linea";
import { gastosFijosPorGrupo, importesSinPedido } from "./grupos";
import type { DocumentoFiscal } from "./fiscal";
import { TIENDA_TEXTIL } from "./cobros";
import { totalizar, type CobroConsolidado } from "./facturacion";
import { tiendaDelPendiente, type PedidoPendiente } from "./pendientes";
import { diaDelPedido } from "./dia-pedido";
import { diaDeFecha, type Rango } from "./periodos";
import { esSoloUv } from "./linea-producto";

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
    definicion:
      "Estimado sobre lo que tiene factura o ticket; el de verdad lo calcula la gestoría.",
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

/**
 * Los datos de la cuenta que no son dinero, con su nombre y su definición:
 * los mismos en todas las pantallas (Inicio, la Cuenta de resultados, el
 * resumen y la facturación de cada tienda, Gerencia).
 */
export type ClaveDato = "pedidos" | "metros" | "metros_uv" | "ticket_medio" | "cancelados";

export const DATOS: Record<ClaveDato, { nombre: string; definicion: string }> = {
  pedidos: {
    nombre: "Pedidos",
    definicion: "Cuántos pedidos cuentan: sin cancelados ni los de la web sin pagar.",
  },
  metros: {
    nombre: "Metros de DTF",
    definicion: "Metros de DTF impresos y vendidos.",
  },
  metros_uv: {
    nombre: "Metros de DTF UV",
    definicion: "Metros de DTF UV vendidos: aparte, no se suman a los de DTF.",
  },
  ticket_medio: {
    nombre: "Ticket medio",
    definicion: "Lo que se vende de media en cada pedido, sin IVA.",
  },
  cancelados: {
    nombre: "Cancelados",
    definicion: "Pedidos cancelados: no cuentan en ninguna otra cifra.",
  },
};

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
  /** El pedido devuelto: para saber si tiene factura o ticket (impuesto). */
  pedido_id?: string;
  /**
   * El pedido: con su base y su total para quitarle el IVA; con su estado
   * (un pedido cancelado no es venta, y su reembolso no la resta) y con lo
   * del DTF UV para repartir el reembolso por línea.
   */
  pedido: Pick<PedidoResumen, "subtotal" | "iva" | "envio" | "total"> &
    Partial<
      Pick<
        PedidoResumen,
        "estado" | "metros_total" | "metros_uv" | "bruta_uv" | "iva_uv" | "origen"
      >
    >;
};

/** Gastos de estructura del periodo, sin IVA (ver grupos.ts, gastosFijosPorGrupo). */
export type EstructuraCuenta = {
  fijos: number;
  /**
   * De `fijos`, los que tienen factura o justificante: solo esos rebajan el
   * Impuesto sobre Sociedades (ver grupos.ts).
   */
  fijosConJustificante: number;
  compras: number;
  amortizacion: number;
  /** Mermas y ajustes del almacén textil. */
  almacen: number;
  /** Si entre los gastos fijos hay nóminas dadas de alta. Sin ellas, la cifra está incompleta. */
  conNominas: boolean;
};

export type DocumentadoCuenta = {
  /** Los ids de los pedidos con documento vigente (factura o ticket). */
  pedidos: ReadonlySet<string>;
};

/**
 * Lo facturado sin pedido (facturas a mano; grupos.ts, importesSinPedido):
 * la base (va a «Ventas»), su IVA (a «IVA») y su total (a «Ventas con IVA»),
 * para que la cascada cuadre.
 */
export type ImportesSinPedido = { base: number; iva: number; total: number };

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
   * Lo que tiene factura o ticket (decisión de Javier, 14-11-2026: el
   * Impuesto sobre Sociedades sale solo de ahí, como en grupos.ts): los ids
   * de los pedidos con documento vigente. Sin esto, el impuesto sale «—»: no
   * se estima sobre lo que no lleva documento.
   */
  documentado?: DocumentadoCuenta | null;
  /**
   * Lo facturado sin pedido del periodo: es venta siempre, con o sin gastos,
   * para que «Ventas netas» sea la misma en Inicio, en la tienda, en Gerencia
   * y en la Cuenta de resultados. Con filtro de tienda, el de esa tienda; con
   * filtro de línea no se sabe de qué línea es y no va. Sin él, 0.
   */
  sinPedido?: ImportesSinPedido | null;
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
  /** Pedidos cancelados del periodo: no cuentan en ninguna cifra, se dicen aparte. */
  cancelados: number;
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
  const partes: T[] = [];
  for (const v of ventas) {
    if (v.canal === "textil") continue;
    const parte = partirPedido(v)[linea];
    // Solo las partes con algo: un pedido solo de DTF no es un pedido de UV
    // (ni resta su envío en esa línea).
    if (!parteConAlgo(parte)) continue;
    // El envío (lo cobrado y lo que cobra la agencia) va a una sola parte: la
    // de UV si el pedido es solo de UV (lo envía la subcontrata) y, si no, la
    // de DTF, que es la que envía la empresa.
    const llevaEnvio = linea === (esSoloUv(v) ? "uv" : "dtf");
    partes.push(
      llevaEnvio ? parte : { ...parte, envio: 0, con_envio: false, coste_envio_real: null },
    );
  }
  return partes;
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
  // Las facturas sin pedido (manuales) también son venta: con su IVA y su
  // total, para que «Ventas con IVA» − «IVA» − «Portes» dé «Ventas».
  const sinPedido = e.sinPedido?.base ?? 0;
  const conIva = ventas.reduce((s, v) => s + num(v.total), 0) + (e.sinPedido?.total ?? 0);
  const iva = ventas.reduce((s, v) => s + num(v.iva), 0) + (e.sinPedido?.iva ?? 0);
  const portes = ventas.reduce((s, v) => s + num(v.envio), 0);
  const base = ventas.reduce((s, v) => s + baseConEnvio(v), 0);
  const ventasSinPortes = base - portes + sinPedido;

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
  // Sin coste por metro en Ajustes (0), los pedidos de DTF sin coste congelado
  // irían a coste cero: el margen saldría inflado y como exacto.
  const conMetrosDtf = ventas.filter((v) => num(v.metros_total) > 0);
  const sinCosteMetro =
    num(e.costeMetroActual) > 0
      ? 0
      : conMetrosDtf.filter((v) => v.coste_metro_snapshot == null || v.coste_metro_snapshot === "")
          .length;
  const produccionDesconocida = sinCosteMetro > 0 && sinCosteMetro === conMetrosDtf.length;
  const notaSinCosteMetro =
    sinCosteMetro > 0
      ? `Sin coste por metro en Ajustes: ${sinCosteMetro} ${sinCosteMetro === 1 ? "pedido va" : "pedidos van"} sin coste.`
      : undefined;

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
      if (!e.documentado) {
        const falta =
          "Falta saber qué ventas tienen factura o ticket: el impuesto sale solo de esas.";
        sociedades = sinDato(falta);
        neto = sinDato(falta);
      } else {
        const baseIs = beneficioDocumentado({ ...e, ventas }, e.documentado, g);
        const is = baseIs > 0 ? (baseIs * e.tipoIs) / 100 : 0;
        sociedades = cifra(is, {
          estimado: true,
          nota: "Sobre lo que tiene factura o ticket. El de verdad lo calcula la gestoría.",
        });
        neto = cifra(valorBai - is, { estimado: true, nota: "Con el impuesto estimado." });
      }
    }
  }

  // Sin coste por metro: lo que sale del margen no se sabe (ningún pedido lo
  // tiene congelado) o va estimado (algunos sí).
  if (notaSinCosteMetro && e.estructura) {
    if (produccionDesconocida) {
      bai = sinDato(notaSinCosteMetro);
      sociedades = sinDato(notaSinCosteMetro);
      neto = sinDato(notaSinCosteMetro);
    } else {
      const marcar = (c: Cifra): Cifra =>
        c.valor === null ? c : { ...c, estimado: true, nota: c.nota ?? notaSinCosteMetro };
      bai = marcar(bai);
      sociedades = marcar(sociedades);
      neto = marcar(neto);
    }
  }

  const dinero = (v: number | null | undefined, falta: string): Cifra =>
    v == null ? sinDato(falta) : cifra(v);

  const notaTextil =
    textilSinCoste > 0
      ? `${textilSinCoste} ${textilSinCoste === 1 ? "pedido textil" : "pedidos textil"} sin la ropa sacada del almacén: van sin coste.`
      : undefined;
  const notaProduccion = [notaSinCosteMetro, notaTextil].filter(Boolean).join(" ");
  const valorNetas = redondear(netas);
  const valorMargen = redondear(margen);
  return {
    ventas_con_iva: cifra(conIva),
    iva: cifra(iva),
    portes_cobrados: cifra(portes),
    ventas: cifra(ventasSinPortes),
    devoluciones: cifra(devuelto),
    ventas_netas: cifra(netas),
    coste_produccion: produccionDesconocida
      ? sinDato(notaSinCosteMetro!)
      : cifra(produccion, notaProduccion ? { estimado: true, nota: notaProduccion } : {}),
    resultado_portes: cifra(
      resultadoPortes,
      enviosEstimados > 0
        ? {
            estimado: true,
            nota: `Coste del envío estimado en ${enviosEstimados} ${enviosEstimados === 1 ? "pedido" : "pedidos"}.`,
          }
        : {},
    ),
    margen_bruto: produccionDesconocida
      ? sinDato(notaSinCosteMetro!)
      : cifra(
          margen,
          notaProduccion || enviosEstimados > 0
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
    margenPct:
      valorNetas > 0 && !produccionDesconocida
        ? redondear((valorMargen / valorNetas) * 100, 1)
        : null,
    ticketMedio: ventas.length > 0 ? redondear(netas / ventas.length) : null,
    cancelados: e.ventas.filter((v) => v.estado === ESTADO_CANCELADO).length,
  };
}

/**
 * El beneficio antes de impuestos de lo que tiene factura o ticket: la base
 * del Impuesto sobre Sociedades (grupo A de grupos.ts). Las ventas y
 * devoluciones de pedidos con documento, lo facturado sin pedido, y los
 * gastos con justificante, las compras, las amortizaciones y el almacén.
 */
function beneficioDocumentado(e: EntradaCuenta, d: DocumentadoCuenta, g: EstructuraCuenta): number {
  const a = calcularCuenta({
    ...e,
    ventas: e.ventas.filter((v) => !!v.id && d.pedidos.has(v.id)),
    devoluciones: e.devoluciones.filter((x) => !!x.pedido_id && d.pedidos.has(x.pedido_id)),
    estructura: null,
    documentado: d,
    dinero: undefined,
  });
  return redondear(
    (a.margen_bruto.valor ?? 0) - g.fijosConJustificante - g.compras - g.amortizacion - g.almacen,
  );
}

// ---------------------------------------------------------------------------
// El bloque de dinero
// ---------------------------------------------------------------------------

/**
 * Lo que falta por cobrar de una factura de Cobros pendientes: su total menos
 * lo cobrado de su pedido, nunca por debajo de cero ni por encima del total.
 * Un borrador no se debe todavía: no es una factura emitida. Antes la lista
 * sumaba el total entero de todas, borradores incluidos, y un pago a medias
 * seguía contando como deuda entera.
 */
export function pendienteDeFactura(f: {
  estado: string;
  total: Numerico;
  /** Lo cobrado del pedido de la factura, con IVA; 0 si no tiene pedido. */
  cobrado: Numerico;
}): number {
  if (f.estado === "borrador") return 0;
  const total = num(f.total);
  return redondear(Math.min(total, Math.max(0, total - num(f.cobrado))));
}

/** Lo justo de una factura o ticket para contar lo facturado. */
export type DocumentoFacturado = {
  id: string;
  estado: string | null;
  /** El ticket que esta factura canjea, si lo canjea. */
  sustituye_a_id?: string | null;
};

/**
 * Las facturas, tickets y rectificativas vigentes: sin borradores ni
 * anuladas, y un ticket canjeado por una factura vigente una sola vez (la
 * factura). Para contarlos sin contar dos veces el mismo ingreso.
 */
export function documentosVigentes<D extends DocumentoFacturado>(docs: readonly D[]): D[] {
  const vale = (d: DocumentoFacturado) => d.estado !== "anulada" && d.estado !== "borrador";
  const canjeados = new Set(
    docs.filter((d) => vale(d) && d.sustituye_a_id).map((d) => d.sustituye_a_id as string),
  );
  return docs.filter((d) => vale(d) && !canjeados.has(d.id));
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

/**
 * Cuántos pedidos tienen hoy algo por cobrar, con los mismos que suma
 * `pendienteDeCobroHoy`: el número de Inicio («Pedidos por cobrar»); el
 * importe es la cifra «Pendiente de cobro».
 */
export function pedidosPorCobrarHoy(
  pendientes: readonly PedidoPendiente[],
  f: FiltroCuenta,
  soloUv: ReadonlySet<string> = new Set(),
): number {
  const deTienda =
    f.tienda === TODAS ? pendientes : pendientes.filter((p) => tiendaDelPendiente(p) === f.tienda);
  return pendientesDeLinea(deTienda, f.linea, soloUv).filter(
    (p) => !esWebSinPagar(p) && num(p.pendiente) > 0,
  ).length;
}

/** Un pedido de la web que el cliente aún no ha pagado: no es venta. */
const esWebSinPagar = (p: Pick<PedidoPendiente, "tipo" | "origen" | "estado">) =>
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

/**
 * Lo facturado sin pedido con el filtro de la cuenta (y en un rango, si se
 * da): con una tienda, solo los documentos de esa tienda (o del textil); con
 * una línea (DTF o DTF UV), nada, porque una factura a mano no dice de qué
 * línea es. `referencias`: los documentos de fuera del rango que hacen falta
 * para casar canjes y rectificativas.
 */
export function sinPedidoDelFiltro(
  documentos: readonly DocumentoFiscal[],
  referencias: readonly DocumentoFiscal[],
  f: FiltroCuenta,
  r?: Rango,
): ImportesSinPedido {
  if (f.linea !== "todo") return { base: 0, iva: 0, total: 0 };
  const desde = r ? diaDeFecha(r.desde) : null;
  const hasta = r ? diaDeFecha(r.hasta) : null;
  const delRango =
    desde && hasta ? documentos.filter((x) => x.fecha >= desde && x.fecha <= hasta) : documentos;
  const deTienda = f.tienda === TODAS ? delRango : delRango.filter((x) => x.tienda_id === f.tienda);
  return importesSinPedido(deTienda, [...referencias, ...documentos]);
}

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
    fijosConJustificante: g.a,
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
/** La columna de lo facturado sin pedido al separar por tienda o por línea. */
export const CLAVE_SIN_PEDIDO = "sin-pedido";

/** Por qué un mes no lleva impuesto: el suelo a cero haría que los meses no sumaran. */
export const MOTIVO_IMPUESTO_POR_MES = "El impuesto se estima sobre el periodo entero.";

/**
 * Un mes sin impuesto ni beneficio neto: el Impuesto sobre Sociedades se
 * estima sobre el periodo entero (un mes en pérdidas daría 0, y los meses no
 * sumarían el total). Si el mes ya no los tenía (sin estructura, sin tipo), se
 * deja su motivo.
 */
function sinImpuestoDelMes(c: Cuenta): Cuenta {
  if (c.sociedades.valor === null && c.beneficio_neto.valor === null) return c;
  const falta = { valor: null, falta: MOTIVO_IMPUESTO_POR_MES };
  return { ...c, sociedades: falta, beneficio_neto: falta };
}

export function separarCuenta(
  e: EntradaCuenta,
  por: SepararPor,
  opciones: {
    tiendas?: readonly { id: string; nombre: string }[];
    rango?: Rango;
    estructuraDe?: (r: Rango) => EstructuraCuenta | null;
    /** Lo facturado sin pedido de un mes (va en el mes de su factura). */
    sinPedidoDe?: (r: Rango) => ImportesSinPedido | null;
  } = {},
): ColumnaCuenta[] {
  const sinEstructura: EntradaCuenta = {
    ...e,
    estructura: null,
    documentado: undefined,
    sinPedido: undefined,
    dinero: undefined,
  };
  // Lo facturado sin pedido (facturas a mano) no es de ninguna línea, ni se
  // reparte entre tiendas: va en su columna, para que las columnas sumen el total.
  const sp = e.sinPedido;
  const sinPedido: ColumnaCuenta[] =
    sp && (sp.base !== 0 || sp.total !== 0)
      ? [
          {
            clave: CLAVE_SIN_PEDIDO,
            titulo: "Sin pedido",
            cuenta: calcularCuenta({
              ...sinEstructura,
              ventas: [],
              devoluciones: [],
              sinPedido: sp,
            }),
          },
        ]
      : [];
  if (por === "tienda") {
    const tiendas = [...(opciones.tiendas ?? []), TIENDA_TEXTIL];
    const ids = new Set(e.ventas.map((v) => v.tienda_id));
    for (const d of e.devoluciones) if (d.tienda_id) ids.add(d.tienda_id);
    const deTiendas = tiendas
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
    return cuadrarColumnas(
      [...deTiendas, ...sinPedido],
      calcularCuenta({ ...sinEstructura, sinPedido: e.sinPedido }),
    );
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
    return cuadrarColumnas(
      [...columnas, ...sinPedido],
      calcularCuenta({ ...sinEstructura, sinPedido: e.sinPedido }),
    );
  }
  if (por === "mes" && opciones.rango) {
    return mesesDelRango(opciones.rango).map((m) => {
      const desde = diaDeFecha(m.desde);
      const hasta = diaDeFecha(m.hasta);
      const enMes = (dia: string) => dia >= desde && dia <= hasta;
      return {
        clave: desde,
        titulo: m.etiqueta,
        cuenta: sinImpuestoDelMes(
          calcularCuenta({
            ...e,
            dinero: undefined,
            sinPedido: opciones.sinPedidoDe ? opciones.sinPedidoDe(m) : undefined,
            ventas: e.ventas.filter((v) => enMes(diaDelPedido(v))),
            devoluciones: e.devoluciones.filter((d) => enMes(d.fecha.slice(0, 10))),
            estructura: e.estructura && opciones.estructuraDe ? opciones.estructuraDe(m) : null,
          }),
        ),
      };
    });
  }
  return [];
}

/**
 * Unos importes ya redondeados a céntimos que deberían sumar `total` y, por
 * los medios céntimos, se pasan o se quedan cortos en uno o dos: la
 * diferencia va al de más valor (donde menos se nota), para que sumen justo.
 * Una diferencia de más de un céntimo por importe no es de redondeo y no se
 * toca: esconderla sería inventar.
 */
export function cuadrarConTotal(valores: readonly number[], total: number): number[] {
  const salida = [...valores];
  if (salida.length === 0) return salida;
  const diferencia = redondear(total - salida.reduce((s, v) => s + v, 0));
  if (diferencia === 0 || Math.abs(diferencia) > 0.01 * salida.length + 1e-9) return salida;
  let mayor = 0;
  for (let i = 1; i < salida.length; i++) {
    if (Math.abs(salida[i]) > Math.abs(salida[mayor])) mayor = i;
  }
  salida[mayor] = redondear(salida[mayor] + diferencia);
  return salida;
}

/**
 * Las columnas de una cuenta separada, cuadradas con su total cifra a cifra
 * (cuadrarConTotal): solo las cifras que tienen valor en todas las columnas y
 * en el total.
 */
function cuadrarColumnas(columnas: ColumnaCuenta[], total: Cuenta): ColumnaCuenta[] {
  if (columnas.length < 2) return columnas;
  const ajustadas = columnas.map((c) => ({ ...c, cuenta: { ...c.cuenta } }));
  for (const { clave } of FILAS_RESULTADOS) {
    const t = total[clave].valor;
    const valores = ajustadas.map((c) => c.cuenta[clave].valor);
    if (t === null || valores.some((v) => v === null)) continue;
    const cuadrados = cuadrarConTotal(valores as number[], t);
    ajustadas.forEach((c, i) => {
      if (cuadrados[i] !== valores[i]) {
        c.cuenta[clave] = { ...c.cuenta[clave], valor: cuadrados[i] };
      }
    });
  }
  return ajustadas;
}

/**
 * Las ventas netas de cada tramo de una gráfica (días o meses), con la regla
 * de la Cuenta de resultados: sin IVA, tiendas y textil, sin los web sin
 * pagar, cada venta en el día de su pedido y cada devolución en el suyo, con
 * los filtros que ya trae la entrada. Lo facturado sin pedido, en el día de su
 * factura si se da `sinPedidoDe`. Los tramos suman, al céntimo, las ventas
 * netas de la entrada cuando la cubren entera.
 */
export function ventasNetasPorTramo(
  e: EntradaCuenta,
  tramos: readonly Rango[],
  sinPedidoDe?: (r: Rango) => ImportesSinPedido | null,
): number[] {
  const base: EntradaCuenta = {
    ...e,
    estructura: null,
    documentado: undefined,
    dinero: undefined,
  };
  const valores = tramos.map((t) => {
    const desde = diaDeFecha(t.desde);
    const hasta = diaDeFecha(t.hasta);
    const enTramo = (dia: string) => dia >= desde && dia <= hasta;
    return (
      calcularCuenta({
        ...base,
        sinPedido: sinPedidoDe ? sinPedidoDe(t) : undefined,
        ventas: e.ventas.filter((v) => enTramo(diaDelPedido(v))),
        devoluciones: e.devoluciones.filter((d) => enTramo(d.fecha.slice(0, 10))),
      }).ventas_netas.valor ?? 0
    );
  });
  // Por los medios céntimos, los tramos podrían no sumar el total por uno.
  const total = calcularCuenta({ ...base, sinPedido: sinPedidoDe ? e.sinPedido : undefined })
    .ventas_netas.valor;
  return total === null ? valores : cuadrarConTotal(valores, total);
}

// ---------------------------------------------------------------------------
// Para pintar
// ---------------------------------------------------------------------------

/** Si una cifra ha cambiado de signo frente al periodo anterior, dicho con palabras. */
export function cambioDeSignoCifra(actual: Cifra, anterior: Cifra | undefined): string | null {
  if (!anterior || actual.valor === null || anterior.valor === null) return null;
  return cambioDeSigno(actual.valor, anterior.valor);
}

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

/**
 * La cuenta de un canal (web, manual o textil) y de un grupo (con factura o
 * ticket, o sin documento), como los filtros de Gerencia. Las ventas, por su
 * canal y por si su pedido tiene documento; las devoluciones, igual por su
 * pedido (textil no tiene). Sin gastos ni impuesto: no son de un canal ni de
 * un grupo.
 */
export function entradaDeCanalYGrupo(
  e: EntradaCuenta,
  canal: "todos" | "web" | "manual" | "textil",
  grupo: "total" | "a" | "b",
  documentados: ReadonlySet<string> | null,
): EntradaCuenta | null {
  if (canal === "todos" && grupo === "total") return e;
  // Sin saber qué tiene documento todavía no se puede separar A de B: nada
  // de un A vacío y un B con todo mientras se lee.
  if (grupo !== "total" && !documentados) return null;
  const delGrupo = (id: string | undefined | null) =>
    grupo === "total" || (!!id && !!documentados?.has(id)) === (grupo === "a");
  const canalDevolucion = (d: DevolucionCuenta) =>
    d.pedido.origen === "woocommerce" ? "web" : "manual";
  return {
    ...e,
    ventas: e.ventas.filter((v) => (canal === "todos" || v.canal === canal) && delGrupo(v.id)),
    devoluciones: e.devoluciones.filter(
      (d) => (canal === "todos" || canalDevolucion(d) === canal) && delGrupo(d.pedido_id),
    ),
    estructura: null,
    documentado: null,
    // Lo facturado sin pedido está documentado: va en el grupo A, no en el B.
    // No es de ningún canal: solo con todos.
    sinPedido: canal === "todos" && grupo !== "b" ? e.sinPedido : null,
    dinero: undefined,
  };
}
