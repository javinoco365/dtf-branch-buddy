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

/**
 * Qué clientes han comprado de cada línea de producto, por sus pedidos de
 * tienda: DTF UV si algún pedido lleva metros de UV; DTF si alguno lleva
 * metros de DTF o no lleva UV (un pedido de tienda sin metros es de DTF). Un
 * cliente puede estar en las dos.
 */
export function clientesPorLinea(
  pedidos: readonly {
    cliente_id: string | null;
    metros_total?: number | string | null;
    metros_uv?: number | string | null;
  }[],
): { dtf: Set<string>; uv: Set<string> } {
  const dtf = new Set<string>();
  const uv = new Set<string>();
  for (const p of pedidos) {
    if (!p.cliente_id) continue;
    const conUv = Number(p.metros_uv ?? 0) > 0;
    if (conUv) uv.add(p.cliente_id);
    if (!conUv || Number(p.metros_total ?? 0) > 0) dtf.add(p.cliente_id);
  }
  return { dtf, uv };
}

/** ¿Pasa el cliente el filtro de línea? «todo», siempre. */
export function coincideLinea(
  clienteId: string,
  linea: "todo" | "dtf" | "uv",
  porLinea: { dtf: ReadonlySet<string>; uv: ReadonlySet<string> },
): boolean {
  return linea === "todo" || porLinea[linea].has(clienteId);
}
