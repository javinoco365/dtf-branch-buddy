/**
 * Lo que queda por cobrar de los pedidos, de las tiendas y del textil.
 *
 * Las filas llegan ya filtradas por la base (la vista pedidos_pendientes_cobro
 * solo devuelve pedidos vivos con saldo). Aquí se filtran por lo que elige la
 * pantalla y se resumen.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { normalizarTexto } from "./clientes";
import { TIENDA_TEXTIL } from "./cobros";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type PedidoPendiente = {
  tipo: "tienda" | "textil";
  id: string;
  tienda_id: string | null;
  numero: string;
  /** Día del pedido, `yyyy-MM-dd`. */
  fecha: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  /** `manual`, `woocommerce` o `textil`. */
  origen: string;
  estado: string;
  total: Numerico;
  cobrado: Numerico;
  pendiente: Numerico;
  ultimo_cobro: string | null;
};

/** De dónde sale el pedido, para filtrar. */
export type OrigenPendiente = "manual" | "web" | "textil";

export const ORIGENES_PENDIENTE: readonly { valor: OrigenPendiente; etiqueta: string }[] = [
  { valor: "manual", etiqueta: "Pedido manual" },
  { valor: "web", etiqueta: "Web (sin pagar)" },
  { valor: "textil", etiqueta: "Textil" },
];

export function origenPendiente(p: Pick<PedidoPendiente, "tipo" | "origen">): OrigenPendiente {
  if (p.tipo === "textil") return "textil";
  return p.origen === "woocommerce" ? "web" : "manual";
}

/** La tienda del pedido, o el identificador del textil: el mismo que en la Consolidada. */
export function tiendaDelPendiente(p: Pick<PedidoPendiente, "tipo" | "tienda_id">): string {
  return p.tipo === "textil" ? TIENDA_TEXTIL.id : (p.tienda_id ?? "");
}

/** Días desde el pedido. Cero si es de hoy o de una fecha futura. */
export function diasDesde(fecha: string, hoy: Date): number {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const dia = new Date(a, m - 1, d);
  const hoyDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.max(0, Math.round((hoyDia.getTime() - dia.getTime()) / 86_400_000));
}

/** A partir de cuántos días un pendiente se marca como antiguo. */
export const DIAS_ANTIGUO = 30;

export type FiltroPendientes = {
  texto: string;
  /** Una tienda, el textil (su identificador) o todas. */
  tienda: string;
  origen: OrigenPendiente | "todos";
  /** Solo los que ya tienen algo cobrado. */
  soloParciales: boolean;
};

export const FILTRO_PENDIENTES_TODO: FiltroPendientes = {
  texto: "",
  tienda: "todas",
  origen: "todos",
  soloParciales: false,
};

export function filtrarPendientes<T extends PedidoPendiente>(
  pedidos: readonly T[],
  f: FiltroPendientes,
): T[] {
  const q = normalizarTexto(f.texto);
  return pedidos.filter(
    (p) =>
      (f.tienda === "todas" || tiendaDelPendiente(p) === f.tienda) &&
      (f.origen === "todos" || origenPendiente(p) === f.origen) &&
      (!f.soloParciales || num(p.cobrado) > 0) &&
      (!q ||
        normalizarTexto(p.cliente_nombre).includes(q) ||
        normalizarTexto(p.numero).includes(q)),
  );
}

export type ResumenPendientes = {
  pedidos: number;
  pendiente: number;
  /** Pedidos con algo cobrado y algo por cobrar. */
  parciales: number;
  /** Pedidos de más de DIAS_ANTIGUO días, y lo que suman. */
  antiguos: number;
  pendienteAntiguo: number;
};

export function resumirPendientes(
  pedidos: readonly PedidoPendiente[],
  hoy: Date,
): ResumenPendientes {
  const antiguos = pedidos.filter((p) => diasDesde(p.fecha, hoy) > DIAS_ANTIGUO);
  return {
    pedidos: pedidos.length,
    pendiente: redondear(pedidos.reduce((s, p) => s + num(p.pendiente), 0)),
    parciales: pedidos.filter((p) => num(p.cobrado) > 0).length,
    antiguos: antiguos.length,
    pendienteAntiguo: redondear(antiguos.reduce((s, p) => s + num(p.pendiente), 0)),
  };
}

/** Los más antiguos primero: son los que más urge cobrar. */
export function ordenarPendientes<T extends PedidoPendiente>(pedidos: readonly T[]): T[] {
  return [...pedidos].sort((a, b) =>
    a.fecha === b.fecha ? a.numero.localeCompare(b.numero) : a.fecha < b.fecha ? -1 : 1,
  );
}
