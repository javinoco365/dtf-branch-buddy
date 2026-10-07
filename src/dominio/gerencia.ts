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
import { calcularKpis, costeProduccion, type KpisPeriodo, type PedidoResumen } from "./kpis";
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
export type Venta = PedidoResumen & { canal: Canal; cliente_id: string | null };

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
  };
}

export type FiltroGerencia = {
  /** Una tienda, el textil (TIENDA_TEXTIL.id) o «todas». */
  tienda: string;
  canal: Canal | "todos";
};

export const FILTRO_GERENCIA_TODO: FiltroGerencia = { tienda: "todas", canal: "todos" };

export function filtrarVentas(ventas: readonly Venta[], f: FiltroGerencia): Venta[] {
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
  /** Coste de producción DTF (metros × coste por metro). El textil no lo tiene aún. */
  coste: number;
  /** Facturación bruta − coste. */
  margen: number;
  /** Base imponible por metro, solo de los pedidos que llevan metros. */
  euroMetro: number;
};

export function cifrasGerencia(ventas: readonly Venta[], costeActual: number): CifrasGerencia {
  const k = calcularKpis(ventas);
  const coste = costeProduccion(ventas, costeActual);
  const conMetros = calcularKpis(ventas.filter((v) => num(v.metros_total) > 0));
  return {
    ...k,
    coste,
    margen: redondear(k.bruta - coste),
    euroMetro: conMetros.metros > 0 ? redondear(conMetros.bruta / conMetros.metros) : 0,
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
    if (c.importe <= 0) continue;
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
  | { tipo: "web_sin_pagar"; nivel: "medio"; pedidos: number; importe: number }
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
  /** Pedidos web del periodo todavía sin pagar. */
  webSinPagar: { pedidos: number; importe: number };
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
