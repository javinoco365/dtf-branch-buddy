/**
 * La Facturación Consolidada, calculada sobre lo cobrado.
 *
 * Antes sumaba el total de los pedidos, cobrados o no. Ahora cada euro que
 * aparece es un cobro: de una tienda o del textil, con su método (efectivo
 * incluido, para poder separarlo) y su origen (web, previo o de un pedido).
 * La propina va en su propia columna y suma al total.
 *
 * Dos criterios de fecha: por la del pedido (por defecto: lo que se vendió en
 * el periodo, se cobrara cuando se cobrara) o por la del cobro (el dinero que
 * entró en el periodo).
 *
 * Lógica pura: recibe filas ya leídas y devuelve cifras. Se prueba sin base de
 * datos.
 */

import { redondear } from "./importes";
import { desglosarCobro, etiquetaMetodo, TIENDA_TEXTIL, type MetodoCobro } from "./cobros";

export type CriterioFecha = "pedido" | "cobro";

/**
 * De dónde viene el dinero:
 *   - previo: cobrado antes de que existieran los cobros, sin presupuesto;
 *   - web:    pagado en la tienda online;
 *   - pedido: cobrado a mano contra un pedido.
 */
export type OrigenCobro = "previo" | "web" | "pedido";

export const ORIGENES_COBRO: readonly { valor: OrigenCobro; etiqueta: string }[] = [
  { valor: "web", etiqueta: "Web" },
  { valor: "pedido", etiqueta: "Pedido" },
  { valor: "previo", etiqueta: "Previo (sin presupuesto)" },
];

export function origenDelCobro(c: { metodo: MetodoCobro | string; previo: boolean }): OrigenCobro {
  if (c.previo) return "previo";
  if (c.metodo === "web") return "web";
  return "pedido";
}

export function etiquetaOrigenCobro(o: OrigenCobro): string {
  return ORIGENES_COBRO.find((x) => x.valor === o)?.etiqueta ?? o;
}

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

/** Un cobro tal como lo lee la pantalla, con su pedido al lado. */
export type CobroLeido = {
  id: string;
  /** Día del cobro, `yyyy-MM-dd`. */
  fecha: string;
  importe: Numerico;
  propina: Numerico;
  metodo: MetodoCobro;
  previo: boolean;
  /** La tienda, o el identificador del textil. */
  tienda_id: string;
  pedido: {
    id: string;
    numero: string;
    /** Instante (tiendas) o día (textil) del pedido. */
    fecha: string;
    cliente_nombre: string | null;
    total: Numerico;
    iva: Numerico;
    envio: Numerico;
    metros: Numerico;
  };
};

/** Un cobro ya repartido y fechado según el criterio elegido. */
export type CobroConsolidado = {
  id: string;
  /** Instante por el que se agrupa en semanas: el del pedido o el del cobro. */
  fecha: string;
  fecha_cobro: string;
  /** Día del pedido, `yyyy-MM-dd`: para saber cuánto se tardó en cobrar. */
  fecha_pedido: string;
  tienda_id: string;
  pedido_id: string;
  pedido_numero: string;
  cliente: string | null;
  metodo: MetodoCobro;
  origen: OrigenCobro;
  /** Lo aplicado al pedido, IVA incluido. */
  importe: number;
  propina: number;
  base: number;
  iva: number;
  envio: number;
  metros: number;
};

/**
 * Un día sin hora se sitúa a mediodía, hora local: a medianoche en UTC, un
 * lunes caería el domingo por la noche en cualquier huso por detrás de
 * Greenwich y saltaría de semana.
 */
function instante(fecha: string): string {
  return fecha.length <= 10 ? `${fecha}T12:00:00` : fecha;
}

/**
 * El día de una fecha en hora de Madrid. Un instante (pedido de tienda) se
 * pasa a la hora local; un día suelto (pedido textil) se deja como está.
 */
