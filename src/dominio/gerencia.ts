/**
 * Las cuentas del panel de Gerencia.
 *
 * Gerencia mira la empresa entera: las tiendas (web y manuales) y el textil,
 * con filtros por tienda y por canal. Las cifras de cada pedido se calculan
 * con las mismas funciones que el dashboard (kpis.ts): devoluciones
 * restadas, cancelados fuera y coste congelado por pedido.
 *
 * Lógica pura: recibe filas ya leídas y devuelve cifras. Se prueba sin base
 * de datos.
 */

import { redondear } from "./importes";
import {
  calcularKpis,
  costeVariable,
  ESTADO_CANCELADO,
  type KpisPeriodo,
  type PedidoResumen,
} from "./kpis";
import { TIENDA_TEXTIL } from "./cobros";
import { diasDesde, type PedidoPendiente } from "./pendientes";
import type { CobroConsolidado } from "./facturacion";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// Ventas: pedidos de tienda y textil en una sola forma
// ---------------------------------------------------------------------------

/** Por dónde entró el pedido. */
export type Canal = "web" | "manual" | "textil";

export const CANALES: readonly { valor: Canal; etiqueta: string }[] = [
  { valor: "web", etiqueta: "Web" },
  { valor: "manual", etiqueta: "Manual" },
  { valor: "textil", etiqueta: "Textil" },
];

export function etiquetaCanal(c: Canal): string {
  return CANALES.find((x) => x.valor === c)?.etiqueta ?? c;
}

/**
 * Un pedido, venga de una tienda o del textil. Es un PedidoResumen, así que
 * vale para calcularKpis; `tienda_id` del textil es TIENDA_TEXTIL.id.
 */
export type Venta = PedidoResumen & {
  canal: Canal;
  cliente_id: string | null;
  /** El pedido, para cruzarlo con sus facturas. Solo lo traen las lecturas que lo necesitan. */
  id?: string;
  /** Solo textil: la marca del pedido. */
  marca_id?: string | null;
  /**
   * Solo textil: lo que costó la ropa que salió del almacén para el pedido, al
   * coste medio congelado en la salida. Nulo si todavía no ha salido nada.
   */
  coste_textil?: number | null;
};

/** Un pedido de tienda tal como lo lee usePedidosPeriodo. */
export function ventaDeTienda(p: PedidoResumen): Venta {
  return {
    ...p,
    canal: p.origen === "woocommerce" ? "web" : "manual",
    cliente_id: p.cliente_id ?? null,
  };
}

/** Un pedido textil: sin metros, sin devoluciones y fechado por su día. */
export type PedidoTextilResumen = {
  id?: string;
  marca_id?: string | null;
  /** Coste de la ropa que salió del almacén para el pedido (ver Venta.coste_textil). */
  coste?: number | null;
  fecha: string;
  estado: string;
  subtotal: Numerico;
  iva: Numerico;
  envio: Numerico;
  total: Numerico;
  cliente_id: string | null;
};

export function ventaDeTextil(p: PedidoTextilResumen): Venta {
  return {
    // Un día sin hora, a mediodía: así no salta de día en ningún huso.
    fecha_pedido: `${p.fecha.slice(0, 10)}T12:00:00`,
    tienda_id: TIENDA_TEXTIL.id,
    estado: p.estado,
    subtotal: p.subtotal ?? 0,
    iva: p.iva ?? 0,
    envio: p.envio ?? 0,
    total: p.total ?? 0,
    metros_total: 0,
    canal: "textil",
    cliente_id: p.cliente_id,
    ...(p.id ? { id: p.id } : {}),
    ...(p.marca_id !== undefined ? { marca_id: p.marca_id } : {}),
    ...(p.coste !== undefined ? { coste_textil: p.coste } : {}),
  };
}

export type FiltroGerencia = {
  /** Una tienda, el textil (TIENDA_TEXTIL.id) o «todas». */
  tienda: string;
  canal: Canal | "todos";
};

export const FILTRO_GERENCIA_TODO: FiltroGerencia = { tienda: "todas", canal: "todos" };

export function filtrarVentas<T extends Pick<Venta, "tienda_id" | "canal">>(
  ventas: readonly T[],
  f: FiltroGerencia,
): T[] {
  return ventas.filter(
    (v) =>
      (f.tienda === "todas" || v.tienda_id === f.tienda) &&
      (f.canal === "todos" || v.canal === f.canal),
  );
}

