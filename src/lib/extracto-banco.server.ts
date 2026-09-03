/**
 * Lee el extracto que descarga el banco.
 *
 * Solo servidor: `read-excel-file` es una dependencia pesada que no tiene por
 * qué viajar al navegador. Se importa dinámicamente dentro del handler.
 *
 * Cada banco maqueta su Excel a su manera —cabeceras en la fila 1, en la 8,
 * columnas con nombres distintos, importes en una columna o en dos (debe y
 * haber)—, así que aquí no se asume una plantilla: se buscan las columnas por
 * lo que dice su cabecera y, si no aparece, se dice cuál falta en vez de
 * importar basura.
 *
 * Lo que sale de aquí son movimientos, no cobros. Casarlos con las facturas es
 * cosa de `src/dominio/conciliacion.ts`.
 */

import { aFecha, aNumero } from "@/dominio/factura-compra";

export type FilaExtracto = {
  fecha: string;
  concepto: string;
  importe: number;
  /** Para no importar dos veces la misma fila del mismo extracto. */
  huella: string;
};

const MAXIMO_BYTES = 5 * 1024 * 1024;

// Cómo llama cada banco a cada cosa. Se compara sin acentos y en minúsculas.
const CABECERAS = {
  fecha: ["fecha", "fecha operacion", "fecha valor", "f operacion", "fecha contable", "date"],
  concepto: ["concepto", "descripcion", "detalle", "observaciones", "referencia", "description"],
  importe: ["importe", "importe eur", "cantidad", "amount"],
  haber: ["haber", "ingreso", "abono", "credito"],
  debe: ["debe", "cargo", "gasto", "adeudo", "debito"],
};

function limpiar(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buscarColumna(cabecera: unknown[], nombres: string[]): number {
  const limpias = cabecera.map(limpiar);
  // Primero coincidencia exacta; después, que empiece igual. En ese orden,
  // porque «fecha» exacta debe ganar a «fecha valor» si están las dos.
  const exacta = limpias.findIndex((c) => nombres.includes(c));
  if (exacta !== -1) return exacta;
  return limpias.findIndex((c) => c && nombres.some((n) => c.startsWith(n)));
}

/**
 * Encuentra la fila de cabeceras.
 *
 * Los bancos meten arriba el logotipo, el titular, el IBAN y el periodo. La
 * cabecera de verdad es la primera fila donde aparecen a la vez algo que suene
 * a fecha y algo que suene a importe.
 */
function localizarCabecera(filas: unknown[][]): number {
  const limite = Math.min(filas.length, 30);
  for (let i = 0; i < limite; i++) {
    const fila = filas[i] ?? [];
    const tieneFecha = buscarColumna(fila, CABECERAS.fecha) !== -1;
    const tieneImporte =
      buscarColumna(fila, CABECERAS.importe) !== -1 ||
      buscarColumna(fila, CABECERAS.haber) !== -1 ||
      buscarColumna(fila, CABECERAS.debe) !== -1;
    if (tieneFecha && tieneImporte) return i;
  }
  return -1;
}

export async function leerExtracto(
  bytes: Uint8Array,
  nombreFichero: string,
): Promise<FilaExtracto[]> {
  if (bytes.byteLength > MAXIMO_BYTES) {
    throw new Error("El fichero pesa más de 5 MB. Exporta un periodo más corto.");
  }

  const filas = nombreFichero.toLowerCase().endsWith(".csv")
    ? leerCsv(new TextDecoder("utf-8").decode(bytes))
    : await leerXlsx(bytes);

  const iCabecera = localizarCabecera(filas);
  if (iCabecera === -1) {
    throw new Error(
      "No se encuentran las columnas del extracto. Hace falta una fila con una " +
        "columna de fecha y otra de importe (o de debe y haber).",
    );
  }

  const cabecera = filas[iCabecera];
  const cFecha = buscarColumna(cabecera, CABECERAS.fecha);
  const cConcepto = buscarColumna(cabecera, CABECERAS.concepto);
  const cImporte = buscarColumna(cabecera, CABECERAS.importe);
  const cHaber = buscarColumna(cabecera, CABECERAS.haber);
  const cDebe = buscarColumna(cabecera, CABECERAS.debe);

  const movimientos: FilaExtracto[] = [];
  for (const fila of filas.slice(iCabecera + 1)) {
    const fecha = aFecha(textoDeCelda(fila[cFecha]));
    if (!fecha) continue; // Filas de subtotales, blancos y pies de página.

    // Con debe y haber en columnas separadas, el ingreso suma y el cargo resta.
    let importe: number | null = null;
    if (cImporte !== -1) {
      importe = aNumero(textoDeCelda(fila[cImporte]));
    }
    if (importe === null || importe === 0) {
      const haber = cHaber !== -1 ? (aNumero(textoDeCelda(fila[cHaber])) ?? 0) : 0;
      const debe = cDebe !== -1 ? (aNumero(textoDeCelda(fila[cDebe])) ?? 0) : 0;
      if (haber || debe) importe = haber - Math.abs(debe);
    }
    if (importe === null || importe === 0) continue;

    const concepto = cConcepto !== -1 ? textoDeCelda(fila[cConcepto]).trim() : "";
    movimientos.push({
      fecha,
      concepto,
      importe,
      huella: `${fecha}|${limpiar(concepto)}|${importe.toFixed(2)}`,
    });
  }

  if (movimientos.length === 0) {
    throw new Error("El fichero no trae ningún movimiento con fecha e importe.");
  }
  return movimientos;
}

/** Las celdas de fecha de un xlsx llegan como Date; el resto, como texto. */
function textoDeCelda(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "");
}

async function leerXlsx(bytes: Uint8Array): Promise<unknown[][]> {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const buffer = Buffer.from(bytes);
  // Sin esquema: se lee tal cual y las columnas se buscan por su cabecera.
  return (await readXlsxFile(buffer)) as unknown as unknown[][];
}

/**
 * CSV con comillas, por si el banco lo da así.
 *
 * El separador se decide por cuál abunda más en la primera línea: en España
 * los bancos usan punto y coma, porque la coma es el separador decimal.
 */
function leerCsv(texto: string): unknown[][] {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primera.match(/;/g) ?? []).length >= (primera.match(/,/g) ?? []).length ? ";" : ",";

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else entreComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') entreComillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo.replace(/\r$/, ""));
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo || fila.length) {
    fila.push(campo.replace(/\r$/, ""));
    filas.push(fila);
  }
  return filas;
}
