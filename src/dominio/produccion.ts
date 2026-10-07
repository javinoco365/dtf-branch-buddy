/**
 * Gerencia › Producción: qué hay en el taller y cuánto se tarda en enviar.
 *
 * El pedido todavía tiene un solo estado (pendiente → … → entregado), que
 * mezcla producción y envío. Aquí se lee tal cual; cuando existan los tres
 * estados separados, se cambia solo este fichero.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { diaLocal } from "./facturacion";
import { diasDesde } from "./pendientes";
import type { Canal } from "./gerencia";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

/** Los estados, en el orden en que pasa un pedido, con el nombre de la pantalla de pedidos. */
export const ESTADOS_PEDIDO: readonly { valor: string; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "en_produccion", etiqueta: "Procesando" },
  { valor: "imprimiendo", etiqueta: "Imprimiendo" },
  { valor: "listo", etiqueta: "Listo" },
  { valor: "enviado", etiqueta: "Enviado" },
  { valor: "entregado", etiqueta: "Completado" },
  { valor: "cancelado", etiqueta: "Cancelado" },
];

/** Los que todavía no han salido del taller. */
export const ESTADOS_ABIERTOS = ["pendiente", "en_produccion", "imprimiendo", "listo"] as const;

export function etiquetaEstadoPedido(estado: string): string {
  return ESTADOS_PEDIDO.find((e) => e.valor === estado)?.etiqueta ?? estado;
}

/** Un pedido con lo justo para el taller. */
export type PedidoTaller = {
  fecha_pedido: string;
  estado: string;
  tienda_id: string;
  canal: Canal;
  metros_total: Numerico;
  total: Numerico;
};

export type FilaEstado = {
  estado: string;
  etiqueta: string;
  pedidos: number;
  metros: number;
  importe: number;
};

/** Cuántos pedidos hay en cada estado, en el orden del proceso. Solo los estados con pedidos. */
export function pedidosPorEstado(pedidos: readonly PedidoTaller[]): FilaEstado[] {
  const filas = new Map<string, FilaEstado>();
  for (const p of pedidos) {
    const f = filas.get(p.estado) ?? {
      estado: p.estado,
      etiqueta: etiquetaEstadoPedido(p.estado),
      pedidos: 0,
      metros: 0,
      importe: 0,
    };
    f.pedidos += 1;
    f.metros += num(p.metros_total);
    f.importe += num(p.total);
    filas.set(p.estado, f);
  }
  const orden = (e: string) => {
    const i = ESTADOS_PEDIDO.findIndex((x) => x.valor === e);
    return i === -1 ? ESTADOS_PEDIDO.length : i;
  };
  return [...filas.values()]
    .sort((a, b) => orden(a.estado) - orden(b.estado))
    .map((f) => ({ ...f, metros: redondear(f.metros, 2), importe: redondear(f.importe) }));
}

export type FilaTaller = FilaEstado & {
  /** Días de media desde el pedido, a hoy. */
  diasMedios: number;
  /** El que más lleva esperando, en días. */
  diasMaximo: number;
};

/**
 * Lo que está ahora en el taller, por estado, con cuánto lleva esperando.
 * Siempre los cuatro estados abiertos, aunque estén a cero.
 */
export function trabajoAbierto(pedidos: readonly PedidoTaller[], hoy: Date): FilaTaller[] {
  return ESTADOS_ABIERTOS.map((estado) => {
    const de = pedidos.filter((p) => p.estado === estado);
    const dias = de.map((p) => diasDesde(diaLocal(p.fecha_pedido), hoy));
    const [fila] = pedidosPorEstado(de);
    return {
      estado,
      etiqueta: etiquetaEstadoPedido(estado),
      pedidos: de.length,
      metros: fila?.metros ?? 0,
      importe: fila?.importe ?? 0,
      diasMedios: dias.length ? redondear(dias.reduce((s, d) => s + d, 0) / dias.length, 1) : 0,
      diasMaximo: dias.length ? Math.max(...dias) : 0,
    };
  });
}

/** Un envío: cuándo se pidió y cuándo se le puso el seguimiento. */
export type EnvioPedido = {
  fecha_pedido: string;
  /** Cuando se creó el primer enlace de seguimiento del pedido. */
  enviado_en: string;
  tienda_id: string;
  canal: Canal;
};

export type TiemposEnvio = {
  envios: number;
  media: number;
  mediana: number;
  tramos: { clave: string; etiqueta: string; envios: number }[];
};

const TRAMOS_ENVIO = [
  { clave: "0-1", etiqueta: "En el día o al siguiente", hasta: 1 },
  { clave: "2-3", etiqueta: "De 2 a 3 días", hasta: 3 },
  { clave: "4-7", etiqueta: "De 4 a 7 días", hasta: 7 },
  { clave: "8+", etiqueta: "Más de 7 días", hasta: Infinity },
];

/** Días naturales del pedido al envío, por día local. */
export function diasHastaEnvio(e: Pick<EnvioPedido, "fecha_pedido" | "enviado_en">): number {
  const [a, m, d] = diaLocal(e.enviado_en).split("-").map(Number);
  return diasDesde(diaLocal(e.fecha_pedido), new Date(a, m - 1, d));
}

/** Cuánto se tarda en enviar: media, mediana y reparto por tramos. */
export function tiemposEnvio(envios: readonly EnvioPedido[]): TiemposEnvio | null {
  if (envios.length === 0) return null;
  const dias = envios.map(diasHastaEnvio).sort((a, b) => a - b);
  const mitad = Math.floor(dias.length / 2);
  const mediana = dias.length % 2 ? dias[mitad] : (dias[mitad - 1] + dias[mitad]) / 2;
  return {
    envios: dias.length,
    media: redondear(dias.reduce((s, d) => s + d, 0) / dias.length, 1),
    mediana,
    tramos: TRAMOS_ENVIO.map((t, i) => ({
      clave: t.clave,
      etiqueta: t.etiqueta,
      envios: dias.filter((d) => d <= t.hasta && (i === 0 || d > TRAMOS_ENVIO[i - 1].hasta)).length,
    })),
  };
}
