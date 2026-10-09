/**
 * Impuestos de la empresa: lo que se paga a Hacienda cada trimestre y lo que
 * queda después del Impuesto sobre Sociedades.
 *
 * Una S.L. no paga IRPF por su beneficio: paga Sociedades. El IRPF que
 * aparece aquí es el que la empresa retiene a otros (casero, profesionales,
 * nóminas) y entrega a Hacienda en su nombre:
 *
 *   - 303, IVA: el repercutido en facturas menos el soportado en compras y
 *     gastos. Positivo, a ingresar; negativo, a compensar en los siguientes
 *     (ver `compensar303`).
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
import {
  comprasAbsorbidas,
  facturasPorCargo,
  sumarMeses,
  type GastoFijo,
  type Periodicidad,
} from "./gerencia";
import { ivaSoportado, resumenIva, type CompraResumen, type DocumentoFiscal } from "./fiscal";

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

/** Lo que lleva cada pago de un gasto: base, IVA, IRPF retenido y lo que se paga. */
export function importesCargo(
  g: Pick<GastoFijo, "importe_mensual" | "iva_pct" | "irpf_pct" | "con_justificante">,
): Pick<Cargo, "base" | "iva" | "irpf" | "aPagar"> {
  const base = num(g.importe_mensual);
  // Sin justificante no hay IVA que recuperar ni retención que ingresar: se
  // paga el importe y ya.
  const conImpuestos = g.con_justificante !== false;
  const iva = conImpuestos ? redondear((base * num(g.iva_pct)) / 100) : 0;
  const irpf = conImpuestos ? redondear((base * num(g.irpf_pct)) / 100) : 0;
  return { base, iva, irpf, aPagar: redondear(base + iva - irpf) };
}

/**
 * Los pagos de los gastos que caen en un rango: el primero el día «desde» y
 * los siguientes cada mes, trimestre o año ese mismo día, mientras el gasto
 * esté vigente. Un cargo con su factura enlazada lleva los importes de la
 * factura.
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
    const importes = importesCargo(g);
    const facturas = facturasPorCargo(g);
    const cargo = (f: Date, k: number): Cargo => {
      const factura = facturas.get(k);
      return {
        gasto_id: g.id,
        concepto: g.concepto,
        tipo: g.tipo ?? "otros",
        fecha: texto(f),
        ...(factura
          ? {
              base: redondear(factura.base),
              iva: redondear(factura.iva),
              irpf: redondear(factura.irpf),
              aPagar: redondear(factura.base + factura.iva - factura.irpf),
            }
          : importes),
      };
    };
    const periodicidad = g.periodicidad ?? "mensual";
    if (periodicidad === "puntual") {
      if (inicio >= desde && inicio <= hasta) cargos.push(cargo(inicio, 0));
      continue;
    }
    const paso = MESES[periodicidad];
    for (let i = 0; ; i += paso) {
      const f = sumarMeses(inicio, i);
      if (f > hasta || (fin && f > fin)) break;
      if (f >= desde) cargos.push(cargo(f, i / paso));
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
  /**
   * Positivo: a pagar. Negativo (303): a compensar en los siguientes. En
   * `impuestosPorTrimestre`, el 303 positivo ya descuenta lo que quedaba
   * pendiente de compensar.
   */
  importe: number;
  plazo: Date;
};

/**
 * Lo que se presenta por un trimestre. El 202 sale en el trimestre en que se
 * paga: el de abril en el segundo, los de octubre y diciembre en el cuarto.
 *
 * El 303 sale tal cual, repercutido − soportado, sin compensar lo de
 * trimestres anteriores: eso lo hace `impuestosPorTrimestre`.
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
  // Sin cuota del último 200 no hay pago fraccionado que presentar.
  const pago = pagoFraccionado(d.cuotaIsAnterior);
  if (pago === 0) return lineas;
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

// ---------------------------------------------------------------------------
// Compensación del 303
// ---------------------------------------------------------------------------

/**
 * Un 303 negativo no se cobra: se descuenta de los siguientes, del mismo año
 * o de los siguientes, mientras no pasen cuatro años desde que se presentó
 * (art. 99.Cinco de la Ley del IVA). Cuatro años son dieciséis trimestres.
 */
export const TRIMESTRES_PARA_COMPENSAR = 16;

