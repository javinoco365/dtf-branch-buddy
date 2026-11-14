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

/**
 * Si el texto lleva puntos de miles («1.500», «2.500,50»). Con ellos, «1.500»
 * puede ser mil quinientos o uno y medio mal escrito: quien guarda lo
 * confirma.
 */
export function llevaPuntoDeMiles(texto: string | null | undefined): boolean {
  const t = String(texto ?? "").trim();
  if (SOLO_MILES.test(t)) return true;
  return t.includes(",") && t.includes(".") && Number.isFinite(leerNumeroEscrito(t));
}

const UNIDADES = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];
const DECENAS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];
const CENTENAS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

/** De 1 a 999 en letra. */
function hastaMil(n: number): string {
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 30) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]);
    }
  }
  return partes.join(" ");
}

/** «veintiuno mil» → «veintiún mil», «treinta y uno mil» → «treinta y un mil». */
function apocope(t: string): string {
  return t.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
}

/**
 * Un número entero en letra («mil quinientos», «dos millones»), para que se
 * lea sin dudar qué cifra se ha entendido. Con decimales, negativo o de mil
 * millones en adelante, `null`.
 */
export function numeroEnLetras(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n >= 1e9) return null;
  if (n === 0) return UNIDADES[0];
  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) {
    partes.push(millones === 1 ? "un millón" : `${apocope(hastaMil(millones))} millones`);
  }
  if (miles) partes.push(miles === 1 ? "mil" : `${apocope(hastaMil(miles))} mil`);
  if (resto) partes.push(hastaMil(resto));
  return partes.join(" ");
}
