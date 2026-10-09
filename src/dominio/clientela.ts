/**
 * Gerencia › Clientes: quién compra, quién vuelve y quién ha dejado de venir.
 *
 * Trabaja sobre el historial de pedidos (tiendas y textil, ya filtrado por
 * tienda y canal). Un cliente de tienda y uno del textil son fichas distintas
 * aunque se llamen igual: el textil tiene su propia tabla de clientes.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { ESTADO_CANCELADO, totalNeto } from "./kpis";
import { diasDelRango } from "./periodos";
import { momentoDelPedido, pedidoEnRango } from "./dia-pedido";
import { diasDesde } from "./pendientes";
import { diaLocal } from "./facturacion";
import type { Canal, Venta } from "./gerencia";

/** Un pedido del historial, con el nombre del cliente tal como se guardó. */
export type VentaCliente = Venta & { cliente_nombre: string | null };

type Rango = { desde: Date; hasta: Date };

/** A partir de cuántos días sin pedir un cliente se da por dormido. */
export const DIAS_DORMIDO = 60;

/** Qué parte de lo vendido se mira para la regla del 80/20. */
export const PARTE_PARETO = 80;

/**
 * La ficha del cliente: la de tienda tal cual y la del textil con prefijo,
 * porque son tablas distintas. Sin cliente, nulo.
 */
export function claveCliente(v: Pick<Venta, "canal" | "cliente_id">): string | null {
  if (!v.cliente_id) return null;
  return v.canal === "textil" ? `textil:${v.cliente_id}` : v.cliente_id;
}

type Acumulado = {
  clave: string;
  nombre: string;
  canal: Canal;
  cliente_id: string;
  vendido: number;
  pedidos: number;
  /**
   * El momento del primero y del último en el reloj de España
   * ('yyyy-mm-ddThh:mm:ss', ver momentoDelPedido): así se comparan bien un
   * pedido web, uno del CRM y uno textil, y su día es el de su ticket.
   */
  primera: string;
  ultima: string;
};

const vendida = (v: Venta) => v.estado !== ESTADO_CANCELADO;

/** Suma por cliente los pedidos no cancelados. */
function porCliente(ventas: readonly VentaCliente[]): Map<string, Acumulado> {
  const mapa = new Map<string, Acumulado>();
  for (const v of ventas) {
    const clave = claveCliente(v);
    if (!clave || !vendida(v)) continue;
    const a = mapa.get(clave);
    const nombre = v.cliente_nombre?.trim() || "Sin nombre";
    const momento = momentoDelPedido(v);
    if (!a) {
      mapa.set(clave, {
        clave,
        nombre,
        canal: v.canal,
        cliente_id: v.cliente_id!,
        vendido: totalNeto(v),
        pedidos: 1,
        primera: momento,
        ultima: momento,
      });
      continue;
    }
    a.vendido += totalNeto(v);
    a.pedidos += 1;
    if (momento < a.primera) a.primera = momento;
    if (momento >= a.ultima) {
      a.ultima = momento;
      // El nombre del pedido más reciente: si se corrigió, el bueno.
      a.nombre = nombre;
      a.canal = v.canal;
    }
  }
  return mapa;
}

export type ClientePeriodo = {
  clave: string;
  cliente_id: string;
  canal: Canal;
  nombre: string;
  vendido: number;
  pedidos: number;
  /** Primer pedido de su historia, no del periodo: su momento en el reloj de España. */
  primera: string;
  /** Si su primer pedido cae en el periodo. */
  nuevo: boolean;
  /** Su parte de lo vendido a clientes en el periodo, en %. */
  peso: number;
  /** Su peso más el de todos los que van por delante, en %. */
  acumulado: number;
};

export type ResumenClientes = {
  /** Clientes con algún pedido en el periodo. */
  activos: number;
  nuevos: number;
  recurrentes: number;
  vendidoNuevos: number;
  vendidoRecurrentes: number;
  /** Pedidos sin cliente asociado: cuentan en lo vendido, no aquí. */
  sinCliente: { pedidos: number; vendido: number };
  /** Todos los clientes del periodo, de más a menos vendido. */
  ranking: ClientePeriodo[];
  /** Cuántos clientes hacen el PARTE_PARETO % de lo vendido. */
  pareto: { clientes: number; porcentajeClientes: number } | null;
};