/** Los cobros con los mismos filtros. El canal sale de la tienda y del origen. */
export function filtrarCobrosGerencia(
  cobros: readonly CobroConsolidado[],
  f: FiltroGerencia,
): CobroConsolidado[] {
  return cobros.filter((c) => {
    if (f.tienda !== "todas" && c.tienda_id !== f.tienda) return false;
    if (f.canal === "todos") return true;
    return canalDelCobro(c) === f.canal;
  });
}

/** Un cobro web es de un pedido web; uno del textil, del textil; el resto, manual. */
export function canalDelCobro(c: Pick<CobroConsolidado, "tienda_id" | "metodo">): Canal {
  if (c.tienda_id === TIENDA_TEXTIL.id) return "textil";
  return c.metodo === "web" ? "web" : "manual";
}

export function filtrarPendientesGerencia(
  pendientes: readonly PedidoPendiente[],
  f: FiltroGerencia,
): PedidoPendiente[] {
  return pendientes.filter((p) => {
    const tienda = p.tipo === "textil" ? TIENDA_TEXTIL.id : (p.tienda_id ?? "");
    const canal: Canal =
      p.tipo === "textil" ? "textil" : p.origen === "woocommerce" ? "web" : "manual";
    return (
      (f.tienda === "todas" || tienda === f.tienda) && (f.canal === "todos" || canal === f.canal)
    );
  });
}

// ---------------------------------------------------------------------------
// Cifras clave
// ---------------------------------------------------------------------------

export type CifrasGerencia = KpisPeriodo & {
  /** Coste DTF, envíos y coste textil. */
  coste: number;
  /** Lo que se paga a la agencia: lo mismo que el envío cobrado al cliente. */
  costeEnvios: number;
  /** Coste de producción DTF: metros × coste por metro congelado. */
  costeDtf: number;
  /** Coste de la ropa que salió del almacén para los pedidos textil. */
  costeTextil: number;
  /** Pedidos textil no cancelados sin salida de almacén todavía: su margen va sin coste. */
  textilSinCoste: number;
  /** Facturación bruta − coste. */
  margen: number;
  /** Base imponible por metro, sin el envío, solo de los pedidos que llevan metros. */
  euroMetro: number;
};

export function cifrasGerencia(ventas: readonly Venta[], costeActual: number): CifrasGerencia {
  const k = calcularKpis(ventas);
  const variable = costeVariable(ventas, costeActual);
  const costeDtf = variable.produccion;
  const textil = ventas.filter((v) => v.canal === "textil" && v.estado !== ESTADO_CANCELADO);
  const costeTextil = redondear(textil.reduce((s, v) => s + num(v.coste_textil), 0));
  const coste = redondear(variable.total + costeTextil);
  const conMetros = calcularKpis(ventas.filter((v) => num(v.metros_total) > 0));
  // El precio del metro sin el envío: lo que se cobra por imprimir.
  const brutaMetros = conMetros.bruta - conMetros.envios;
  return {
    ...k,
    coste,
    costeEnvios: variable.envios,
    costeDtf,
    costeTextil,
    textilSinCoste: textil.filter((v) => v.coste_textil == null).length,
    margen: redondear(k.bruta - coste),
    euroMetro: conMetros.metros > 0 ? redondear(brutaMetros / conMetros.metros) : 0,
  };
}

// ---------------------------------------------------------------------------
// Desgloses
// ---------------------------------------------------------------------------

export type FilaDesglose = {
  clave: string;
  nombre: string;
  pedidos: number;
  vendido: number;
  bruta: number;
  metros: number;
  ticket: number;
  /** Parte de lo vendido del total, de 0 a 100. */
  peso: number;
};

/**
 * Lo vendido agrupado por lo que diga `clave` (la tienda, el canal…), de más a
 * menos. Con `todas`, las que no vendieron nada salen a cero: que una tienda no
 * venda es información.
 */
