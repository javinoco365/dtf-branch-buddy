/**
 * Impuestos de la empresa: lo que se paga a Hacienda cada trimestre y lo que
 * queda después del Impuesto sobre Sociedades.
 *
 * Una S.L. no paga IRPF por su beneficio: paga Sociedades. El IRPF que
 * aparece aquí es el que la empresa retiene a otros (casero, profesionales,
 * nóminas) y entrega a Hacienda en su nombre:
 *
 *   - 303, IVA: el repercutido en facturas menos el soportado en compras y
 *     gastos. Positivo, a ingresar; negativo, a compensar.
 *   - 111, retenciones de profesionales y nóminas.
 *   - 115, retenciones del alquiler del local.
 *   - 202, pagos fraccionados de Sociedades: 18 % de la cuota del último
 *     modelo 200, en abril, octubre y diciembre. Sin 200 presentado, nada.
 *
 * El IVA y el IRPF de un gasto no son coste: el IVA se recupera y el IRPF se
 * le descuenta al proveedor para dárselo a Hacienda. El coste es la base.
 *
 * Es una estimación para saber por dónde va el trimestre con lo que hay en el
 * CRM. Las declaraciones las presenta la gestoría.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import type { GastoFijo, Periodicidad } from "./gerencia";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type ModeloRetencion = "111" | "115";

export type TipoGasto = {
  valor: string;
  etiqueta: string;
  /** El modelo al que va el IRPF que se retenga; nulo si no lleva. */
  modelo: ModeloRetencion | null;
  /** Lo habitual, para rellenar el formulario. Se puede cambiar. */
  iva: number;
  irpf: number;
};

export const TIPOS_GASTO: readonly TipoGasto[] = [
  { valor: "alquiler", etiqueta: "Alquiler del local", modelo: "115", iva: 21, irpf: 19 },
  {
    valor: "profesional",
    etiqueta: "Profesional (gestoría, abogado…)",
    modelo: "111",
    iva: 21,
    irpf: 15,
  },
  { valor: "nomina", etiqueta: "Nómina (sueldo bruto)", modelo: "111", iva: 0, irpf: 0 },
  {
    valor: "seguridad_social",
    etiqueta: "Seguridad Social de la empresa",
    modelo: null,
    iva: 0,
    irpf: 0,
  },
  { valor: "autonomo", etiqueta: "Cuota de autónomos", modelo: null, iva: 0, irpf: 0 },
  {
    valor: "suministro",
    etiqueta: "Suministros (luz, agua, internet)",
    modelo: null,
    iva: 21,
    irpf: 0,
  },
  { valor: "seguro", etiqueta: "Seguros", modelo: null, iva: 0, irpf: 0 },
  {
    valor: "financiero",
    etiqueta: "Préstamos y comisiones bancarias",
    modelo: null,
    iva: 0,
    irpf: 0,
  },
  { valor: "software", etiqueta: "Software y servicios", modelo: null, iva: 21, irpf: 0 },
  { valor: "otros", etiqueta: "Otros", modelo: null, iva: 21, irpf: 0 },
];

export function tipoGasto(valor: string | null | undefined): TipoGasto {
  return TIPOS_GASTO.find((t) => t.valor === valor) ?? TIPOS_GASTO[TIPOS_GASTO.length - 1];
}

export const PERIODICIDADES: readonly { valor: Periodicidad; etiqueta: string }[] = [
  { valor: "mensual", etiqueta: "Mensual" },
  { valor: "trimestral", etiqueta: "Trimestral" },
  { valor: "anual", etiqueta: "Anual" },
  { valor: "puntual", etiqueta: "Una vez" },
];

// ---------------------------------------------------------------------------
// Cargos: cuándo se paga cada gasto
// ---------------------------------------------------------------------------

/** Un pago concreto de un gasto. */
export type Cargo = {
  gasto_id: string;
  concepto: string;
  tipo: string;
  /** `yyyy-MM-dd`. */
  fecha: string;
  base: number;
  iva: number;
  irpf: number;
  /** Lo que sale del banco hacia el proveedor: base + IVA − IRPF. */
  aPagar: number;
};

const MESES: Record<Exclude<Periodicidad, "puntual">, number> = {
  mensual: 1,
  trimestral: 3,
  anual: 12,
};

