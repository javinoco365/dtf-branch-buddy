/**
 * Cómo se cuenta en pantalla una sincronización con WooCommerce. Lo usan el
 * botón «Sincronizar» de Pedidos y «Sincronizar ahora» de los ajustes de la
 * tienda, para que los dos digan lo mismo.
 *
 * Solo textos: qué se sincroniza y por dónde va está en src/dominio/cursor-woo.ts
 * y en sincronizarWoo (src/lib/woocommerce.functions.ts).
 */
import { numero } from "./format";
import { comoSeguirWoo, type ContinuacionWoo } from "@/dominio/cursor-woo";

/** Lo que devuelve una tanda de sincronizarWoo y hace falta para contarlo. */
export type TandaSyncWoo = {
  pedidos: number;
  clientes: number;
  productos: number;
  devoluciones_actualizadas: number;
  pedidos_borrados: number;
  protegidos_por_factura: number;
  quedan: number | null;
  siguiente: ContinuacionWoo | null;
  reanudable: boolean;
  avisos: string[];
};

/** Lo hecho en una o varias tandas seguidas. */
export type SumaSyncWoo = {
  pedidos: number;
  clientes: number;
  productos: number;
  devoluciones: number;
  borrados: number;
  protegidos: number;
};

export const SUMA_SYNC_WOO_VACIA: SumaSyncWoo = {
  pedidos: 0,
  clientes: 0,
  productos: 0,
  devoluciones: 0,
  borrados: 0,
  protegidos: 0,
};

export function sumarTandaWoo(suma: SumaSyncWoo, r: TandaSyncWoo): SumaSyncWoo {
  return {
    pedidos: suma.pedidos + r.pedidos,
    clientes: suma.clientes + r.clientes,
    productos: suma.productos + r.productos,
    devoluciones: suma.devoluciones + r.devoluciones_actualizadas,
    borrados: suma.borrados + r.pedidos_borrados,
    protegidos: suma.protegidos + r.protegidos_por_factura,
  };
}

/** «Sincronizado: 120 pedidos, 3 clientes, 0 productos, …». */
export function textoSincronizado(s: SumaSyncWoo): string {
  const detalles = [
    `${numero(s.pedidos, 0)} pedidos`,
    `${numero(s.clientes, 0)} clientes`,
    `${numero(s.productos, 0)} productos`,
  ];
  if (s.devoluciones > 0) detalles.push(`${numero(s.devoluciones, 0)} con devolución`);
  if (s.borrados > 0) {
    detalles.push(`${numero(s.borrados, 0)} borrados (ya no están en WooCommerce)`);
  }
  return `Sincronizado: ${detalles.join(", ")}`;
}

/** El aviso de los pedidos que han desaparecido de WooCommerce pero tienen factura. */
export function textoProtegidos(s: SumaSyncWoo): string | null {
  if (s.protegidos <= 0) return null;
  return `${numero(s.protegidos, 0)} ${
    s.protegidos === 1
      ? "pedido ha desaparecido de WooCommerce pero no se ha borrado"
      : "pedidos han desaparecido de WooCommerce pero no se han borrado"
  }: tienen una factura emitida.`;
}

/**
 * Lo que ha quedado por traer después de UNA llamada, y cómo seguir. Para el
 * botón de Pedidos, que hace una sola tanda; `null` si no queda nada. Cada
 * llamada mueve los pedidos al menos una página, así que «volver a pulsar»
 * siempre avanza; cuando no seguiría por donde se quedó (sin la migración
 * 20261024110000), se dice qué hacer en su lugar (ver comoSeguirWoo).
 */
export function textoQuedan(r: Pick<TandaSyncWoo, "quedan" | "siguiente" | "reanudable">) {
  const s = r.siguiente;
  if (!s) return null;
  const partes: string[] = [];
  if (s.pedidos) partes.push(r.quedan ? `unos ${numero(r.quedan, 0)} pedidos` : "pedidos");
  if (s.clientes) partes.push("clientes nuevos");
  if (s.productos) partes.push("productos");
  const queda = `Queda por traer: ${partes.join(", ")}.`;
  if (r.reanudable) return `${queda} Vuelve a pulsar «Sincronizar» para seguir donde se quedó.`;
  const como = comoSeguirWoo(s, r.reanudable);
  const frases = [queda];
  if (como.pulsar) frases.push("Vuelve a pulsar «Sincronizar» para seguir con el resto.");
  if (como.ajustes) {
    frases.push(
      "Para el resto, «Sincronizar ahora» en los ajustes de la tienda: sigue tanda tras tanda " +
        "hasta el final.",
    );
  }
  if (como.clientes) {
    frases.push(
      "Los clientes nuevos que falten llegan con «Sincronizar clientes», en los ajustes de la " +
        "tienda.",
    );
  }
  return frases.join(" ");
}
