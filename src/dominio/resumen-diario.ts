/**
 * El Resumen de Gerencia: cómo ha ido un día (o una semana, un mes…), por
 * tienda y textil, para los socios.
 *
 * Dos miradas, separadas a propósito:
 *
 * - **Lo pedido**: los pedidos con fecha en el periodo. Es lo que se vendió.
 * - **Lo realizado**: los pedidos que se realizaron (pasaron a enviado) en el
 *   periodo, fueran del día que fueran. Un pedido que entra después del corte
 *   se hace al día siguiente: los metros tirados cada día salen de aquí.
 *
 * Los márgenes van en las dos miradas y siempre en dos versiones:
 *
 * - **Sin envíos**: facturación bruta (sin IVA y sin el envío cobrado) menos
 *   el coste de producción (metros × coste por metro congelado en el pedido;
 *   en textil, la ropa que salió del almacén).
 * - **Con envíos**: lo anterior, más el envío cobrado al cliente, menos lo que
 *   cobra de verdad la agencia (`coste_envio_real`, o el coste por defecto de
 *   Gerencia si el pedido lleva envío y no lo tiene: entonces es estimado).
 *
 * La diferencia entre los dos es lo que se gana o se pierde con los envíos.
 *
 * Lógica pura: no consulta nada y se prueba sin base de datos. Las cifras de
 * ventas salen de las mismas funciones que el resto de Gerencia
 * (`calcularKpis`, `costeProduccion`), así que cuadran con ella.
 */

import { redondear } from "./importes";
import {
  ESTADO_CANCELADO,
  calcularKpis,
  costeProduccion,
  parteVendida,
  totalNeto,
  type PedidoResumen,
} from "./kpis";
import { diaDelPedido, momentoDelPedido } from "./dia-pedido";
import { diaRealizado, fueraDeHora, horaCorta, momentoDeInstante } from "./realizado";
import type { Venta } from "./gerencia";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

/** Los estados en que un pedido todavía no está hecho. */
const ABIERTOS = new Set(["pendiente", "en_produccion", "imprimiendo", "listo"]);

/** Un pedido de tienda o textil con lo que necesita el Resumen. */
export type PedidoParaResumen = Venta & {
  id: string;
  /** La tienda, o el id del textil (TIENDA_TEXTIL.id). */
  negocio: string;
  realizado_en: string | null;
  /** Lo que cobró la agencia, sin IVA; vacío si no se apuntó. */
  coste_envio_real: Numerico;
  /** Si el pedido lleva envío: se cobró envío o tiene número de seguimiento. */
  con_envio: boolean;
  /** Todo lo cobrado de este pedido, con IVA y sin propinas, sea cuando sea. */
  cobrado: number;
};

/** Un cobro del periodo: su día y lo cobrado, con IVA y sin propina. */
export type CobroParaResumen = { negocio: string; fecha: string; importe: Numerico };

/** Un ticket o una factura vigente del periodo: su día y su base imponible. */
export type DocumentoParaResumen = { negocio: string; fecha: string; base: Numerico };

export type AjustesResumen = {
  /** 'hh:mm': lo que entra a esta hora o después se hace al día siguiente. */
  horaCorte: string;
  /** Metros que tira la máquina en una hora. */
  metrosHora: number;
  /** 'hh:mm' de inicio y fin de la jornada de impresión. */
  jornadaInicio: string;
  jornadaFin: string;
  /** Lo que se estima que cobra la agencia por envío, sin IVA. */
  costeEnvioDefecto: number;
  /** Coste por metro de hoy, para los pedidos sin coste congelado. */
  costeMetroActual: number;
};