/**
 * Los clientes del periodo. Nuevo es quien hace su primer pedido en el
 * periodo; recurrente, quien ya había pedido antes. Necesita el historial
 * entero, no solo el periodo: si no, todos parecerían nuevos.
 */
export function resumenClientes(historial: readonly VentaCliente[], r: Rango): ResumenClientes {
  const historia = porCliente(historial);
  // Por el día del pedido, como el resto de Gerencia (ver dia-pedido.ts).
  const delPeriodo = historial.filter((v) => pedidoEnRango(v, r));
  const dias = diasDelRango(r);
  const periodo = porCliente(delPeriodo);

  let vendidoNuevos = 0;
  let vendidoRecurrentes = 0;
  let nuevos = 0;
  const sinCliente = { pedidos: 0, vendido: 0 };
  for (const v of delPeriodo) {
    if (!claveCliente(v) && vendida(v)) {
      sinCliente.pedidos += 1;
      sinCliente.vendido += totalNeto(v);
    }
  }

  const total = [...periodo.values()].reduce((s, c) => s + c.vendido, 0);
  const ordenados = [...periodo.values()].sort(
    (a, b) => b.vendido - a.vendido || a.nombre.localeCompare(b.nombre),
  );
  let acumulado = 0;
  const ranking: ClientePeriodo[] = ordenados.map((c) => {
    const primera = historia.get(c.clave)?.primera ?? c.primera;
    const nuevo =
      dias !== null && primera.slice(0, 10) >= dias.desde && primera.slice(0, 10) <= dias.hasta;
    if (nuevo) {
      nuevos += 1;
      vendidoNuevos += c.vendido;
    } else {
      vendidoRecurrentes += c.vendido;
    }
    acumulado += c.vendido;
    return {
      clave: c.clave,
      cliente_id: c.cliente_id,
      canal: c.canal,
      nombre: c.nombre,
      vendido: redondear(c.vendido),
      pedidos: c.pedidos,
      primera,
      nuevo,
      peso: total > 0 ? redondear((c.vendido / total) * 100, 1) : 0,
      acumulado: total > 0 ? redondear((acumulado / total) * 100, 1) : 0,
    };
  });

  let pareto: ResumenClientes["pareto"] = null;
  if (total > 0) {
    // El primero con el que el acumulado llega al 80 %. Sin redondear, para
    // que un 79,96 % no cuente como 80.
    let suma = 0;
    let k = 0;
    for (const c of ordenados) {
      suma += c.vendido;
      k += 1;
      if (suma >= (total * PARTE_PARETO) / 100 - 1e-9) break;
    }
    pareto = { clientes: k, porcentajeClientes: redondear((k / ordenados.length) * 100, 1) };
  }

  return {
    activos: ranking.length,
    nuevos,
    recurrentes: ranking.length - nuevos,
    vendidoNuevos: redondear(vendidoNuevos),
    vendidoRecurrentes: redondear(vendidoRecurrentes),
    sinCliente: { pedidos: sinCliente.pedidos, vendido: redondear(sinCliente.vendido) },
    ranking,
    pareto,
  };
}

export type ClienteDormido = {
  clave: string;
  cliente_id: string;
  canal: Canal;
  nombre: string;
  /** Todo lo que ha comprado, con IVA y sin devoluciones. */
  vendido: number;
  pedidos: number;
  ultima: string;
  dias: number;
};

/**
 * Los clientes que llevan más de `dias` sin pedir, a día de hoy, de más a
 * menos comprado en toda su historia: los primeros son los que más cuesta
 * perder. No depende del periodo elegido.
 */
export function clientesDormidos(
  historial: readonly VentaCliente[],
  hoy: Date,
  dias: number = DIAS_DORMIDO,
): ClienteDormido[] {
  return [...porCliente(historial).values()]
    .map((c) => ({
      clave: c.clave,
      cliente_id: c.cliente_id,
      canal: c.canal,
      nombre: c.nombre,
      vendido: redondear(c.vendido),
      pedidos: c.pedidos,
      ultima: c.ultima,
      dias: diasDesde(diaLocal(c.ultima), hoy),
    }))
    .filter((c) => c.dias > dias)
    .sort((a, b) => b.vendido - a.vendido || b.dias - a.dias);
}