export function desglose(
  ventas: readonly Venta[],
  clave: (v: Venta) => string,
  nombres: ReadonlyMap<string, string>,
  todas: readonly string[] = [],
): FilaDesglose[] {
  const grupos = new Map<string, Venta[]>();
  for (const c of todas) grupos.set(c, []);
  for (const v of ventas) {
    const c = clave(v);
    grupos.set(c, [...(grupos.get(c) ?? []), v]);
  }
  const total = calcularKpis(ventas).total;
  return Array.from(grupos.entries())
    .map(([c, lista]) => {
      const k = calcularKpis(lista);
      return {
        clave: c,
        nombre: nombres.get(c) ?? c,
        pedidos: k.pedidos,
        vendido: k.total,
        bruta: k.bruta,
        metros: k.metros,
        ticket: k.ticket,
        peso: total > 0 ? redondear((k.total / total) * 100, 1) : 0,
      };
    })
    .sort((a, b) => b.vendido - a.vendido);
}

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Lo vendido según el día de la semana del pedido, de lunes a domingo. */
export function porDiaSemana(
  ventas: readonly Venta[],
): { dia: string; pedidos: number; vendido: number }[] {
  return DIAS_SEMANA.map((dia, i) => {
    const delDia = ventas.filter((v) => (new Date(v.fecha_pedido).getDay() + 6) % 7 === i);
    const k = calcularKpis(delDia);
    return { dia, pedidos: k.pedidos, vendido: k.total };
  });
}

// ---------------------------------------------------------------------------
// Cobros y tesorería
// ---------------------------------------------------------------------------

export type TramoAntiguedad = {
  clave: "0-30" | "31-60" | "60+";
  etiqueta: string;
  pedidos: number;
  pendiente: number;
};

/** Lo que se debe hoy, por lo viejo que es el pedido. */
export function antiguedadPendientes(
  pendientes: readonly PedidoPendiente[],
  hoy: Date,
): TramoAntiguedad[] {
  const tramos: TramoAntiguedad[] = [
    { clave: "0-30", etiqueta: "Hasta 30 días", pedidos: 0, pendiente: 0 },
    { clave: "31-60", etiqueta: "De 31 a 60 días", pedidos: 0, pendiente: 0 },
    { clave: "60+", etiqueta: "Más de 60 días", pedidos: 0, pendiente: 0 },
  ];
  for (const p of pendientes) {
    const dias = diasDesde(p.fecha, hoy);
    const t = tramos[dias <= 30 ? 0 : dias <= 60 ? 1 : 2];
    t.pedidos += 1;
    t.pendiente += num(p.pendiente);
  }
  return tramos.map((t) => ({ ...t, pendiente: redondear(t.pendiente) }));
}

/**
 * Cuántos días pasan de media del pedido al cobro, pesando cada cobro por su
 * importe (cobrar 1.000 € a 60 días pesa más que 10 € a 5). `null` sin
 * cobros. Los de la web cuentan con 0 días: se pagan al hacer el pedido.
 */
export function diasMediosCobro(cobros: readonly CobroConsolidado[]): number | null {
  let peso = 0;
  let suma = 0;
  for (const c of cobros) {
    if (c.importe <= 0 || !c.fecha_pedido) continue;
    const dias = diasEntre(c.fecha_pedido, c.fecha_cobro);
    peso += c.importe;
    suma += c.importe * dias;
  }
  return peso > 0 ? redondear(suma / peso, 1) : null;
}