function diaLocal(fecha: string): string {
  if (fecha.length <= 10) return fecha;
  const d = new Date(fecha);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * Reparte el cobro en la proporción del pedido: el IVA como el del pedido
 * (desglosarCobro), y los envíos y los metros en la parte que se ha cobrado.
 * Un pedido cobrado entero suma sus metros y su envío completos; uno cobrado a
 * medias, la mitad.
 */
export function consolidarCobro(c: CobroLeido, criterio: CriterioFecha): CobroConsolidado {
  const importe = redondear(num(c.importe));
  const total = num(c.pedido.total);
  const parte = total > 0 ? importe / total : 0;
  const { base, iva } = desglosarCobro(importe, {
    iva: c.pedido.iva ?? null,
    total: c.pedido.total ?? null,
  });
  return {
    id: c.id,
    fecha: instante(criterio === "pedido" ? c.pedido.fecha : c.fecha),
    fecha_cobro: c.fecha.slice(0, 10),
    fecha_pedido: diaLocal(c.pedido.fecha),
    tienda_id: c.tienda_id,
    pedido_id: c.pedido.id,
    pedido_numero: c.pedido.numero,
    cliente: c.pedido.cliente_nombre,
    metodo: c.metodo,
    origen: origenDelCobro(c),
    importe,
    propina: redondear(num(c.propina)),
    base,
    iva,
    envio: redondear(num(c.pedido.envio) * parte),
    metros: redondear(num(c.pedido.metros) * parte, 3),
  };
}

export type FiltroConsolidada = {
  metodo: MetodoCobro | "todos";
  /** Una tienda, el textil (su identificador) o todas. */
  tienda: string;
  origen: OrigenCobro | "todos";
};

export const FILTRO_TODO: FiltroConsolidada = { metodo: "todos", tienda: "todas", origen: "todos" };

export function filtrarCobros(
  cobros: readonly CobroConsolidado[],
  f: FiltroConsolidada,
): CobroConsolidado[] {
  return cobros.filter(
    (c) =>
      (f.metodo === "todos" || c.metodo === f.metodo) &&
      (f.tienda === "todas" || c.tienda_id === f.tienda) &&
      (f.origen === "todos" || c.origen === f.origen),
  );
}

export type TotalesCobros = {
  cobros: number;
  /** Pedidos distintos: un pedido cobrado en dos veces cuenta uno. */
  pedidos: number;
  base: number;
  iva: number;
  envios: number;
  metros: number;
  /** Lo aplicado a los pedidos, IVA incluido, sin propinas. */
  cobrado: number;
  propina: number;
  /** Cobrado más propinas: todo el dinero que entró. */
  total: number;
};

export const TOTALES_VACIOS: TotalesCobros = {
  cobros: 0,
  pedidos: 0,
  base: 0,
  iva: 0,
  envios: 0,
  metros: 0,
  cobrado: 0,
  propina: 0,
  total: 0,
};

/**
 * Los cobros de las tiendas, sin el textil: lo que se compara con las ventas
 * del dashboard, que tampoco lo incluyen. Con `tiendaId`, los de esa tienda.
 */
export function cobrosDeTiendas(
  cobros: readonly CobroConsolidado[],
  tiendaId?: string,
): CobroConsolidado[] {
  return cobros.filter((c) =>
    tiendaId ? c.tienda_id === tiendaId : c.tienda_id !== TIENDA_TEXTIL.id,
  );
}

export function totalizar(cobros: readonly CobroConsolidado[]): TotalesCobros {
  const suma = (k: "base" | "iva" | "envio" | "metros" | "importe" | "propina") =>
    cobros.reduce((s, c) => s + c[k], 0);
  const cobrado = redondear(suma("importe"));
  const propina = redondear(suma("propina"));
  return {
    cobros: cobros.length,
    pedidos: new Set(cobros.map((c) => c.pedido_id)).size,
    base: redondear(suma("base")),
    iva: redondear(suma("iva")),
    envios: redondear(suma("envio")),
    metros: redondear(suma("metros"), 3),
    cobrado,
    propina,
    total: redondear(cobrado + propina),
  };
}

export type FilaTiendaCobros = { tienda_id: string; nombre: string } & TotalesCobros;

/**
 * Desglose por tienda, de mayor a menor. Las tiendas sin cobros en el periodo
 * salen a cero: que una tienda no haya cobrado nada también es información.
 */
export function desglosePorTienda(
  cobros: readonly CobroConsolidado[],
  tiendas: readonly { id: string; nombre: string }[],
): FilaTiendaCobros[] {
  return tiendas
    .map((t) => ({
      tienda_id: t.id,
      nombre: t.nombre,
      ...totalizar(cobros.filter((c) => c.tienda_id === t.id)),
    }))
    .sort((a, b) => b.total - a.total);
}

export type FilaMetodo = {
  metodo: MetodoCobro;
  etiqueta: string;
  cobros: number;
  cobrado: number;
  propina: number;
  total: number;
};

const ORDEN_METODOS: readonly MetodoCobro[] = [
  "efectivo",
  "tarjeta",
  "transferencia",
  "web",
  "sin_especificar",
];

/** Cuánto entró por cada método. Solo los que tienen algún cobro. */
export function desglosePorMetodo(cobros: readonly CobroConsolidado[]): FilaMetodo[] {
  return ORDEN_METODOS.map((metodo) => {
    const t = totalizar(cobros.filter((c) => c.metodo === metodo));
    return {
      metodo,
      etiqueta: etiquetaMetodo(metodo),
      cobros: t.cobros,
      cobrado: t.cobrado,
      propina: t.propina,
      total: t.total,
    };
  }).filter((f) => f.cobros > 0);
}

/**
 * Total (con propinas) dentro de cada rango, para las series semanales: se
 * lee el periodo completo una vez y se reparte aquí.
 */
export function totalPorRangos(
  cobros: readonly CobroConsolidado[],
  rangos: readonly { desde: Date; hasta: Date }[],
): { desde: Date; hasta: Date; total: number }[] {
  return rangos.map((r) => {
    const desde = r.desde.getTime();
    const hasta = r.hasta.getTime();
    const total = cobros
      .filter((c) => {
        const t = new Date(c.fecha).getTime();
        return t >= desde && t <= hasta;
      })
      .reduce((s, c) => s + c.importe + c.propina, 0);
    return { desde: r.desde, hasta: r.hasta, total: redondear(total) };
  });
}
