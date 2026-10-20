/**
 * La cuenta del almacén textil: existencias iniciales + compras − coste de lo
 * vendido − mermas ± ajustes = existencias finales, por unidades y por valor.
 *
 * Todo sale del libro de movimientos (`textil_stock_movimientos`), que es
 * inmutable: el valor del almacén a cualquier fecha se reconstruye sumando sus
 * movimientos hasta ese día. El valor de cada movimiento es
 * redondear(cantidad × coste_unitario, 2) (I9) y todas las partidas suman esos
 * mismos valores, así que la identidad es exacta y el descuadre es 0 siempre
 * que los datos sean coherentes.
 *
 * Lógica pura: sin base de datos ni red.
 */

import type { ResumenControles } from "./controles-almacen";
import { diaEnEspana } from "./fecha-documento";
import { redondear } from "./importes";
import type { MotivoStock, Partida } from "./tipos-textil";

export type MovimientoAlmacen = {
  fecha?: string | null; // YYYY-MM-DD
  created_at?: string | null; // ISO, para las filas sin fecha
  motivo: MotivoStock;
  cantidad: number | string;
  coste_unitario: number | string;
  stock_id?: string | null;
  compra_id?: string | null;
  /** Para separar lo que ya cuesta por pedido («Coste de la ropa») de lo que no. */
  textil_pedido_id?: string | null;
};

const numero = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * fecha si la hay; si no, el día de created_at en Madrid (diaEnEspana). Sin
 * ninguna de las dos, "" (cuenta como anterior a cualquier fecha).
 */
export function fechaEfectiva(m: Pick<MovimientoAlmacen, "fecha" | "created_at">): string {
  if (m.fecha && /^\d{4}-\d{2}-\d{2}/.test(m.fecha)) return m.fecha.slice(0, 10);
  if (m.created_at) {
    const d = new Date(m.created_at);
    if (!Number.isNaN(d.getTime())) return diaEnEspana(d);
  }
  return "";
}

/** redondear(cantidad × coste_unitario, 2), con signo (I9). */
export function valorMovimiento(m: Pick<MovimientoAlmacen, "cantidad" | "coste_unitario">): number {
  return redondear(numero(m.cantidad) * numero(m.coste_unitario), 2);
}

const partidaVacia = (): Partida => ({ unidades: 0, valor: 0 });

function sumar(p: Partida, m: MovimientoAlmacen, signo: 1 | -1 = 1): void {
  p.unidades += signo * numero(m.cantidad);
  p.valor += signo * valorMovimiento(m);
}

const cerrar = (p: Partida): Partida => ({
  unidades: redondear(p.unidades, 6),
  valor: redondear(p.valor, 2),
});

/** Σ de los movimientos con fecha efectiva ≤ fecha. */
export function valorAFecha(movs: readonly MovimientoAlmacen[], fecha: string): Partida {
  const p = partidaVacia();
  for (const m of movs) if (fechaEfectiva(m) <= fecha) sumar(p, m);
  return cerrar(p);
}

export type CuentaAlmacen = {
  desde: string;
  hasta: string;
  inicial: Partida; // todo lo anterior a `desde`
  compras: Partida; // motivo compra en el periodo
  altas: Partida; // motivo inicial en el periodo
  devolucionesCliente: Partida;
  ventas: Partida; // en positivo: lo que sale
  mermas: Partida; // en positivo
  devolucionesProveedor: Partida; // en positivo
  ajustes: Partida; // con signo: + entra, − sale
  final: Partida; // todo hasta `hasta`
  /**
   * Lo que cuesta en Resultados y no cuesta ya por pedido: −Σ valorMovimiento de los
   * movimientos del periodo que no son `compra` ni `inicial` ni (`venta` o
   * `devolucion_cliente`) con `textil_pedido_id`. Es decir: mermas + devoluciones a
   * proveedor − ajustes − devoluciones de cliente sin pedido + ventas sin pedido.
   */
  perdidas: number;
  /** final − (inicial + compras + altas + devCli − ventas − mermas − devProv + ajustes); 0 siempre que los datos sean coherentes. */
  descuadre: Partida;
};

/** Lo que ya cuesta por pedido («Coste de la ropa»): ventas y devoluciones de cliente con pedido. */
function cuestaPorPedido(m: MovimientoAlmacen): boolean {
  return (m.motivo === "venta" || m.motivo === "devolucion_cliente") && !!m.textil_pedido_id;
}

export function cuentaAlmacen(
  movs: readonly MovimientoAlmacen[],
  desde: string,
  hasta: string,
): CuentaAlmacen {
  const inicial = partidaVacia();
  const final = partidaVacia();
  const compras = partidaVacia();
  const altas = partidaVacia();
  const devolucionesCliente = partidaVacia();
  const ventas = partidaVacia();
  const mermas = partidaVacia();
  const devolucionesProveedor = partidaVacia();
  const ajustes = partidaVacia();
  let perdidas = 0;

  for (const m of movs) {
    const f = fechaEfectiva(m);
    if (f > hasta) continue;
    sumar(final, m);
    if (f < desde) {
      sumar(inicial, m);
      continue;
    }
    switch (m.motivo) {
      case "compra":
        sumar(compras, m);
        break;
      case "inicial":
        sumar(altas, m);
        break;
      case "devolucion_cliente":
        sumar(devolucionesCliente, m);
        break;
      case "venta":
        sumar(ventas, m, -1);
        break;
      case "merma":
        sumar(mermas, m, -1);
        break;
      case "devolucion_proveedor":
        sumar(devolucionesProveedor, m, -1);
        break;
      default:
        // ajuste_inventario y cualquier motivo que no se conozca: con signo,
        // para que la identidad no se rompa.
        sumar(ajustes, m);
    }
    if (m.motivo !== "compra" && m.motivo !== "inicial" && !cuestaPorPedido(m)) {
      perdidas -= valorMovimiento(m);
    }
  }

  const c = {
    inicial: cerrar(inicial),
    compras: cerrar(compras),
    altas: cerrar(altas),
    devolucionesCliente: cerrar(devolucionesCliente),
    ventas: cerrar(ventas),
    mermas: cerrar(mermas),
    devolucionesProveedor: cerrar(devolucionesProveedor),
    ajustes: cerrar(ajustes),
    final: cerrar(final),
  };
  const esperado = (k: keyof Partida) =>
    c.inicial[k] +
    c.compras[k] +
    c.altas[k] +
    c.devolucionesCliente[k] -
    c.ventas[k] -
    c.mermas[k] -
    c.devolucionesProveedor[k] +
    c.ajustes[k];
  return {
    desde,
    hasta,
    ...c,
    perdidas: redondear(perdidas, 2),
    descuadre: {
      unidades: redondear(c.final.unidades - esperado("unidades"), 6),
      valor: redondear(c.final.valor - esperado("valor"), 2),
    },
  };
}

/** Lo que cuesta el almacén en Resultados en el periodo, aparte del coste por pedido: `perdidas`. */
export function costeAlmacenPeriodo(
  movs: readonly MovimientoAlmacen[],
  desde: string,
  hasta: string,
): number {
  return cuentaAlmacen(movs, desde, hasta).perdidas;
}

/** Lo que necesita la página «Almacén» del informe de socios. */
export type InformeAlmacen = {
  cuenta: CuentaAlmacen;
  /** Unidades × coste medio de hoy (la caché); null si no se pudo leer. */
  valorHoy: number | null;
  controles: ResumenControles | null; // de controles-almacen.ts
  pagosProveedores: { total: number; facturas: number } | null;
};