function dia(texto: string): Date {
  const [a, m, d] = texto.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
}

function texto(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** El mismo día del mes `n` meses después, o el último del mes si no existe (31 → 30). */
function sumarMeses(base: Date, n: number): Date {
  const ultimo = new Date(base.getFullYear(), base.getMonth() + n + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth() + n, Math.min(base.getDate(), ultimo));
}

/**
 * Los pagos de los gastos que caen en un rango: el primero el día «desde» y
 * los siguientes cada mes, trimestre o año ese mismo día, mientras el gasto
 * esté vigente.
 */
export function cargosDelRango(
  gastos: readonly GastoFijo[],
  r: { desde: Date; hasta: Date },
): Cargo[] {
  const desde = new Date(r.desde.getFullYear(), r.desde.getMonth(), r.desde.getDate());
  const hasta = new Date(r.hasta.getFullYear(), r.hasta.getMonth(), r.hasta.getDate());
  const cargos: Cargo[] = [];
  for (const g of gastos) {
    const inicio = dia(g.desde);
    const fin = g.hasta ? dia(g.hasta) : null;
    const base = num(g.importe_mensual);
    const iva = redondear((base * num(g.iva_pct)) / 100);
    const irpf = redondear((base * num(g.irpf_pct)) / 100);
    const cargo = (f: Date): Cargo => ({
      gasto_id: g.id,
      concepto: g.concepto,
      tipo: g.tipo ?? "otros",
      fecha: texto(f),
      base,
      iva,
      irpf,
      aPagar: redondear(base + iva - irpf),
    });
    const periodicidad = g.periodicidad ?? "mensual";
    if (periodicidad === "puntual") {
      if (inicio >= desde && inicio <= hasta) cargos.push(cargo(inicio));
      continue;
    }
    const paso = MESES[periodicidad];
    for (let i = 0; ; i += paso) {
      const f = sumarMeses(inicio, i);
      if (f > hasta || (fin && f > fin)) break;
      if (f >= desde) cargos.push(cargo(f));
    }
  }
  return cargos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export type ImpuestosGastos = {
  base: number;
  ivaSoportado: number;
  /** IRPF retenido que va al 111 (profesionales y nóminas). */
  irpf111: number;
  /** IRPF retenido que va al 115 (alquiler). */
  irpf115: number;
  /** Lo que se paga a los proveedores. */
  aPagar: number;
};

/** Lo que suman los cargos, separado por impuesto. */
export function impuestosDeCargos(cargos: readonly Cargo[]): ImpuestosGastos {
  const r = { base: 0, ivaSoportado: 0, irpf111: 0, irpf115: 0, aPagar: 0 };
  for (const c of cargos) {
    r.base += c.base;
    r.ivaSoportado += c.iva;
    r.aPagar += c.aPagar;
    const modelo = tipoGasto(c.tipo).modelo;
    // Un IRPF en un gasto que no suele llevarlo (un «otros» con retención)
    // se trata como el de un profesional: 111.
    if (modelo === "115") r.irpf115 += c.irpf;
    else r.irpf111 += c.irpf;
  }
  return {
    base: redondear(r.base),
    ivaSoportado: redondear(r.ivaSoportado),
    irpf111: redondear(r.irpf111),
    irpf115: redondear(r.irpf115),
    aPagar: redondear(r.aPagar),
  };
}

// ---------------------------------------------------------------------------
// Trimestres y calendario
// ---------------------------------------------------------------------------

export type Trimestre = { anio: number; numero: 1 | 2 | 3 | 4; desde: Date; hasta: Date };

/** El trimestre natural de una fecha. */
export function trimestreDe(f: Date): Trimestre {
  const numero = (Math.floor(f.getMonth() / 3) + 1) as Trimestre["numero"];
  const mes = (numero - 1) * 3;
  return {
    anio: f.getFullYear(),
    numero,
    desde: new Date(f.getFullYear(), mes, 1),
    hasta: new Date(f.getFullYear(), mes + 3, 0, 23, 59, 59, 999),
  };
}

/**
 * Hasta cuándo se presenta lo de un trimestre: el 20 del mes siguiente; el
 * cuarto, el 30 de enero (el 303) o el 20 de enero (111 y 115).
 */
export function plazoTrimestre(t: Trimestre, modelo: "303" | ModeloRetencion): Date {
  if (t.numero === 4) return new Date(t.anio + 1, 0, modelo === "303" ? 30 : 20);
  return new Date(t.anio, t.numero * 3, 20);
}

/** Los pagos fraccionados de Sociedades (202): 1–20 de abril, octubre y diciembre. */
export const PLAZOS_202 = [
  { mes: 3, etiqueta: "1.er pago" },
  { mes: 9, etiqueta: "2.º pago" },
  { mes: 11, etiqueta: "3.er pago" },
] as const;

/** Lo que toca de pago fraccionado: 18 % de la cuota del último 200. */
export function pagoFraccionado(cuotaAnterior: number | null | undefined): number {
  return cuotaAnterior && cuotaAnterior > 0 ? redondear(cuotaAnterior * 0.18) : 0;
}

export type LineaCalendario = {
  modelo: "303" | "111" | "115" | "202";
  concepto: string;
  /** Positivo: a pagar. Negativo (303): a compensar en el siguiente. */
  importe: number;
  plazo: Date;
};

/**
 * Lo que se presenta por un trimestre. El 202 sale en el trimestre en que se
 * paga: el de abril en el segundo, los de octubre y diciembre en el cuarto.
 */
export function calendarioTrimestre(d: {
  trimestre: Trimestre;
  ivaRepercutido: number;
  ivaSoportado: number;
  irpf111: number;
  irpf115: number;
  cuotaIsAnterior: number | null | undefined;
}): LineaCalendario[] {
  const t = d.trimestre;
  const lineas: LineaCalendario[] = [
    {
      modelo: "303",
      concepto: "IVA: repercutido − soportado",
      importe: redondear(d.ivaRepercutido - d.ivaSoportado),
      plazo: plazoTrimestre(t, "303"),
    },
    {
      modelo: "111",
      concepto: "Retenciones de profesionales y nóminas",
      importe: d.irpf111,
      plazo: plazoTrimestre(t, "111"),
    },
    {
      modelo: "115",
      concepto: "Retenciones del alquiler",
      importe: d.irpf115,
      plazo: plazoTrimestre(t, "115"),
    },
  ];
  const pago = pagoFraccionado(d.cuotaIsAnterior);
  for (const p of PLAZOS_202) {
    const plazo = new Date(t.anio, p.mes, 20);
    if (plazo >= t.desde && plazo <= t.hasta) {
      lineas.push({
        modelo: "202",
        concepto: `Sociedades, ${p.etiqueta} fraccionado`,
        importe: pago,
        plazo,
      });
    }
  }
  return lineas;
}

// ---------------------------------------------------------------------------
// Cuenta de resultados
// ---------------------------------------------------------------------------

export type CuentaResultados = {
  /** Ventas sin IVA. */
  ingresos: number;
  /** Producción, envíos y coste de la ropa. */
  costesVariables: number;
  margen: number;
  /** Gastos de estructura que le tocan al periodo, sin IVA. */
  costesFijos: number;
  /** Beneficio antes de impuestos. */
  bai: number;
  /** Sociedades estimado: tipo × beneficio, solo si hay beneficio. */
  impuestoSociedades: number;
  beneficioNeto: number;
};

/**
 * De las ventas al beneficio neto. El Sociedades es una estimación sobre el
 * beneficio del periodo: el de verdad se calcula sobre el año entero, con
 * los ajustes que haga la gestoría.
 */
export function cuentaResultados(d: {
  ingresos: number;
  costesVariables: number;
  costesFijos: number;
  tipoIs: number;
}): CuentaResultados {
  const margen = redondear(d.ingresos - d.costesVariables);
  const bai = redondear(margen - d.costesFijos);
  const impuestoSociedades = bai > 0 ? redondear((bai * d.tipoIs) / 100) : 0;
  return {
    ingresos: redondear(d.ingresos),
    costesVariables: redondear(d.costesVariables),
    margen,
    costesFijos: redondear(d.costesFijos),
    bai,
    impuestoSociedades,
    beneficioNeto: redondear(bai - impuestoSociedades),
  };
}