export type EntradaResumen = {
  /** El periodo, 'yyyy-mm-dd', los dos incluidos. */
  desde: string;
  hasta: string;
  /** Hoy, 'yyyy-mm-dd': lo que aún no ha pasado no cuenta para la capacidad. */
  hoy: string;
  /** Los negocios en el orden en que se enseñan: las tiendas y el textil. */
  negocios: readonly { id: string; nombre: string }[];
  /**
   * Los pedidos que hacen falta: los pedidos en el periodo, los realizados en
   * el periodo y los que seguían en cola al acabarlo. Puede llevar de más: se
   * filtra aquí.
   */
  pedidos: readonly PedidoParaResumen[];
  cobros: readonly CobroParaResumen[];
  documentos: readonly DocumentoParaResumen[];
  ajustes: AjustesResumen;
  /** Los gastos fijos del periodo, prorrateados (gastosFijosDelRango). Nulo: no se sabe. */
  gastosFijos: number | null;
  /** El objetivo del periodo (objetivoDelRango). */
  objetivo: { metros: number | null; vendido: number | null };
};

/** Los márgenes de un grupo de pedidos. */
export type Margenes = {
  pedidos: number;
  metros: number;
  /** Total con IVA y envío, después de devoluciones. */
  vendido: number;
  /** Sin IVA, con el envío. */
  base: number;
  /** Sin IVA y sin el envío. */
  bruta: number;
  enviosCobrados: number;
  costeProduccion: number;
  costeEnvios: number;
  /** Pedidos con envío cuyo coste se ha estimado (no tenían coste real). */
  enviosEstimados: number;
  margenSinEnvios: number;
  margenConEnvios: number;
  /** Envíos cobrados − coste de los envíos: lo que se gana (o pierde) con ellos. */
  resultadoEnvios: number;
};

export type CifrasNegocio = {
  id: string;
  nombre: string;
  /** Lo pedido en el periodo. */
  pedido: Margenes & {
    cancelados: number;
    /** Pedidos que entraron a la hora de corte o después. */
    fueraDeHora: number;
    ticket: number;
    /** Bruta por metro (lo que se cobra por imprimir un metro). */
    euroMetro: number | null;
    /** Margen sin envíos por metro. */
    margenMetro: number | null;
    /** De lo pedido en el periodo, lo que queda por cobrar. */
    pendiente: number;
  };
  /** Lo realizado en el periodo, fuera del día que fuera su pedido. */
  realizado: Margenes & {
    /** Metros impresos, también de los pedidos cancelados después: lo impreso, impreso está. */
    metrosImpresos: number;
    /** Horas de media desde que entra el pedido hasta que se realiza; nulo si no se sabe. */
    horasMedias: number | null;
    /** Realizados que aún deben dinero. */
    sinCobrar: number;
    importeSinCobrar: number;
  };
  /** Base imponible de los tickets y facturas del periodo. */
  facturado: number;
  /** Cobrado en el periodo (con IVA, sin propinas), sea del pedido que sea. */
  cobrado: number;
  /** Lo que quedaba por hacer al acabar el periodo. */
  cola: { pedidos: number; metros: number };
  /** Enviados o entregados sin fecha de realizado (anteriores a guardarla). */
  sinFecha: number;
};

export type Capacidad = {
  /** Días laborables (lunes a viernes) del periodo, hasta hoy. */
  dias: number;
  horasDia: number;
  /** metrosHora × horasDia × dias. */
  metros: number;
  /** Metros impresos ÷ capacidad, de 0 a 1 (o más); nulo sin días. */
  uso: number | null;
};

export type DiaResumen = {
  dia: string;
  pedidos: number;
  metrosPedidos: number;
  metrosImpresos: number;
  vendido: number;
  cobrado: number;
  margenConEnvios: number;
};

/** Un aviso con sus datos; el texto lo pone la pantalla (con format.ts). */
export type AvisoResumen = {
  nivel: "alto" | "medio" | "info";
  tipo:
    | "margen_negativo"
    | "maquina_llena"
    | "cola_larga"
    | "realizados_sin_cobrar"
    | "envios_en_perdida"
    | "fuera_de_hora"
    | "maquina_con_sitio"
    | "envios_estimados"
    | "sin_fecha_realizado";
  cantidad?: number;
  importe?: number;
  metros?: number;
  capacidadDia?: number;
  /** De 0 a 1. */
  porcentaje?: number;
  hora?: string;
};

