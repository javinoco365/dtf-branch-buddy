/**
 * Filtros de las pantallas guardados en la dirección (la URL).
 *
 * Así un filtro sobrevive a recargar la página, a ir y volver, y se puede
 * compartir un enlace que abre la lista ya filtrada. En la dirección solo va lo
 * que difiere del valor por defecto: una pantalla sin filtros tiene la
 * dirección limpia.
 *
 * Lógica pura: no sabe nada del router. Recibe lo que haya en la dirección
 * (que puede venir como texto, número o booleano, según cómo lo interprete el
 * router) y devuelve valores del mismo tipo que los por defecto.
 */

export type ValorFiltro = string | number | boolean;
export type Filtros = Record<string, ValorFiltro>;

function convertir(bruto: unknown, porDefecto: ValorFiltro): ValorFiltro {
  if (bruto === undefined || bruto === null || bruto === "") return porDefecto;
  if (typeof porDefecto === "boolean") {
    if (bruto === true || bruto === "true" || bruto === "1") return true;
    if (bruto === false || bruto === "false" || bruto === "0") return false;
    return porDefecto;
  }
  if (typeof porDefecto === "number") {
    const n = Number(bruto);
    return Number.isFinite(n) ? n : porDefecto;
  }
  return String(bruto);
}

/**
 * Los filtros que dice la dirección, con el tipo de los por defecto. Lo que
 * falta o no se entiende vale lo que diga el valor por defecto.
 */
export function leerFiltros<T extends Filtros>(
  busqueda: Record<string, unknown> | null | undefined,
  porDefecto: T,
): T {
  const salida = { ...porDefecto };
  for (const clave of Object.keys(porDefecto) as (keyof T)[]) {
    salida[clave] = convertir(busqueda?.[clave as string], porDefecto[clave]) as T[keyof T];
  }
  return salida;
}

/**
 * La dirección nueva: la anterior con los cambios aplicados, y sin las claves
 * que vuelven a su valor por defecto. Las claves que no son de estos filtros
 * (las de otra pestaña, por ejemplo) se respetan.
 */
export function escribirFiltros<T extends Filtros>(
  anterior: Record<string, unknown> | null | undefined,
  cambios: Partial<T>,
  porDefecto: T,
): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...(anterior ?? {}) };
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!(clave in porDefecto)) continue;
    if (valor === undefined || valor === porDefecto[clave] || valor === "") {
      delete salida[clave];
    } else {
      salida[clave] = valor;
    }
  }
  return salida;
}

/** Quita de la dirección todos estos filtros, dejando el resto. */
export function quitarFiltros(
  anterior: Record<string, unknown> | null | undefined,
  porDefecto: Filtros,
): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...(anterior ?? {}) };
  for (const clave of Object.keys(porDefecto)) delete salida[clave];
  return salida;
}

/** Si alguno difiere de su valor por defecto: para enseñar «Quitar filtros». */
export function hayFiltros(valores: Filtros, porDefecto: Filtros, ignorar: string[] = []): boolean {
  return Object.keys(porDefecto).some((k) => !ignorar.includes(k) && valores[k] !== porDefecto[k]);
}

// ---------------------------------------------------------------------------
// Fechas en la dirección (los periodos están en periodos.ts)
// ---------------------------------------------------------------------------

/**
 * El día de referencia que guarda la dirección, `yyyy-MM-dd`. Vacío o mal
 * escrito es hoy: así la dirección sin fecha siempre abre el periodo actual.
 */
export function leerFecha(texto: string | null | undefined, hoy: Date = new Date()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ""));
  if (!m) return hoy;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? hoy : d;
}