/** El 303 de un trimestre con lo que arrastra de los anteriores. */
export type Compensacion303 = {
  /** Repercutido − soportado del trimestre, sin compensar nada. */
  resultado: number;
  /** Lo pendiente de trimestres anteriores que se descuenta en este. */
  compensado: number;
  /** Lo que se ingresa: resultado − compensado. 0 si el resultado no es positivo. */
  aIngresar: number;
  /** Lo que queda por compensar al cerrar el trimestre, con lo de este. */
  pendiente: number;
  /** Cuántos 303 negativos, este incluido, tienen algo pendiente al cerrar. */
  trimestresPendientes: number;
  /** El trimestre del 303 negativo más antiguo del que queda algo; nulo si no queda nada. */
  pendienteDesde: Pick<Trimestre, "anio" | "numero"> | null;
};

const ordinal = (t: Pick<Trimestre, "anio" | "numero">) => t.anio * 4 + t.numero - 1;
const deOrdinal = (n: number): Pick<Trimestre, "anio" | "numero"> => ({
  anio: Math.floor(n / 4),
  numero: ((n % 4) + 1) as Trimestre["numero"],
});

/**
 * Compensa los 303 de unos trimestres, en orden. Lo negativo de un trimestre
 * queda pendiente y se descuenta de lo positivo de los siguientes, primero lo
 * más antiguo. Lo que lleva más de `TRIMESTRES_PARA_COMPENSAR` trimestres
 * pendiente caduca y ya no se descuenta.
 *
 * Solo el 303: el 111, el 115 y el 202 no se compensan con el IVA.
 */