export type Resumen = {
  desde: string;
  hasta: string;
  negocios: CifrasNegocio[];
  total: CifrasNegocio;
  capacidad: Capacidad;
  gastosFijos: number | null;
  /** Margen con envíos (de lo pedido) − gastos fijos. Nulo sin gastos fijos. */
  beneficio: number | null;
  objetivo: {
    metros: number | null;
    vendido: number | null;
    /** Metros impresos ÷ objetivo de metros; nulo sin objetivo. */
    avanceMetros: number | null;
    avanceVendido: number | null;
  };
  /** Un día por fila, solo si el periodo tiene más de uno. */
  porDia: DiaResumen[];
  avisos: AvisoResumen[];
};

// ---------------------------------------------------------------------------

const enRango = (dia: string | null, desde: string, hasta: string) =>
  dia != null && dia >= desde && dia <= hasta;

/** Lo que cobra la agencia por un pedido y si es estimado. */
function costeEnvio(p: PedidoParaResumen, defecto: number): { coste: number; estimado: boolean } {
  const real = p.coste_envio_real;
  if (real != null && real !== "") return { coste: num(real), estimado: false };
  return p.con_envio ? { coste: defecto, estimado: true } : { coste: 0, estimado: false };
}

/** Los márgenes de unos pedidos (los cancelados no cuentan). */
export function margenes(
  pedidos: readonly PedidoParaResumen[],
  ajustes: Pick<AjustesResumen, "costeEnvioDefecto" | "costeMetroActual">,
): Margenes {
  const validos = pedidos.filter((p) => p.estado !== ESTADO_CANCELADO);
  const k = calcularKpis(validos as readonly PedidoResumen[]);
  const dtf = validos.filter((p) => p.canal !== "textil");
  const textil = validos.filter((p) => p.canal === "textil");
  const prod = redondear(
    costeProduccion(dtf as readonly PedidoResumen[], ajustes.costeMetroActual) +
      textil.reduce((s, p) => s + num(p.coste_textil), 0),
  );
  let costeEnvios = 0;
  let enviosEstimados = 0;
  for (const p of validos) {
    const e = costeEnvio(p, ajustes.costeEnvioDefecto);
    costeEnvios += e.coste;
    if (e.estimado) enviosEstimados++;
  }
  costeEnvios = redondear(costeEnvios);
  const margenSinEnvios = redondear(k.bruta - prod);
  const resultadoEnvios = redondear(k.envios - costeEnvios);
  return {
    pedidos: k.pedidos,
    metros: k.metros,
    vendido: redondear(k.total),
    base: k.base,
    bruta: k.bruta,
    enviosCobrados: k.envios,
    costeProduccion: prod,
    costeEnvios,
    enviosEstimados,
    margenSinEnvios,
    margenConEnvios: redondear(margenSinEnvios + resultadoEnvios),
    resultadoEnvios,
  };
}

