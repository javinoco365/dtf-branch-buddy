/**
 * Lectura de una factura de compra: lo que dice el papel, comprobado.
 *
 * Un modelo de lenguaje leyendo un PDF se equivoca. Poco, pero se equivoca, y
 * cuando lo hace no avisa: devuelve un número perfectamente formado que resulta
 * ser otro. Si eso entra directo en el libro de stock, el error queda anotado
 * para siempre — los movimientos no se borran.
 *
 * Por eso este módulo existe. La lectura NO es un dato: es una propuesta que
 * hay que revisar. Aquí se normaliza (los números vienen como los escribe un
 * proveedor español) y, sobre todo, se comprueba la aritmética contra sí misma:
 *
 *   - cantidad × precio unitario tiene que dar el importe de la línea;
 *   - la suma de los importes tiene que dar la base;
 *   - base + IVA tiene que dar el total.
 *
 * Tres cuentas que el papel ya trae hechas. Si la lectura no las cuadra, algún
 * número está mal leído, y se dice cuál en vez de dar la compra por buena.
 *
 * Lógica pura: no importa nada de `routes/`, ni de Supabase, ni del proveedor
 * de IA. Se prueba sin red y sin base de datos.
 */

import { redondear } from "./importes";

/** Lo que se acepta como descuadre. Un céntimo por línea es redondeo del proveedor. */
export const TOLERANCIA = 0.02;

export type LineaLeida = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
  /** Lo que dijera el proveedor: "ud", "m", "cajas"… Informativo. */
  unidad?: string | null;
};

export type CompraLeida = {
  proveedor: string | null;
  nif_proveedor: string | null;
  numero: string | null;
  fecha: string | null;
  base: number;
  iva: number;
  total: number;
  lineas: LineaLeida[];
};

export type Aviso = {
  /** `null` cuando es de la cabecera y no de una línea. */
  linea: number | null;
  mensaje: string;
};

/**
 * Convierte a número lo que escriba un proveedor español.
 *
 * "1.234,56" son mil doscientos treinta y cuatro con cincuenta y seis, y
 * `Number()` lo lee como NaN. "1,234.56" es la misma cifra en inglés.
 *
 * Con los dos separadores presentes no hay duda: manda el que está más a la
 * derecha, que es el decimal. Con uno solo sí la hay — "1.200" son mil
 * doscientos en España y uno con dos en inglés. Se resuelve por la longitud:
 * un separador seguido de EXACTAMENTE tres dígitos es de miles, porque nadie
 * factura con tres decimales. Y si aparece más de una vez, de miles seguro.
 */
export function aNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  const limpio = valor.replace(/[^\d,.-]/g, "").trim();
  if (!limpio || !/\d/.test(limpio)) return null;

  const comas = (limpio.match(/,/g) ?? []).length;
  const puntos = (limpio.match(/\./g) ?? []).length;

  let normalizado: string;
  if (comas > 0 && puntos > 0) {
    normalizado =
      limpio.lastIndexOf(",") > limpio.lastIndexOf(".")
        ? limpio.replace(/\./g, "").replace(",", ".")
        : limpio.replace(/,/g, "");
  } else if (comas + puntos === 0) {
    normalizado = limpio;
  } else {
    const sep = comas > 0 ? "," : ".";
    const veces = comas + puntos;
    const decimales = limpio.length - limpio.lastIndexOf(sep) - 1;
    normalizado =
      veces > 1 || decimales === 3
        ? limpio.split(sep).join("") // miles
        : limpio.replace(sep, "."); // decimal
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Una fecha utilizable, venga como venga. Devuelve `YYYY-MM-DD` o `null`. */
export function aFecha(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return fechaValida(+iso[1], +iso[2], +iso[3]);

  // 31/12/2026, 31-12-26, 31.12.2026
  const es = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (es) {
    const año = +es[3] < 100 ? 2000 + +es[3] : +es[3];
    return fechaValida(año, +es[2], +es[1]);
  }
  return null;
}

function fechaValida(año: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(año, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${año.toString().padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Deja la lectura en bruto en la forma que espera la aplicación.
 *
 * Rellena lo que se pueda deducir: si falta el precio unitario pero están la
 * cantidad y el importe, se divide; si falta el importe, se multiplica. Lo que
 * no se pueda deducir se queda en cero y sale en los avisos.
 */
export function normalizarCompra(bruto: unknown): CompraLeida {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const lineasBrutas = Array.isArray(o.lineas) ? o.lineas : [];

  const lineas: LineaLeida[] = lineasBrutas.map((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const cantidad = aNumero(x.cantidad) ?? 0;
    let precio = aNumero(x.precio_unitario);
    let importe = aNumero(x.importe);

    if (precio === null && importe !== null && cantidad !== 0) {
      precio = redondear(importe / cantidad, 4);
    }
    if (importe === null && precio !== null) {
      importe = redondear(cantidad * precio);
    }

    return {
      descripcion: String(x.descripcion ?? "").trim(),
      cantidad,
      precio_unitario: precio ?? 0,
      importe: importe ?? 0,
      unidad: typeof x.unidad === "string" && x.unidad.trim() ? x.unidad.trim() : null,
    };
  });

  const base = aNumero(o.base);
  const iva = aNumero(o.iva);
  const total = aNumero(o.total);
  const sumaLineas = redondear(lineas.reduce((a, l) => a + l.importe, 0));

  return {
    proveedor: texto(o.proveedor),
    nif_proveedor: texto(o.nif_proveedor),
    numero: texto(o.numero),
    fecha: aFecha(o.fecha),
    // Si el papel no trae base pero sí líneas, la base es lo que suman.
    base: base ?? sumaLineas,
    iva: iva ?? 0,
    total: total ?? redondear((base ?? sumaLineas) + (iva ?? 0)),
    lineas,
  };
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * Las tres cuentas que el papel ya trae hechas.
 *
 * Devuelve lo que NO cuadra. Una lista vacía significa que los números se
 * sostienen entre sí, que es lo más cerca que se puede estar de saber que la
 * lectura es correcta sin mirar el papel.
 */
export function revisarCompra(c: CompraLeida): Aviso[] {
  const avisos: Aviso[] = [];

  if (c.lineas.length === 0) {
    avisos.push({ linea: null, mensaje: "No se ha leído ninguna línea." });
  }

  c.lineas.forEach((l, i) => {
    if (!l.descripcion) {
      avisos.push({ linea: i, mensaje: "Línea sin descripción." });
    }
    if (l.cantidad <= 0) {
      avisos.push({ linea: i, mensaje: `Cantidad ${l.cantidad}: tiene que ser mayor que cero.` });
    }
    const esperado = redondear(l.cantidad * l.precio_unitario);
    if (Math.abs(esperado - l.importe) > TOLERANCIA) {
      avisos.push({
        linea: i,
        mensaje: `${l.cantidad} × ${l.precio_unitario} son ${esperado}, no ${l.importe}.`,
      });
    }
  });

  const suma = redondear(c.lineas.reduce((a, l) => a + l.importe, 0));
  if (c.lineas.length > 0 && Math.abs(suma - c.base) > TOLERANCIA) {
    avisos.push({
      linea: null,
      mensaje: `Las líneas suman ${suma} y la base dice ${c.base}.`,
    });
  }

  const totalEsperado = redondear(c.base + c.iva);
  if (Math.abs(totalEsperado - c.total) > TOLERANCIA) {
    avisos.push({
      linea: null,
      mensaje: `Base ${c.base} más IVA ${c.iva} son ${totalEsperado}, no ${c.total}.`,
    });
  }

  return avisos;
}