export function compensar303(
  trimestres: readonly { trimestre: Pick<Trimestre, "anio" | "numero">; resultado: number }[],
): Compensacion303[] {
  // Lo pendiente, del más antiguo al más nuevo.
  const pendientes: { origen: number; importe: number }[] = [];
  return trimestres.map(({ trimestre, resultado }) => {
    const n = ordinal(trimestre);
    while (pendientes.length && n - pendientes[0].origen > TRIMESTRES_PARA_COMPENSAR) {
      pendientes.shift();
    }
    const r = redondear(resultado);
    let compensado = 0;
    if (r > 0) {
      let falta = r;
      while (falta > 0 && pendientes.length) {
        const p = pendientes[0];
        const usa = Math.min(p.importe, falta);
        p.importe = redondear(p.importe - usa);
        falta = redondear(falta - usa);
        compensado = redondear(compensado + usa);
        if (p.importe <= 0) pendientes.shift();
      }
    } else if (r < 0) {
      pendientes.push({ origen: n, importe: -r });
    }
    return {
      resultado: r,
      compensado,
      aIngresar: r > 0 ? redondear(r - compensado) : 0,
      pendiente: redondear(pendientes.reduce((s, p) => s + p.importe, 0)),
      trimestresPendientes: pendientes.length,
      pendienteDesde: pendientes.length ? deOrdinal(pendientes[0].origen) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Impuestos por trimestre
// ---------------------------------------------------------------------------

export type ImpuestosTrimestre = {
  trimestre: Trimestre;
  ivaRepercutido: number;
  /** De compras registradas y de gastos. */
  ivaSoportado: number;
  irpf111: number;
  irpf115: number;
  /** Las del calendario, con el 303 ya compensado. */
  lineas: LineaCalendario[];
  /** El 303: su resultado, lo que compensa de antes y lo que queda a compensar. */
  compensacion: Compensacion303;
  /**
   * De antes del trimestre de la primera venta documentada del CRM: no se
   * sabe lo que se vendió, así que su 303 no se calcula (va a 0) ni deja
   * nada a compensar. El 111 y el 115 sí: salen de los gastos.
   */
  sinVentas: boolean;
  /**
   * Lo que hay que pagar en total, con el 303 ya compensado. Un 303 a
   * compensar no resta de los demás modelos.
   */
  aPagar: number;
};

/**
 * Desde cuándo hay que leer documentos y compras para compensar el 303 de un
 * rango: el principio del trimestre que queda `TRIMESTRES_PARA_COMPENSAR`
 * antes del primero del rango. Lo anterior ya habría caducado.
 */
export function inicioCompensacion(r: { desde: Date }): Date {
  const t = trimestreDe(r.desde);
  return new Date(t.anio, (t.numero - 1) * 3 - TRIMESTRES_PARA_COMPENSAR * 3, 1);
}

/** Los trimestres naturales que toca un rango, en orden. */
export function trimestresDelRango(r: { desde: Date; hasta: Date }): Trimestre[] {
  const lista: Trimestre[] = [];
  let t = trimestreDe(r.desde);
  while (t.desde <= r.hasta) {
    lista.push(t);
    t = siguiente(t);
  }
  return lista;
}

const siguiente = (t: Trimestre) =>
  trimestreDe(new Date(t.hasta.getFullYear(), t.hasta.getMonth() + 1, 1));

const enTrimestre = (fecha: string | undefined, t: Trimestre) => {
  if (!fecha) return false;
  const f = dia(fecha);
  return f >= t.desde && f <= t.hasta;
};

/**
 * El primer trimestre con datos enteros: el de `datosDesde` si empieza ese
 * mismo día, o el siguiente (un trimestre a medias no se arrastra: no se
 * sabe lo que falta). Sin `datosDesde`, el primero del rango. Nunca más
 * tarde que el primero del rango.
 */
function primerTrimestreConDatos(rango: { desde: Date }, datosDesde?: Date): Trimestre {
  const primero = trimestreDe(rango.desde);
  if (!datosDesde) return primero;
  let t = trimestreDe(datosDesde);
  if (t.desde < datosDesde) t = siguiente(t);
  return t.desde < primero.desde ? t : primero;
}

/** Desde qué trimestre se compensa el 303 y por qué. */
export type InicioHistorial303 = {
  trimestre: Trimestre;
  /**
   * «primera_venta»: el de la primera venta documentada del CRM; lo de antes
   * no se sabe. «datos»: el primero que se lee (cuatro años antes del
   * periodo); lo de antes ya habría caducado.
   */
  motivo: "primera_venta" | "datos";
};

/**
 * El primer trimestre cuyo 303 cuenta para compensar: el más tardío entre el
 * primero con datos leídos y el de la primera venta documentada del CRM
 * (factura o ticket emitido, de tienda o del textil).
 *
 * Antes de la primera venta el CRM no sabe lo que se vendió: lo soportado de
 * entonces daría unos 303 negativos que nadie presentó así, y compensarlos
 * rebajaría lo que hay que pagar con un saldo inventado.
 *
 * Nulo si el CRM no tiene ninguna venta documentada: no hay 303 que calcular.
 */
export function inicioHistorial303(d: {
  rango: { desde: Date };
  datosDesde?: Date;
  /** `yyyy-MM-dd` del primer documento de venta emitido del CRM; nulo si no hay ninguno. */
  primeraVenta: string | null;
}): InicioHistorial303 | null {
  if (!d.primeraVenta) return null;
  const ventas = trimestreDe(dia(d.primeraVenta));
  const datos = primerTrimestreConDatos(d.rango, d.datosDesde);
  return ventas.desde >= datos.desde
    ? { trimestre: ventas, motivo: "primera_venta" }
    : { trimestre: datos, motivo: "datos" };
}

/**
 * Lo que se presenta por cada trimestre que toca el rango, con todo el
 * trimestre aunque el rango corte a mitad: los modelos son trimestrales.
 *
 * El IVA repercutido de cada trimestre es el de `resumenIva`: los canjes de
 * ticket por factura, cada paso en su fecha, igual que en Gerencia › Fiscal.
 * `referencias` son documentos de fuera de `documentos` que solo hacen falta
 * para casar canjes (el ticket de una factura de canje, la factura de una
 * rectificativa); no cuentan por sí mismos.
 *
 * El 303 se compensa: lo negativo de un trimestre se descuenta de lo
 * positivo de los siguientes (`compensar303`). Para lo que viene de antes
 * del rango hacen falta los documentos y las compras de esos trimestres:
 * `datosDesde` dice desde cuándo están en `documentos` y `compras` (ver
 * `inicioCompensacion`). Se usan los trimestres enteros desde esa fecha. Sin
 * ella, solo se compensa dentro del rango.
 *
 * Y solo desde el trimestre de `primeraVenta` (`inicioHistorial303`): los
 * trimestres de antes salen sin 303 (`sinVentas`) y no dejan nada a
 * compensar.
 *
 * Con `compensar: false` (no se ha podido leer la primera venta, así que no
 * se sabe desde cuándo compensar) no se compensa nada: cada 303 sale tal
 * cual, repercutido − soportado, sin descontar lo de antes ni dejar nada
 * pendiente, y `primeraVenta` no se mira.
 */
export function impuestosPorTrimestre(d: {
  rango: { desde: Date; hasta: Date };
  documentos: readonly DocumentoFiscal[];
  referencias?: readonly DocumentoFiscal[];
  compras: readonly CompraResumen[];
  gastos: readonly GastoFijo[];
  cuotaIsAnterior: number | null | undefined;
  datosDesde?: Date;
  /** `yyyy-MM-dd` del primer documento de venta emitido del CRM; nulo si no hay ninguno. */
  primeraVenta: string | null;
  /** Falso si no se sabe desde cuándo compensar: el 303 sale sin compensar. */
  compensar?: boolean;
}): ImpuestosTrimestre[] {
  const absorbidas = comprasAbsorbidas(d.gastos);
  // Para casar un canje vale cualquier documento conocido, sea del trimestre o no.
  const conocidos = [...d.documentos, ...(d.referencias ?? [])];
  const primero = trimestreDe(d.rango.desde);
  const desde = primerTrimestreConDatos(d.rango, d.datosDesde);
  const todos = trimestresDelRango({ desde: desde.desde, hasta: d.rango.hasta });
  const compensar = d.compensar !== false;
  const inicio = inicioHistorial303(d);
  // Sin saber cuál fue la primera venta, ningún trimestre se da por «sin ventas».
  const sinVentas = (t: Trimestre) => compensar && (!inicio || t.desde < inicio.trimestre.desde);

  const calculados = todos.map((t) => {
    const repercutido = resumenIva(
      d.documentos.filter((x) => enTrimestre(x.fecha, t)),
      conocidos,
    ).repercutido.iva;
    // Las compras que son la factura de un gasto fijo ya van en su cargo.
    const comprasDelTrimestre = d.compras.filter(
      (x) => enTrimestre(x.fecha, t) && !(x.id && absorbidas.has(x.id)),
    );
    const compras = ivaSoportado(comprasDelTrimestre);
    const gastos = impuestosDeCargos(cargosDelRango(d.gastos, t));
    const soportado = redondear(compras.iva + gastos.ivaSoportado);
    // La retención de una factura de compra suelta es de un profesional: 111.
    const irpf111 = redondear(gastos.irpf111 + compras.irpf);
    const lineas = calendarioTrimestre({
      trimestre: t,
      ivaRepercutido: repercutido,
      ivaSoportado: soportado,
      irpf111,
      irpf115: gastos.irpf115,
      cuotaIsAnterior: d.cuotaIsAnterior,
    });
    return {
      trimestre: t,
      ivaRepercutido: repercutido,
      ivaSoportado: soportado,
      irpf111,
      irpf115: gastos.irpf115,
      lineas,
      sinVentas: sinVentas(t),
    };
  });

  // Solo se compensa desde la primera venta: lo de antes no deja nada. Y
  // sin saber desde cuándo, nada.
  const conVentas = compensar ? calculados.filter((c) => !c.sinVentas) : [];
  const compensaciones = new Map(
    compensar303(
      conVentas.map((c) => ({
        trimestre: c.trimestre,
        resultado: redondear(c.ivaRepercutido - c.ivaSoportado),
      })),
    ).map((x, i) => [conVentas[i], x]),
  );
  return calculados
    .map((c): ImpuestosTrimestre => {
      const resultado = redondear(c.ivaRepercutido - c.ivaSoportado);
      // Sin compensar: el 303 tal cual, sin descontar nada ni dejar nada pendiente.
      const compensacion: Compensacion303 = compensaciones.get(c) ?? {
        resultado,
        compensado: 0,
        aIngresar: !c.sinVentas && resultado > 0 ? resultado : 0,
        pendiente: 0,
        trimestresPendientes: 0,
        pendienteDesde: null,
      };
      // Solo el 303 se compensa; lo negativo sigue saliendo «a compensar».
      // Sin ventas en el CRM, el 303 no se calcula: 0.
      const importe303 = c.sinVentas
        ? 0
        : compensacion.resultado < 0
          ? compensacion.resultado
          : compensacion.aIngresar;
      const lineas = c.lineas.map((l) => (l.modelo === "303" ? { ...l, importe: importe303 } : l));
      return {
        ...c,
        lineas,
        compensacion,
        aPagar: redondear(lineas.reduce((s, l) => s + Math.max(0, l.importe), 0)),
      };
    })
    .filter((t) => t.trimestre.desde >= primero.desde);
}