/** Horas entre dos horas del reloj de España ('yyyy-mm-ddThh:mm:ss'). */
function horasEntre(desde: string, hasta: string): number | null {
  const a = Date.parse(`${desde}Z`);
  const b = Date.parse(`${hasta}Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / 3_600_000;
}

/** Los días 'yyyy-mm-dd' de `desde` a `hasta`, los dos incluidos. */
export function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= fin; t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

const esLaborable = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
};

/** Horas de la jornada ('09:00'–'13:00' → 4). */
export function horasJornada(inicio: string, fin: string): number {
  const min = (h: string) => {
    const [hh, mm] = horaCorta(h, "00:00").split(":").map(Number);
    return hh * 60 + mm;
  };
  return Math.max(0, (min(fin) - min(inicio)) / 60);
}

/** La capacidad de la máquina en el periodo: lunes a viernes, hasta hoy. */
export function capacidad(
  desde: string,
  hasta: string,
  hoy: string,
  ajustes: Pick<AjustesResumen, "metrosHora" | "jornadaInicio" | "jornadaFin">,
  metrosImpresos: number,
): Capacidad {
  const fin = hasta < hoy ? hasta : hoy;
  const dias = fin < desde ? 0 : diasEntre(desde, fin).filter(esLaborable).length;
  const horasDia = horasJornada(ajustes.jornadaInicio, ajustes.jornadaFin);
  const metros = redondear(ajustes.metrosHora * horasDia * dias, 2);
  return {
    dias,
    horasDia,
    metros,
    uso: metros > 0 ? redondear(metrosImpresos / metros, 4) : null,
  };
}

function cifrasDe(
  id: string,
  nombre: string,
  e: EntradaResumen,
  pedidos: readonly PedidoParaResumen[],
): CifrasNegocio {
  const { desde, hasta, ajustes } = e;
  const delPeriodo = pedidos.filter((p) => enRango(diaDelPedido(p), desde, hasta));
  const realizados = pedidos.filter((p) => enRango(diaRealizado(p.realizado_en), desde, hasta));

  const mp = margenes(delPeriodo, ajustes);
  const validosPeriodo = delPeriodo.filter((p) => p.estado !== ESTADO_CANCELADO);
  const pendiente = redondear(
    validosPeriodo.reduce((s, p) => s + Math.max(0, totalNeto(p) - num(p.cobrado)), 0),
  );
  const conMetros = validosPeriodo.filter((p) => num(p.metros_total) > 0);
  const brutaMetros = calcularKpis(conMetros as readonly PedidoResumen[]).bruta;
  const metrosConMetros = conMetros.reduce((s, p) => s + num(p.metros_total), 0);
  const margenMetros = margenes(conMetros, ajustes).margenSinEnvios;

  const mr = margenes(realizados, ajustes);
  const horas = realizados
    .filter((p) => p.canal !== "textil")
    .map((p) => {
      const fin = momentoDeInstante(p.realizado_en);
      return fin ? horasEntre(momentoDelPedido(p), fin) : null;
    })
    .filter((h): h is number => h != null);
  const realizadosValidos = realizados.filter((p) => p.estado !== ESTADO_CANCELADO);
  const sinCobrar = realizadosValidos.filter((p) => totalNeto(p) - num(p.cobrado) > 0.01);

  const cola = pedidos.filter((p) => {
    if (p.estado === ESTADO_CANCELADO) return false;
    const dia = diaDelPedido(p);
    if (dia > hasta) return false;
    const r = diaRealizado(p.realizado_en);
    return r ? r > hasta : ABIERTOS.has(p.estado);
  });

  const cobrado = redondear(
    e.cobros
      .filter((c) => c.negocio === id && enRango(c.fecha.slice(0, 10), desde, hasta))
      .reduce((s, c) => s + num(c.importe), 0),
  );
  const facturado = redondear(
    e.documentos
      .filter((d) => d.negocio === id && enRango(d.fecha.slice(0, 10), desde, hasta))
      .reduce((s, d) => s + num(d.base), 0),
  );

  return {
    id,
    nombre,
    pedido: {
      ...mp,
      cancelados: delPeriodo.length - validosPeriodo.length,
      fueraDeHora: validosPeriodo.filter(
        (p) => p.canal !== "textil" && fueraDeHora(p, ajustes.horaCorte),
      ).length,
      ticket: mp.pedidos ? redondear(mp.vendido / mp.pedidos) : 0,
      euroMetro: metrosConMetros > 0 ? redondear(brutaMetros / metrosConMetros) : null,
      margenMetro: metrosConMetros > 0 ? redondear(margenMetros / metrosConMetros) : null,
      pendiente,
    },
    realizado: {
      ...mr,
      metrosImpresos: redondear(
        realizados.reduce((s, p) => s + num(p.metros_total), 0),
        2,
      ),
      horasMedias: horas.length
        ? redondear(horas.reduce((s, h) => s + h, 0) / horas.length, 1)
        : null,
      sinCobrar: sinCobrar.length,
      importeSinCobrar: redondear(sinCobrar.reduce((s, p) => s + totalNeto(p) - num(p.cobrado), 0)),
    },
    facturado,
    cobrado,
    cola: {
      pedidos: cola.length,
      metros: redondear(
        cola.reduce((s, p) => s + num(p.metros_total) * parteVendida(p), 0),
        2,
      ),
    },
    sinFecha: delPeriodo.filter(
      (p) => (p.estado === "enviado" || p.estado === "entregado") && !p.realizado_en,
    ).length,
  };
}

/** Lo que conviene mirar del periodo, de lo más grave a lo informativo. */
function avisosDe(r: Omit<Resumen, "avisos">, ajustes: AjustesResumen): AvisoResumen[] {
  const t = r.total;
  const avisos: AvisoResumen[] = [];
  if (t.pedido.pedidos > 0 && t.pedido.margenConEnvios < 0) {
    avisos.push({ nivel: "alto", tipo: "margen_negativo", importe: t.pedido.margenConEnvios });
  }
  if (r.capacidad.uso != null && r.capacidad.uso >= 0.9) {
    avisos.push({ nivel: "alto", tipo: "maquina_llena", porcentaje: r.capacidad.uso });
  }
  const capacidadDia = redondear(ajustes.metrosHora * r.capacidad.horasDia, 2);
  if (capacidadDia > 0 && t.cola.metros > capacidadDia) {
    avisos.push({ nivel: "medio", tipo: "cola_larga", metros: t.cola.metros, capacidadDia });
  }
  if (t.realizado.sinCobrar > 0) {
    avisos.push({
      nivel: "medio",
      tipo: "realizados_sin_cobrar",
      cantidad: t.realizado.sinCobrar,
      importe: t.realizado.importeSinCobrar,
    });
  }
  if (t.pedido.resultadoEnvios < 0) {
    avisos.push({ nivel: "medio", tipo: "envios_en_perdida", importe: -t.pedido.resultadoEnvios });
  }
  if (t.pedido.fueraDeHora > 0) {
    avisos.push({
      nivel: "info",
      tipo: "fuera_de_hora",
      cantidad: t.pedido.fueraDeHora,
      hora: horaCorta(ajustes.horaCorte),
    });
  }
  if (r.capacidad.uso != null && r.capacidad.uso < 0.5 && r.capacidad.dias > 0) {
    avisos.push({ nivel: "info", tipo: "maquina_con_sitio", porcentaje: r.capacidad.uso });
  }
  if (t.pedido.enviosEstimados > 0) {
    avisos.push({
      nivel: "info",
      tipo: "envios_estimados",
      cantidad: t.pedido.enviosEstimados,
      importe: ajustes.costeEnvioDefecto,
    });
  }
  if (t.sinFecha > 0) {
    avisos.push({ nivel: "info", tipo: "sin_fecha_realizado", cantidad: t.sinFecha });
  }
  return avisos;
}

/** Suma las cifras de varios negocios; los cocientes se recalculan. */
function sumar(id: string, nombre: string, lista: readonly CifrasNegocio[]): CifrasNegocio {
  const s = (f: (c: CifrasNegocio) => number) => redondear(lista.reduce((a, c) => a + f(c), 0));
  const s2 = (f: (c: CifrasNegocio) => number) =>
    redondear(
      lista.reduce((a, c) => a + f(c), 0),
      2,
    );
  const margenesSuma = (k: "pedido" | "realizado"): Margenes => ({
    pedidos: s((c) => c[k].pedidos),
    metros: s2((c) => c[k].metros),
    vendido: s((c) => c[k].vendido),
    base: s((c) => c[k].base),
    bruta: s((c) => c[k].bruta),
    enviosCobrados: s((c) => c[k].enviosCobrados),
    costeProduccion: s((c) => c[k].costeProduccion),
    costeEnvios: s((c) => c[k].costeEnvios),
    enviosEstimados: s((c) => c[k].enviosEstimados),
    margenSinEnvios: s((c) => c[k].margenSinEnvios),
    margenConEnvios: s((c) => c[k].margenConEnvios),
    resultadoEnvios: s((c) => c[k].resultadoEnvios),
  });
  const pedido = margenesSuma("pedido");
  const realizado = margenesSuma("realizado");
  const conHoras = lista.filter((c) => c.realizado.horasMedias != null);
  const pesoHoras = conHoras.reduce((a, c) => a + c.realizado.pedidos, 0);
  // € por metro: solo con los negocios que venden por metros.
  const conMetros = lista.filter((c) => c.pedido.euroMetro != null);
  const metrosVendidos = conMetros.reduce((a, c) => a + c.pedido.metros, 0);
  return {
    id,
    nombre,
    pedido: {
      ...pedido,
      cancelados: s((c) => c.pedido.cancelados),
      fueraDeHora: s((c) => c.pedido.fueraDeHora),
      ticket: pedido.pedidos ? redondear(pedido.vendido / pedido.pedidos) : 0,
      euroMetro:
        metrosVendidos > 0
          ? redondear(
              conMetros.reduce((a, c) => a + c.pedido.euroMetro! * c.pedido.metros, 0) /
                metrosVendidos,
            )
          : null,
      margenMetro:
        metrosVendidos > 0
          ? redondear(
              conMetros.reduce((a, c) => a + (c.pedido.margenMetro ?? 0) * c.pedido.metros, 0) /
                metrosVendidos,
            )
          : null,
      pendiente: s((c) => c.pedido.pendiente),
    },
    realizado: {
      ...realizado,
      metrosImpresos: s2((c) => c.realizado.metrosImpresos),
      horasMedias:
        pesoHoras > 0
          ? redondear(
              conHoras.reduce((a, c) => a + c.realizado.horasMedias! * c.realizado.pedidos, 0) /
                pesoHoras,
              1,
            )
          : null,
      sinCobrar: s((c) => c.realizado.sinCobrar),
      importeSinCobrar: s((c) => c.realizado.importeSinCobrar),
    },
    facturado: s((c) => c.facturado),
    cobrado: s((c) => c.cobrado),
    cola: { pedidos: s((c) => c.cola.pedidos), metros: s2((c) => c.cola.metros) },
    sinFecha: s((c) => c.sinFecha),
  };
}

/** El Resumen del periodo: por negocio, el total, la capacidad, el día a día y los avisos. */
export function resumenPeriodo(e: EntradaResumen): Resumen {
  const porNegocio = new Map<string, PedidoParaResumen[]>();
  for (const p of e.pedidos) {
    const lista = porNegocio.get(p.negocio) ?? [];
    lista.push(p);
    porNegocio.set(p.negocio, lista);
  }
  const negocios = e.negocios.map((n) => cifrasDe(n.id, n.nombre, e, porNegocio.get(n.id) ?? []));
  const total = sumar("total", "Total", negocios);

  const cap = capacidad(e.desde, e.hasta, e.hoy, e.ajustes, total.realizado.metrosImpresos);
  const beneficio =
    e.gastosFijos == null ? null : redondear(total.pedido.margenConEnvios - e.gastosFijos);

  const porDia: DiaResumen[] =
    e.desde === e.hasta
      ? []
      : diasEntre(e.desde, e.hasta < e.hoy ? e.hasta : e.hoy).map((dia) => {
          const delDia = e.pedidos.filter((p) => diaDelPedido(p) === dia);
          const m = margenes(delDia, e.ajustes);
          return {
            dia,
            pedidos: m.pedidos,
            metrosPedidos: m.metros,
            metrosImpresos: redondear(
              e.pedidos
                .filter((p) => diaRealizado(p.realizado_en) === dia)
                .reduce((s, p) => s + num(p.metros_total), 0),
              2,
            ),
            vendido: m.vendido,
            cobrado: redondear(
              e.cobros
                .filter((c) => c.fecha.slice(0, 10) === dia)
                .reduce((s, c) => s + num(c.importe), 0),
            ),
            margenConEnvios: m.margenConEnvios,
          };
        });

  const base: Omit<Resumen, "avisos"> = {
    desde: e.desde,
    hasta: e.hasta,
    // Los negocios sin nada en el periodo no se enseñan, salvo que sean todos.
    negocios: negocios.filter(
      (n) =>
        n.pedido.pedidos + n.pedido.cancelados + n.realizado.pedidos + n.cola.pedidos > 0 ||
        n.cobrado !== 0 ||
        n.facturado !== 0,
    ),
    total,
    capacidad: cap,
    gastosFijos: e.gastosFijos,
    beneficio,
    objetivo: {
      metros: e.objetivo.metros,
      vendido: e.objetivo.vendido,
      avanceMetros:
        e.objetivo.metros && e.objetivo.metros > 0
          ? redondear(total.realizado.metrosImpresos / e.objetivo.metros, 4)
          : null,
      avanceVendido:
        e.objetivo.vendido && e.objetivo.vendido > 0
          ? redondear(total.pedido.vendido / e.objetivo.vendido, 4)
          : null,
    },
    porDia,
  };
  return { ...base, avisos: avisosDe(base, e.ajustes) };
}

/** La variación de una cifra frente al periodo anterior, en tanto por uno; nulo sin base. */
export function variacionResumen(actual: number, anterior: number): number | null {
  if (!anterior) return null;
  return redondear((actual - anterior) / Math.abs(anterior), 4);
}

// ---------------------------------------------------------------------------
// Para el informe de los socios
// ---------------------------------------------------------------------------

/** Una parte de un todo, de 0 a 1 (o más); nulo si el todo no es positivo. */
export function proporcion(parte: number, todo: number): number | null {
  return todo > 0 ? redondear(parte / todo, 4) : null;
}

/** Los porcentajes que se leen de un vistazo. */
export type Ratios = {
  /** Margen neto ÷ facturación bruta. */
  margenNeto: number | null;
  /** Margen sin envíos ÷ facturación bruta. */
  margenSinEnvios: number | null;
  /** De lo vendido en el periodo, la parte que ya está cobrada. */
  cobradoDeLoPedido: number | null;
};

export function ratiosDe(c: CifrasNegocio): Ratios {
  return {
    margenNeto: proporcion(c.pedido.margenConEnvios, c.pedido.bruta),
    margenSinEnvios: proporcion(c.pedido.margenSinEnvios, c.pedido.bruta),
    cobradoDeLoPedido: proporcion(c.pedido.vendido - c.pedido.pendiente, c.pedido.vendido),
  };
}

/**
 * La evolución del periodo para dibujarla: día a día hasta un mes; si es más
 * largo (un trimestre, un año), mes a mes, con `dia` = 'yyyy-mm'.
 */
export function serieDelResumen(r: Resumen): { por: "dia" | "mes"; tramos: DiaResumen[] } {
  if (r.porDia.length <= 31) return { por: "dia", tramos: r.porDia };
  const meses = new Map<string, DiaResumen>();
  for (const d of r.porDia) {
    const clave = d.dia.slice(0, 7);
    const m = meses.get(clave) ?? {
      dia: clave,
      pedidos: 0,
      metrosPedidos: 0,
      metrosImpresos: 0,
      vendido: 0,
      cobrado: 0,
      margenConEnvios: 0,
    };
    m.pedidos += d.pedidos;
    m.metrosPedidos = redondear(m.metrosPedidos + d.metrosPedidos, 2);
    m.metrosImpresos = redondear(m.metrosImpresos + d.metrosImpresos, 2);
    m.vendido = redondear(m.vendido + d.vendido);
    m.cobrado = redondear(m.cobrado + d.cobrado);
    m.margenConEnvios = redondear(m.margenConEnvios + d.margenConEnvios);
    meses.set(clave, m);
  }
  return { por: "mes", tramos: [...meses.values()] };
}
