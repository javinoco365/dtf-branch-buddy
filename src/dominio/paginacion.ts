/**
 * Páginas de una lista que se lee por trozos: qué filas pedir a la base para
 * una página, cuál es la última y qué tramo se enseña («101–200 de 340»).
 *
 * Las páginas cuentan desde 0; las filas que se enseñan, desde 1.
 *
 * Lógica pura: sin base de datos, sin pantallas.
 */

/** Una página válida: entera, de 0 en adelante. */
function normal(pagina: number): number {
  return Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 0;
}

/**
 * Primera y última fila de la página, contando desde 0, como las pide
 * `range(desde, hasta)` de Supabase (las dos incluidas).
 */
export function filasDePagina(pagina: number, porPagina: number): { desde: number; hasta: number } {
  const desde = normal(pagina) * porPagina;
  return { desde, hasta: desde + porPagina - 1 };
}

/** La última página que tiene filas. Sin filas, la 0 (la lista vacía es una página). */
export function ultimaPagina(total: number, porPagina: number): number {
  return total > 0 ? Math.ceil(total / porPagina) - 1 : 0;
}

/**
 * Lo que se enseña de una página: «de la fila `primera` a la `ultima`», desde
 * 1. Si la página pedida ya no existe (se han quitado filas), la última que
 * quede. Sin filas, de 0 a 0.
 */
export function tramoDePagina(
  pagina: number,
  porPagina: number,
  total: number,
): { pagina: number; primera: number; ultima: number } {
  if (total <= 0) return { pagina: 0, primera: 0, ultima: 0 };
  const p = Math.min(normal(pagina), ultimaPagina(total, porPagina));
  return { pagina: p, primera: p * porPagina + 1, ultima: Math.min(total, (p + 1) * porPagina) };
}

/**
 * Una página de una lista que ya está entera en memoria, con el total. Si la
 * pedida ya no existe (se han quitado filas), la última que quede, igual que
 * cuando se pide a la base.
 */
export function paginaDeLista<T>(
  lista: readonly T[],
  pagina: number,
  porPagina: number,
): { filas: T[]; pagina: number; total: number } {
  const p = Math.min(normal(pagina), ultimaPagina(lista.length, porPagina));
  const { desde, hasta } = filasDePagina(p, porPagina);
  return { filas: lista.slice(desde, hasta + 1), pagina: p, total: lista.length };
}
