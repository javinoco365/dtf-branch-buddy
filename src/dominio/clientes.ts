/**
 * La ficha única de clientes: búsqueda y filtro por origen.
 *
 * Desde 20260928100000_clientes_unicos un cliente es de la empresa, no de una
 * tienda ni del textil. `origen` y `tienda_id` solo dicen dónde se dio de
 * alta, y sirven para filtrar, no para esconder: desde cualquier pantalla se
 * puede pasar a ver todos.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos.
 */

import { redondear } from "./importes";

/**
 * Lo que suman los pedidos de un cliente, de las tiendas y del textil juntos.
 * Los importes llegan de Postgres como texto o número según el caso.
 */
export function totalDePedidos(
  ...listas: readonly (readonly { total: number | string | null }[])[]
): number {
  return redondear(listas.flat().reduce((s, p) => s + (Number(p.total ?? 0) || 0), 0));
}

export type OrigenCliente = "tienda" | "textil" | "general";

export type ClienteFiltrable = {
  nombre: string;
  apodo?: string | null;
  email?: string | null;
  nif?: string | null;
  telefono?: string | null;
  tienda_id?: string | null;
  origen?: OrigenCliente | string | null;
};

/** Todos, los del textil, los dados de alta en la pantalla general, o los de una tienda. */
export type FiltroOrigen = "todos" | "textil" | "general" | `tienda:${string}`;

/**
 * Minúsculas y sin tildes: «nautico» tiene que encontrar «Club Náutico», y
 * «pena» a «Peña». Nadie escribe las tildes al buscar deprisa.
 */
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** El NIF sin espacios, guiones ni puntos y en mayúsculas, como lo compara la base. */
export function normalizarNif(nif: string | null | undefined): string {
  return (nif ?? "").replace(/[\s.-]/g, "").toUpperCase();
}

export function coincideBusqueda(c: ClienteFiltrable, texto: string): boolean {
  const q = normalizarTexto(texto);
  if (!q) return true;
  const qNif = normalizarNif(texto);
  return (
    normalizarTexto(c.nombre).includes(q) ||
    normalizarTexto(c.apodo).includes(q) ||
    normalizarTexto(c.email).includes(q) ||
    normalizarTexto(c.telefono).includes(q) ||
    (qNif !== "" && normalizarNif(c.nif).includes(qNif))
  );
}

export function coincideOrigen(c: ClienteFiltrable, filtro: FiltroOrigen): boolean {
  if (filtro === "todos") return true;
  if (filtro === "textil") return c.origen === "textil";
  if (filtro === "general") return c.origen === "general";
  return c.tienda_id === filtro.slice("tienda:".length);
}

export function filtrarClientes<T extends ClienteFiltrable>(
  clientes: readonly T[],
  filtro: { texto: string; origen: FiltroOrigen },
): T[] {
  return clientes.filter(
    (c) => coincideOrigen(c, filtro.origen) && coincideBusqueda(c, filtro.texto),
  );
}

/**
 * Qué poner en la columna «Origen». Un cliente de origen tienda sin tienda es
 * uno cuya tienda se borró: la ficha se conservó, y se dice así en vez de
 * dejar el hueco.
 */
export function etiquetaOrigen(
  c: ClienteFiltrable,
  nombreTienda: (id: string) => string | undefined,
): string {
  if (c.origen === "textil") return "Textil";
  if (c.origen === "general") return "General";
  if (c.tienda_id) return nombreTienda(c.tienda_id) ?? "Tienda";
  return "Tienda borrada";
}