function diasEntre(desde: string, hasta: string): number {
  const dia = (t: string) => {
    const [a, m, d] = t.slice(0, 10).split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.max(0, Math.round((dia(hasta) - dia(desde)) / 86_400_000));
}

export type MovimientoBancoResumen = {
  fecha: string;
  importe: Numerico;
  /** Con una conciliación (una factura casada), o sin ella. */
  conciliado: boolean;
};

export type ResumenBanco = {
  entradas: number;
  salidas: number;
  /** Entradas − salidas del periodo. */
  neto: number;
  /** Entradas casadas con una factura. */
  conciliadas: number;
  /** Entradas sin casar: dinero que entró y no se sabe de qué factura es. */
  sinConciliar: number;
  movimientosSinConciliar: number;
};

export function resumenBanco(movs: readonly MovimientoBancoResumen[]): ResumenBanco {
  let entradas = 0;
  let salidas = 0;
  let conciliadas = 0;
  let sinConciliar = 0;
  let movimientosSinConciliar = 0;
  for (const m of movs) {
    const i = num(m.importe);
    if (i >= 0) {
      entradas += i;
      if (m.conciliado) conciliadas += i;
      else {
        sinConciliar += i;
        movimientosSinConciliar += 1;
      }
    } else {
      salidas += -i;
    }
  }
  return {
    entradas: redondear(entradas),
    salidas: redondear(salidas),
    neto: redondear(entradas - salidas),
    conciliadas: redondear(conciliadas),
    sinConciliar: redondear(sinConciliar),
    movimientosSinConciliar,
  };
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

export type Aviso =
  | { tipo: "deuda_antigua"; nivel: "alto"; pedidos: number; importe: number }
  | { tipo: "caida_ventas"; nivel: "medio"; porcentaje: number }
  | {
      tipo: "web_sin_pagar";
      nivel: "medio";
      pedidos: number;
      importe: number;
      /** Si cuentan en lo vendido (Gerencia › Ajustes). */
      cuentan: boolean;
    }
  | { tipo: "banco_sin_casar"; nivel: "medio"; movimientos: number; importe: number };

/** Cuánto tiene que caer lo vendido, en %, para avisar. */
export const CAIDA_AVISO = 20;

/**
 * Lo que se sale de lo normal y merece mirarse. Solo hechos con cifras,
 * nunca suposiciones. El texto lo pone la pantalla.
 */
export function avisosGerencia(d: {
  tramos: readonly TramoAntiguedad[];
  /** Variación de lo vendido frente a la comparación, en %. */
  variacionVendido: number | null;
  /** Pedidos web del periodo todavía sin pagar, y si cuentan en lo vendido. */
  webSinPagar: { pedidos: number; importe: number; cuentan: boolean };
  banco: ResumenBanco | null;
}): Aviso[] {
  const avisos: Aviso[] = [];
  const viejos = d.tramos.find((t) => t.clave === "60+");
  if (viejos && viejos.pedidos > 0) {
    avisos.push({
      tipo: "deuda_antigua",
      nivel: "alto",
      pedidos: viejos.pedidos,
      importe: viejos.pendiente,
    });
  }
  if (d.variacionVendido !== null && d.variacionVendido <= -CAIDA_AVISO) {
    avisos.push({ tipo: "caida_ventas", nivel: "medio", porcentaje: -d.variacionVendido });
  }
  if (d.webSinPagar.pedidos > 0) {
    avisos.push({ tipo: "web_sin_pagar", nivel: "medio", ...d.webSinPagar });
  }
  if (d.banco && d.banco.movimientosSinConciliar > 0) {
    avisos.push({
      tipo: "banco_sin_casar",
      nivel: "medio",
      movimientos: d.banco.movimientosSinConciliar,
      importe: d.banco.sinConciliar,
    });
  }
  return avisos;
}

/** Pedidos web en estado pendiente: en WooCommerce, sin pagar o en espera. */
export function webSinPagar(ventas: readonly Venta[]): { pedidos: number; importe: number } {
  const lista = ventas.filter((v) => v.canal === "web" && v.estado === "pendiente");
  return {
    pedidos: lista.length,
    importe: redondear(lista.reduce((s, v) => s + num(v.total), 0)),
  };
}

/**
 * Lo cobrado (sin propinas, como la cifra de arriba) dentro de cada tramo de
 * la gráfica. El cobro se sitúa por su `fecha`: la del cobro si se leyó con
 * el criterio «cobro».
 */
export function cobradoPorTramos(
  cobros: readonly CobroConsolidado[],
  tramos: readonly { desde: Date; hasta: Date }[],
): number[] {
  return tramos.map((t) =>
    redondear(
      cobros
        .filter((c) => {
          const f = new Date(c.fecha).getTime();
          return f >= t.desde.getTime() && f <= t.hasta.getTime();
        })
        .reduce((s, c) => s + c.importe, 0),
    ),
  );
}

// ---------------------------------------------------------------------------
// Ajustes: gastos fijos, objetivos y web sin pagar
// ---------------------------------------------------------------------------

export type Periodicidad = "mensual" | "trimestral" | "anual" | "puntual";

export type GastoFijo = {
  id: string;
  concepto: string;
  /** Base de cada cargo, sin IVA (con periodicidad mensual, al mes). */
  importe_mensual: Numerico;
  /** Sin migración de impuestos, mensual. */
  periodicidad?: Periodicidad | null;
  /** Qué es el gasto (ver impuestos.ts): decide el modelo de su IRPF. */
  tipo?: string | null;
  /** IVA soportado, en % de la base. */
  iva_pct?: Numerico;
  /** IRPF retenido al proveedor, en % de la base. */
  irpf_pct?: Numerico;
  /** `yyyy-MM-dd`, primer día en que se paga. */
  desde: string;
  /** `yyyy-MM-dd`, último día; nulo si se sigue pagando. */
  hasta: string | null;
  notas?: string | null;
};

export type Objetivo = {
  id: string;
  /** `yyyy-MM-01`: el mes desde el que vale. */
  desde: string;
  metros: Numerico;
  /** Vendido al mes, con IVA. */
  vendido: Numerico;
};

export type AjustesGerencia = {
  web_sin_pagar_cuenta: boolean;
};

export const AJUSTES_POR_DEFECTO: AjustesGerencia = { web_sin_pagar_cuenta: true };

/** Un día `yyyy-MM-dd` como fecha local a mediodía, sin líos de huso. */
function diaLocalDe(texto: string): Date {
  const [a, m, d] = texto.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d, 12);
}

/** Medianoche de un día: así dos fechas del mismo día se comparan bien. */
function soloDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Cada mes que toca el rango, con cuántos de sus días caen dentro: la base
 * para prorratear algo que se expresa «al mes».
 */
function mesesDelRango(r: { desde: Date; hasta: Date }): {
  inicio: Date;
  diasDelMes: number;
  dias: number;
  primero: Date;
  ultimo: Date;
}[] {
  const desde = soloDia(r.desde);
  const hasta = soloDia(r.hasta);
  const meses = [];
  let inicio = new Date(desde.getFullYear(), desde.getMonth(), 1);
  while (inicio <= hasta) {
    const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
    const primero = desde > inicio ? desde : inicio;
    const ultimo = hasta < fin ? hasta : fin;
    meses.push({
      inicio,
      diasDelMes: fin.getDate(),
      dias: Math.round((ultimo.getTime() - primero.getTime()) / 86_400_000) + 1,
      primero,
      ultimo,
    });
    inicio = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
  }
  return meses;
}

/**
 * Cuánto cuestan los gastos fijos en un rango de fechas, sin IVA: el coste
 * que le toca al periodo, no lo que se paga en él. Cada gasto se reparte por
 * días dentro de cada mes: un alquiler de 800 € al mes son 400 € en la
 * primera quincena de un mes de 30 días. Uno trimestral se reparte entre sus
 * tres meses y uno anual entre doce; uno puntual cuenta entero en su día.
 * Solo cuentan los días en que el gasto está vigente.
 */
/** Cuántos meses cubre cada cargo: el gasto se reparte por igual entre ellos. */
const MESES_POR_CARGO: Record<Exclude<Periodicidad, "puntual">, number> = {
  mensual: 1,
  trimestral: 3,
  anual: 12,
};

export function gastosFijosDelRango(
  gastos: readonly GastoFijo[],
  r: { desde: Date; hasta: Date },
): number {
  let total = 0;
  // Un gasto puntual cuenta entero el día en que se paga.
  for (const g of gastos) {
    if (g.periodicidad !== "puntual") continue;
    const dia = diaLocalDe(g.desde);
    if (soloDia(dia) >= soloDia(r.desde) && soloDia(dia) <= soloDia(r.hasta)) {
      total += num(g.importe_mensual);
    }
  }
  for (const mes of mesesDelRango(r)) {
    for (const g of gastos) {
      if (g.periodicidad === "puntual") continue;
      const meses = MESES_POR_CARGO[g.periodicidad ?? "mensual"] ?? 1;
      const ini = soloDia(diaLocalDe(g.desde));
      const fin = g.hasta ? soloDia(diaLocalDe(g.hasta)) : null;
      const primero = ini > mes.primero ? ini : mes.primero;
      const ultimo = fin && fin < mes.ultimo ? fin : mes.ultimo;
      if (ultimo < primero) continue;
      const dias = Math.round((ultimo.getTime() - primero.getTime()) / 86_400_000) + 1;
      total += (num(g.importe_mensual) / meses) * (dias / mes.diasDelMes);
    }
  }
  return redondear(total);
}

/** El objetivo que vale para un mes: el último que empezó ese mes o antes. */
function objetivoDelMes(objetivos: readonly Objetivo[], mes: Date): Objetivo | null {
  let vigente: Objetivo | null = null;
  for (const o of objetivos) {
    const desde = diaLocalDe(o.desde);
    const inicio = new Date(desde.getFullYear(), desde.getMonth(), 1);
    if (inicio > mes) continue;
    if (!vigente || diaLocalDe(vigente.desde) < desde) vigente = o;
  }
  return vigente;
}

export type ObjetivoDelRango = {
  /** Metros que tocan en el rango, o nulo si no hay objetivo de metros. */
  metros: number | null;
  vendido: number | null;
};

/**
 * El objetivo de un rango, prorrateado por días como los gastos fijos: el
 * objetivo de octubre entero para «octubre», la mitad para su primera
 * quincena, y la suma de los tres meses para un trimestre.
 */
export function objetivoDelRango(
  objetivos: readonly Objetivo[],
  r: { desde: Date; hasta: Date },
): ObjetivoDelRango {
  let metros: number | null = null;
  let vendido: number | null = null;
  for (const mes of mesesDelRango(r)) {
    const o = objetivoDelMes(objetivos, mes.inicio);
    if (!o) continue;
    const parte = mes.dias / mes.diasDelMes;
    if (o.metros != null && o.metros !== "") metros = (metros ?? 0) + num(o.metros) * parte;
    if (o.vendido != null && o.vendido !== "") vendido = (vendido ?? 0) + num(o.vendido) * parte;
  }
  return {
    metros: metros === null ? null : redondear(metros, 2),
    vendido: vendido === null ? null : redondear(vendido),
  };
}

/**
 * Qué parte del rango ha pasado ya, de 0 a 1: para saber si se va por delante
 * o por detrás del objetivo cuando el periodo aún no ha terminado.
 */
export function parteTranscurrida(r: { desde: Date; hasta: Date }, hoy: Date): number {
  const total = mesesDelRango(r).reduce((s, m) => s + m.dias, 0);
  if (soloDia(hoy) < soloDia(r.desde)) return 0;
  if (soloDia(hoy) >= soloDia(r.hasta)) return 1;
  const pasados = mesesDelRango({ desde: r.desde, hasta: hoy }).reduce((s, m) => s + m.dias, 0);
  return total > 0 ? pasados / total : 1;
}

/** Si los pedidos web sin pagar no cuentan, se quitan de las ventas. */
export function aplicarAjustesVentas<T extends Pick<Venta, "canal" | "estado">>(
  ventas: readonly T[],
  a: AjustesGerencia,
): T[] {
  if (a.web_sin_pagar_cuenta) return [...ventas];
  return ventas.filter((v) => !(v.canal === "web" && v.estado === "pendiente"));
}

export type AvanceObjetivo = {
  /** Lo conseguido sobre el objetivo del periodo, en %. */
  porcentaje: number;
  /** Lo que tocaría llevar hoy yendo a ritmo constante. */
  esperado: number;
  /** Lo conseguido menos lo esperado: positivo, por delante. */
  diferencia: number;
};

/**
 * Cómo se va frente a un objetivo: qué parte se lleva y si se va por delante
 * o por detrás del ritmo que toca a estas alturas del periodo.
 */
export function avanceObjetivo(
  conseguido: number,
  objetivo: number,
  transcurrido: number,
): AvanceObjetivo | null {
  if (!(objetivo > 0)) return null;
  const esperado = objetivo * Math.min(1, Math.max(0, transcurrido));
  return {
    porcentaje: redondear((conseguido / objetivo) * 100, 1),
    esperado: redondear(esperado, 2),
    diferencia: redondear(conseguido - esperado, 2),
  };
}

/**
 * Beneficio estimado de un rango: el margen menos los gastos fijos que le
 * tocan, ambos sin IVA. Con `hoy`, los gastos se cuentan solo hasta hoy: a
 * mitad de mes se compara lo vendido hasta hoy con lo gastado hasta hoy, no
 * con el mes entero.
 */
export function beneficioEstimado(
  margen: number,
  gastos: readonly GastoFijo[],
  r: { desde: Date; hasta: Date },
  hoy?: Date,
): { gastos: number; beneficio: number; hastaHoy: boolean } {
  const finHoy = hoy
    ? new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59)
    : null;
  const hastaHoy = finHoy !== null && finHoy < r.hasta;
  const g =
    hastaHoy && finHoy < r.desde
      ? 0
      : gastosFijosDelRango(gastos, { desde: r.desde, hasta: hastaHoy ? finHoy : r.hasta });
  return { gastos: g, beneficio: redondear(margen - g), hastaHoy };
}
