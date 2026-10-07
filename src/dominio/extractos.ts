/**
 * Extractos del banco: leerlos sin suponer cómo vienen.
 *
 * Cada banco exporta a su manera: CSV con punto y coma o con comas, en UTF-8
 * o en Windows-1252, con la fecha día/mes o mes/día, la coma o el punto como
 * decimal, Excel, o Norma 43 (el formato de texto de la banca española).
 * Aquí se DETECTA cada cosa mirando todo el fichero, no la primera línea, y
 * si algo no se puede saber (todas las fechas tienen el día ≤ 12, todos los
 * importes «1.234»), se dice que es ambiguo para que lo elija una persona.
 *
 * Lo que sale son movimientos (fecha, concepto, importe, saldo) y los saldos
 * del extracto: inicial y final. Si el saldo inicial más los movimientos da
 * el final, el extracto cuadra.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";

export type MovimientoExtracto = {
  /** `yyyy-MM-dd`. */
  fecha: string;
  concepto: string;
  /** Positivo, abono; negativo, cargo. */
  importe: number;
  /** El saldo tras el movimiento, si el banco lo da. */
  saldo: number | null;
};

export type OrdenFecha = "dma" | "mda" | "amd";
export type Decimal = "," | ".";

export type Formato = {
  tipo: "csv" | "excel" | "norma43";
  codificacion?: string;
  separador?: string;
  orden_fecha?: OrdenFecha;
  decimal?: Decimal;
  /** Lo que no se pudo saber mirando el fichero: lo elige una persona. */
  ambiguo: ("orden_fecha" | "decimal")[];
};

export type Extracto = {
  formato: Formato;
  movimientos: MovimientoExtracto[];
  saldo_inicial: number | null;
  saldo_final: number | null;
  desde: string | null;
  hasta: string | null;
  avisos: string[];
};

export type Opciones = { orden_fecha?: OrdenFecha; decimal?: Decimal };

// ---------------------------------------------------------------------------
// Codificación
// ---------------------------------------------------------------------------

/**
 * El texto del fichero y la codificación con que viene. Con marca de orden
 * de bytes (BOM), la que diga; sin ella, UTF-8 si se lee sin errores y, si
 * no, Windows-1252 (lo que exportan los Excel españoles).
 */
export function decodificar(bytes: Uint8Array): { texto: string; codificacion: string } {
  const b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { texto: new TextDecoder("utf-8").decode(b.subarray(3)), codificacion: "UTF-8" };
  }
  if (b[0] === 0xff && b[1] === 0xfe) {
    return { texto: new TextDecoder("utf-16le").decode(b.subarray(2)), codificacion: "UTF-16LE" };
  }
  if (b[0] === 0xfe && b[1] === 0xff) {
    return { texto: new TextDecoder("utf-16be").decode(b.subarray(2)), codificacion: "UTF-16BE" };
  }
  // UTF-16 sin BOM: la mitad de los bytes son ceros.
  const muestra = b.subarray(0, Math.min(b.length, 400));
  let cerosPares = 0;
  let cerosImpares = 0;
  muestra.forEach((x, i) => {
    if (x === 0) {
      if (i % 2 === 0) cerosPares++;
      else cerosImpares++;
    }
  });
  if (cerosImpares > muestra.length / 4) {
    return { texto: new TextDecoder("utf-16le").decode(b), codificacion: "UTF-16LE" };
  }
  if (cerosPares > muestra.length / 4) {
    return { texto: new TextDecoder("utf-16be").decode(b), codificacion: "UTF-16BE" };
  }
  try {
    return { texto: new TextDecoder("utf-8", { fatal: true }).decode(b), codificacion: "UTF-8" };
  } catch {
    return { texto: new TextDecoder("windows-1252").decode(b), codificacion: "Windows-1252" };
  }
}

// ---------------------------------------------------------------------------
// Norma 43 (AEB / CSB 43)
// ---------------------------------------------------------------------------

const lineas = (texto: string) =>
  texto
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");

/** Un fichero Norma 43: registros de 80 posiciones que empiezan por 11, 22, 23, 33 u 88. */
export function esNorma43(texto: string): boolean {
  const ls = lineas(texto);
  return (
    ls.length >= 2 &&
    ls[0].startsWith("11") &&
    ls.every((l) => /^(11|22|23|24|33|88)/.test(l) && l.length >= 70 && l.length <= 82)
  );
}

