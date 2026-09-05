/**
 * Direcciones de facturación y de envío de un pedido.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase, y
 * se prueba sin base de datos.
 *
 * ## Por qué hay que normalizar antes de guardar
 *
 * Un formulario de nueve campos casi nunca se rellena entero. Si se guarda tal
 * cual, en `pedidos.direccion_envio` acaba un objeto como
 * `{"nombre":"","ciudad":"  ","pais":""}`: no tiene ninguna información, pero
 * **no es `NULL`**, así que cualquier comprobación de «este pedido tiene
 * dirección» dice que sí. La pantalla enseña un bloque vacío y una etiqueta de
 * envío saldría en blanco sin que nadie se entere hasta tenerla impresa.
 *
 * `normalizarDireccion` recorta los espacios, tira lo que quede vacío y
 * devuelve `null` si no queda nada. La invariante que impone es sencilla: **si
 * la columna no es `NULL`, tiene al menos un dato de verdad.**
 *
 * También descarta las claves que no reconoce. Lo que se guarda en la columna
 * es la forma documentada en la migración y nada más, porque de ahí salen la
 * etiqueta de envío y, más adelante, el receptor congelado de la factura.
 */

/** Una dirección congelada en el pedido. Todos los campos pueden faltar. */
export type Direccion = {
  nombre?: string | null;
  empresa?: string | null;
  direccion?: string | null;
  codigo_postal?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  pais?: string | null;
  telefono?: string | null;
  email?: string | null;
};

/**
 * Las claves válidas, en el orden en que se leen.
 *
 * Es la misma lista que documenta `COMMENT ON COLUMN
 * public.pedidos.direccion_facturacion`. Si se añade un campo, va en los dos
 * sitios.
 */
export const CAMPOS_DIRECCION = [
  "nombre",
  "empresa",
  "direccion",
  "codigo_postal",
  "ciudad",
  "provincia",
  "pais",
  "telefono",
  "email",
] as const satisfies readonly (keyof Direccion)[];

/**
 * Deja la dirección lista para guardar, o `null` si no hay nada que guardar.
 *
 * - Recorta los espacios de cada campo.
 * - Quita los campos que queden vacíos, en vez de guardarlos como `""`.
 * - Ignora las claves que no estén en `CAMPOS_DIRECCION`.
 * - Devuelve `null` si al terminar no queda ningún campo.
 */
export function normalizarDireccion(entrada: unknown): Direccion | null {
  if (!entrada || typeof entrada !== "object") return null;
  const origen = entrada as Record<string, unknown>;

  const salida: Direccion = {};
  let tieneAlgo = false;
  for (const campo of CAMPOS_DIRECCION) {
    const valor = origen[campo];
    if (typeof valor !== "string") continue;
    const limpio = valor.trim();
    if (!limpio) continue;
    salida[campo] = limpio;
    tieneAlgo = true;
  }
  return tieneAlgo ? salida : null;
}

/**
 * La dirección en líneas, saltándose lo que no venga.
 *
 * Se usa para pintarla y para compararla: dos direcciones son «la misma» si
 * producen las mismas líneas. El correo no entra porque no va en una etiqueta
 * de envío.
 */
export function lineasDireccion(d: Direccion): string[] {
  const cp = [d.codigo_postal, d.ciudad].filter(Boolean).join(" ");
  return [
    d.nombre,
    d.empresa,
    d.direccion,
    cp,
    [d.provincia, d.pais].filter(Boolean).join(", "),
    d.telefono,
  ]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

/** Si las dos direcciones se imprimirían igual. Dos nulas no son «la misma». */
export function mismaDireccion(a: Direccion | null, b: Direccion | null): boolean {
  if (!a || !b) return false;
  return lineasDireccion(a).join("|") === lineasDireccion(b).join("|");
}
