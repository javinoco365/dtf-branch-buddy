/**
 * Los números como los escribe una persona en un campo de texto, y al revés.
 *
 * Una sola lectura para todos los formularios (pedidos, caja, cobros,
 * presupuestos, inversiones, plantillas, variantes, envíos): con coma o con
 * punto decimal, con puntos de miles, y si no es un número, NaN, para que
 * quien la llame lo diga en vez de tomarlo por 0 en silencio.
 *
 * Lógica pura: sin React ni Supabase.
 */

/** «1.234» o «12.345.678»: puntos de miles sin coma (y sin empezar por 0: «0.250» es decimal). */
const SOLO_MILES = /^[+-]?[1-9]\d{0,2}(\.\d{3})+$/;
/** Lo que queda tras normalizar: un número decimal con punto, sin más. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Un número como lo escribe una persona:
 *
 * - «12,5» y «12.5» son 12,5.
 * - «1.234» (punto y exactamente tres cifras detrás, sin coma) son mil
 *   doscientos treinta y cuatro: puntos de miles.
 * - «1.234,5» es 1234,5: con coma, los puntos son de miles.
 *
 * Vacío o con letras, NaN.
 */
export function leerNumeroEscrito(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  const t = String(texto ?? "").trim();
  if (t === "") return Number.NaN;
  let normal: string;
  if (t.includes(",")) {
    // Con coma, la coma es el decimal y los puntos, de miles.
    if (t.indexOf(",") !== t.lastIndexOf(",")) return Number.NaN;
    normal = t.replace(/\./g, "").replace(",", ".");
  } else if (SOLO_MILES.test(t)) {
    normal = t.replace(/\./g, "");
  } else {
    normal = t;
  }
  return DECIMAL.test(normal) ? Number(normal) : Number.NaN;
}

/** Un número para enseñarlo en un campo de texto: con coma, sin ceros de más. */
export function escribirNumero(n: number): string {
  return Number.isFinite(n) ? String(n).replace(".", ",") : "";
}