/** «AAMMDD» → `yyyy-MM-dd`. */
function fechaN43(t: string): string | null {
  if (!/^\d{6}$/.test(t)) return null;
  return fechaValida(2000 + Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6)));
}

/** Importe de 14 dígitos con 2 decimales, con su signo según la clave (1 debe, 2 haber). */
const importeN43 = (digitos: string, clave: string) =>
  (clave === "1" ? -1 : 1) * (Number(digitos) / 100);

/**
 * Lee un fichero Norma 43. Si trae varias cuentas, se queda con la primera y
 * lo avisa (un extracto es de una cuenta).
 */
export function leerNorma43(texto: string): Omit<Extracto, "formato"> {
  const avisos: string[] = [];
  const movimientos: MovimientoExtracto[] = [];
  let saldoInicial: number | null = null;
  let saldoFinal: number | null = null;
  let desde: string | null = null;
  let hasta: string | null = null;
  let cuentas = 0;
  let saldo: number | null = null;

  for (const l of lineas(texto)) {
    const tipo = l.slice(0, 2);
    if (tipo === "11") {
      cuentas++;
      if (cuentas > 1) continue;
      desde = fechaN43(l.slice(20, 26));
      hasta = fechaN43(l.slice(26, 32));
      saldoInicial = redondear(importeN43(l.slice(33, 47), l.slice(32, 33)));
      saldo = saldoInicial;
    } else if (cuentas > 1) {
      continue;
    } else if (tipo === "22") {
      const fecha = fechaN43(l.slice(10, 16));
      const importe = redondear(importeN43(l.slice(28, 42), l.slice(27, 28)));
      const referencia = `${l.slice(52, 64)} ${l.slice(64, 80)}`.replace(/\s+/g, " ").trim();
      if (!fecha) {
        avisos.push(`Un movimiento sin fecha válida (${l.slice(10, 16)}) no se ha leído.`);
        continue;
      }
      saldo = saldo === null ? null : redondear(saldo + importe);
      movimientos.push({ fecha, concepto: referencia, importe, saldo });
    } else if (tipo === "23" && movimientos.length > 0) {
      const extra = `${l.slice(4, 42)} ${l.slice(42, 80)}`.replace(/\s+/g, " ").trim();
      const m = movimientos[movimientos.length - 1];
      m.concepto = [m.concepto, extra].filter(Boolean).join(" · ");
    } else if (tipo === "33") {
      saldoFinal = redondear(importeN43(l.slice(59, 73), l.slice(58, 59)));
    }
  }
  if (cuentas > 1) avisos.push(`El fichero trae ${cuentas} cuentas: se ha leído la primera.`);
  return {
    movimientos,
    saldo_inicial: saldoInicial,
    saldo_final: saldoFinal,
    desde,
    hasta,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// CSV y hojas de cálculo
// ---------------------------------------------------------------------------

const SEPARADORES = [";", ",", "\t", "|"];

/**
 * El separador del CSV: el que aparece el mismo número de veces (y alguna)
 * en más líneas. En España suele ser «;», porque la coma es el decimal, pero
 * no se da por hecho.
 */
export function detectarSeparador(texto: string): string {
  const ls = lineas(texto).slice(0, 50);
  let mejor = ";";
  let puntos = -1;
  for (const sep of SEPARADORES) {
    const cuentas = ls.map((l) => partirLinea(l, sep).length - 1);
    const veces = new Map<number, number>();
    for (const c of cuentas) if (c > 0) veces.set(c, (veces.get(c) ?? 0) + 1);
    const masComun = Math.max(0, ...veces.values());
    if (masComun > puntos) {
      puntos = masComun;
      mejor = sep;
    }
  }
  return mejor;
}

/** Una línea de CSV, respetando las comillas. */
function partirLinea(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c === '"' && linea[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      campos.push(campo);
      campo = "";
    } else campo += c;
  }
  campos.push(campo);
  return campos;
}

export function partirCsv(texto: string, sep: string): string[][] {
  return lineas(texto).map((l) => partirLinea(l, sep));
}

// Cómo llama cada banco a cada cosa. Se compara sin acentos y en minúsculas.
const CABECERAS = {
  fecha: ["fecha", "fecha operacion", "fecha valor", "f operacion", "fecha contable", "date"],
  concepto: ["concepto", "descripcion", "detalle", "observaciones", "referencia", "description"],
  importe: ["importe", "importe eur", "cantidad", "amount"],
  haber: ["haber", "ingreso", "abono", "credito"],
  debe: ["debe", "cargo", "gasto", "adeudo", "debito"],
  saldo: ["saldo", "saldo disponible", "saldo contable", "balance"],
};

function limpiar(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buscarColumna(cabecera: unknown[], nombres: string[]): number {
  const limpias = cabecera.map(limpiar);
  const exacta = limpias.findIndex((c) => nombres.includes(c));
  if (exacta !== -1) return exacta;
  return limpias.findIndex((c) => c && nombres.some((n) => c.startsWith(n)));
}

/** La primera fila (de las 30 primeras) con algo que suene a fecha y algo que suene a importe. */
function localizarCabecera(filas: unknown[][]): number {
  for (let i = 0; i < Math.min(filas.length, 30); i++) {
    const f = filas[i] ?? [];
    const importe = ["importe", "haber", "debe"].some(
      (k) => buscarColumna(f, CABECERAS[k as "importe"]) !== -1,
    );
    if (buscarColumna(f, CABECERAS.fecha) !== -1 && importe) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Fechas y números: se detecta cómo vienen mirando toda la columna
// ---------------------------------------------------------------------------

function fechaValida(año: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(año, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(año).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const partesFecha = (v: string) => v.trim().match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/);

/**
 * El orden de las fechas de una columna. Año delante: año-mes-día. Si algún
 * primer número pasa de 12, es día/mes; si algún segundo, mes/día. Si
 * ninguno pasa de 12, no se puede saber: ambiguo.
 */
export function detectarOrdenFecha(valores: readonly string[]): {
  orden: OrdenFecha;
  ambiguo: boolean;
} {
  let dma = false;
  let mda = false;
  let amd = 0;
  let total = 0;
  for (const v of valores) {
    const p = partesFecha(v);
    if (!p) continue;
    total++;
    if (p[1].length === 4) {
      amd++;
      continue;
    }
    if (Number(p[1]) > 12) dma = true;
    if (Number(p[2]) > 12) mda = true;
  }
  if (total > 0 && amd === total) return { orden: "amd", ambiguo: false };
  if (dma && !mda) return { orden: "dma", ambiguo: false };
  if (mda && !dma) return { orden: "mda", ambiguo: false };
  return { orden: "dma", ambiguo: true };
}

export function aFechaCon(valor: unknown, orden: OrdenFecha): string | null {
  if (valor instanceof Date) {
    return fechaValida(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
  }
  const p = partesFecha(String(valor ?? ""));
  if (!p) return null;
  const n = (s: string) => Number(s);
  const año = (s: string) => (s.length <= 2 ? 2000 + n(s) : n(s));
  if (p[1].length === 4 || orden === "amd") return fechaValida(año(p[1]), n(p[2]), n(p[3]));
  if (orden === "mda") return fechaValida(año(p[3]), n(p[1]), n(p[2]));
  return fechaValida(año(p[3]), n(p[2]), n(p[1]));
}

/**
 * El separador decimal de una columna de importes. Con punto y coma a la vez,
 * el último es el decimal. Con uno solo, si va seguido de 1 o 2 cifras es el
 * decimal, y si se repite, el de miles. «1.234» (tres cifras) no dice nada.
 */
export function detectarDecimal(valores: readonly unknown[]): {
  decimal: Decimal;
  ambiguo: boolean;
} {
  let coma = 0;
  let punto = 0;
  let texto = 0;
  for (const v of valores) {
    if (typeof v !== "string") continue;
    const s = v.replace(/[^\d,.]/g, "");
    if (!/\d/.test(s)) continue;
    texto++;
    const ultimoC = s.lastIndexOf(",");
    const ultimoP = s.lastIndexOf(".");
    if (ultimoC !== -1 && ultimoP !== -1) {
      if (ultimoC > ultimoP) coma++;
      else punto++;
      continue;
    }
    const sep = ultimoC !== -1 ? "," : ultimoP !== -1 ? "." : null;
    if (!sep) continue;
    const veces = s.split(sep).length - 1;
    const cifras = s.length - s.lastIndexOf(sep) - 1;
    if (veces > 1) {
      if (sep === ",") punto++;
      else coma++;
    } else if (cifras === 1 || cifras === 2) {
      if (sep === ",") coma++;
      else punto++;
    }
  }
  if (coma > 0 && punto === 0) return { decimal: ",", ambiguo: false };
  if (punto > 0 && coma === 0) return { decimal: ".", ambiguo: false };
  // Sin texto (todo números de Excel) no hace falta saberlo.
  return { decimal: ",", ambiguo: texto > 0 };
}

export function aNumeroCon(valor: unknown, decimal: Decimal): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const s = String(valor ?? "").trim();
  if (!/\d/.test(s)) return null;
  const negativo = /^-|^\(|-$|\bDR\b/i.test(s) || /^\s*-/.test(s);
  const miles = decimal === "," ? "." : ",";
  const limpio = s
    .replace(/[^\d,.]/g, "")
    .split(miles)
    .join("")
    .replace(decimal, ".");
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/**
 * Las filas de un CSV o de una hoja de cálculo, ya partidas, en movimientos.
 * Lo que no se fuerce en `opciones` se detecta mirando la columna entera.
 */
export function interpretarFilas(
  filas: unknown[][],
  opciones: Opciones = {},
): Pick<Extracto, "movimientos" | "avisos"> & {
  orden_fecha: OrdenFecha;
  decimal: Decimal;
  ambiguo: Formato["ambiguo"];
} {
  const i = localizarCabecera(filas);
  if (i === -1) {
    throw new Error(
      "No se encuentran las columnas del extracto. Hace falta una fila con una columna de fecha y otra de importe (o de debe y haber).",
    );
  }
  const cab = filas[i];
  const col = {
    fecha: buscarColumna(cab, CABECERAS.fecha),
    concepto: buscarColumna(cab, CABECERAS.concepto),
    importe: buscarColumna(cab, CABECERAS.importe),
    haber: buscarColumna(cab, CABECERAS.haber),
    debe: buscarColumna(cab, CABECERAS.debe),
    saldo: buscarColumna(cab, CABECERAS.saldo),
  };
  const cuerpo = filas.slice(i + 1);
  const valores = (c: number) => (c === -1 ? [] : cuerpo.map((f) => f[c]));

  const fechas = detectarOrdenFecha(
    valores(col.fecha).map((v) => (v instanceof Date ? "" : String(v ?? ""))),
  );
  const numeros = detectarDecimal([
    ...valores(col.importe),
    ...valores(col.haber),
    ...valores(col.debe),
    ...valores(col.saldo),
  ]);
  const orden = opciones.orden_fecha ?? fechas.orden;
  const decimal = opciones.decimal ?? numeros.decimal;
  const ambiguo: Formato["ambiguo"] = [];
  if (fechas.ambiguo && !opciones.orden_fecha) ambiguo.push("orden_fecha");
  if (numeros.ambiguo && !opciones.decimal) ambiguo.push("decimal");

  const movimientos: MovimientoExtracto[] = [];
  for (const f of cuerpo) {
    const fecha = aFechaCon(f[col.fecha], orden);
    if (!fecha) continue; // Subtotales, blancos y pies de página.
    let importe = col.importe !== -1 ? aNumeroCon(f[col.importe], decimal) : null;
    if (importe === null || importe === 0) {
      const haber = col.haber !== -1 ? (aNumeroCon(f[col.haber], decimal) ?? 0) : 0;
      const debe = col.debe !== -1 ? (aNumeroCon(f[col.debe], decimal) ?? 0) : 0;
      if (haber || debe) importe = Math.abs(haber) - Math.abs(debe);
    }
    if (importe === null || importe === 0) continue;
    const saldo = col.saldo !== -1 ? aNumeroCon(f[col.saldo], decimal) : null;
    movimientos.push({
      fecha,
      concepto: col.concepto !== -1 ? String(f[col.concepto] ?? "").trim() : "",
      importe: redondear(importe),
      saldo: saldo === null ? null : redondear(saldo),
    });
  }
  return { movimientos, avisos: [], orden_fecha: orden, decimal, ambiguo };
}

// ---------------------------------------------------------------------------
// Saldos del extracto
// ---------------------------------------------------------------------------

/**
 * Los saldos inicial y final a partir del saldo de cada movimiento. Unos
 * bancos ponen el más antiguo arriba y otros abajo: vale el orden en que los
 * saldos encadenan (saldo anterior + importe = saldo). Si no encadenan en
 * ningún orden, no se adivinan.
 */
export function saldosDeMovimientos(movs: readonly MovimientoExtracto[]): {
  saldo_inicial: number | null;
  saldo_final: number | null;
  aviso: string | null;
} {
  if (movs.length === 0 || movs.some((m) => m.saldo === null)) {
    return { saldo_inicial: null, saldo_final: null, aviso: null };
  }
  const encadena = (lista: readonly MovimientoExtracto[]) =>
    lista.every(
      (m, i) =>
        i === 0 ||
        Math.abs(redondear((lista[i - 1].saldo ?? 0) + m.importe) - (m.saldo ?? 0)) < 0.005,
    );
  const enOrden = encadena(movs)
    ? movs
    : encadena([...movs].reverse())
      ? [...movs].reverse()
      : null;
  if (!enOrden) {
    return {
      saldo_inicial: null,
      saldo_final: null,
      aviso: "Los saldos del fichero no encadenan con los importes: pon los saldos a mano.",
    };
  }
  const primero = enOrden[0];
  return {
    saldo_inicial: redondear((primero.saldo ?? 0) - primero.importe),
    saldo_final: enOrden[enOrden.length - 1].saldo,
    aviso: null,
  };
}

/** Lo que suman los movimientos, y si con los saldos cuadra (como lo calcula la base). */
export function cuadreExtracto(
  saldoInicial: number | null,
  saldoFinal: number | null,
  movs: readonly MovimientoExtracto[],
): { suma: number; cuadra: boolean; diferencia: number | null } {
  const suma = redondear(movs.reduce((s, m) => s + m.importe, 0));
  if (saldoInicial === null || saldoFinal === null)
    return { suma, cuadra: false, diferencia: null };
  const diferencia = redondear(saldoFinal - (saldoInicial + suma));
  return { suma, cuadra: diferencia === 0, diferencia };
}

/** Periodo de los movimientos. */
export function periodo(movs: readonly MovimientoExtracto[]): {
  desde: string | null;
  hasta: string | null;
} {
  if (movs.length === 0) return { desde: null, hasta: null };
  const fechas = movs.map((m) => m.fecha).sort();
  return { desde: fechas[0], hasta: fechas[fechas.length - 1] };
}

/** La huella de un movimiento en una cuenta: el mismo extracto importado dos veces no duplica. */
export function huellaMovimiento(cuentaId: string, m: MovimientoExtracto): string {
  return [
    cuentaId,
    m.fecha,
    limpiar(m.concepto),
    m.importe.toFixed(2),
    m.saldo?.toFixed(2) ?? "",
  ].join("|");
}

/**
 * Lee un extracto de texto (CSV o Norma 43). Las hojas de cálculo las parte
 * el servidor y pasan por `extractoDeFilas`.
 */
export function leerExtractoTexto(bytes: Uint8Array, opciones: Opciones = {}): Extracto {
  const { texto, codificacion } = decodificar(bytes);
  if (esNorma43(texto)) {
    const n = leerNorma43(texto);
    return { ...n, formato: { tipo: "norma43", codificacion, ambiguo: [] } };
  }
  const separador = detectarSeparador(texto);
  return extractoDeFilas(
    partirCsv(texto, separador),
    { tipo: "csv", codificacion, separador },
    opciones,
  );
}

export function extractoDeFilas(
  filas: unknown[][],
  formato: Omit<Formato, "ambiguo" | "orden_fecha" | "decimal">,
  opciones: Opciones = {},
): Extracto {
  const r = interpretarFilas(filas, opciones);
  const saldos = saldosDeMovimientos(r.movimientos);
  return {
    formato: { ...formato, orden_fecha: r.orden_fecha, decimal: r.decimal, ambiguo: r.ambiguo },
    movimientos: r.movimientos,
    saldo_inicial: saldos.saldo_inicial,
    saldo_final: saldos.saldo_final,
    ...periodo(r.movimientos),
    avisos: [...r.avisos, ...(saldos.aviso ? [saldos.aviso] : [])],
  };
}

const CLAVE_IBAN = (iban: string) =>
  (iban.slice(4) + iban.slice(0, 4))
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");

/**
 * El IBAN sin espacios y en mayúsculas, si es válido (dígito de control
 * mod 97); si no, nulo.
 */
export function normalizarIban(texto: string): string | null {
  const iban = texto.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return null;
  let resto = 0;
  for (const c of CLAVE_IBAN(iban)) resto = (resto * 10 + Number(c)) % 97;
  return resto === 1 ? iban : null;
}
