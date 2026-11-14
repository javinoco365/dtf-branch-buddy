/**
 * La lectura de la cuenta de resultados (dominio/cuenta.ts): un solo gancho
 * que junta lo que hace falta y devuelve la cuenta ya calculada, del periodo
 * y del anterior. Lo usan Inicio, el resumen y la facturación de cada tienda,
 * Gerencia y la pantalla «Cuenta de resultados»: todas leen igual y calculan
 * igual.
 *
 * Solo lectura y con la RLS del usuario. Reutiliza las lecturas (y sus claves
 * de caché) de periodo.ts y gerencia.ts: lo que ya se leyó en otra pantalla no
 * se vuelve a pedir.
 */

import { useCallback, useMemo } from "react";
import { useReintentarFallidas } from "@/lib/reintentar";
import {
  useCobrosPeriodo,
  useCosteMetroHoy,
  useDevolucionesPeriodo,
  useEnviosDeVentas,
  usePedidosPeriodo,
  usePedidosSoloUv,
  type EnvioDeVenta,
  type RangoFechas,
} from "@/lib/periodo";
import {
  useAjustesGerencia,
  useComprasGerencia,
  useDocumentosDePedidos,
  useFiscal,
  useMovimientosAlmacen,
  usePagosProveedores,
  usePendientesCobro,
  useVentasGerencia,
} from "@/lib/gerencia";
import {
  calcularCuenta,
  cobradoDelPeriodo,
  conEstructura,
  devolucionesDelFiltro,
  estructuraDelPeriodo,
  pendienteDeCobroHoy,
  sinPedidoDelFiltro,
  TODAS,
  ventasDelFiltro,
  type ClaveConcepto,
  type Cuenta,
  type DevolucionCuenta,
  type DocumentadoCuenta,
  type EntradaCuenta,
  type EstructuraCuenta,
  type FiltroCuenta,
  type ImportesSinPedido,
  type VentaCuenta,
} from "@/dominio/cuenta";
import { AJUSTES_JORNADA_POR_DEFECTO, ventaDeTienda, type Venta } from "@/dominio/gerencia";
import { montarGastosGerencia } from "@/dominio/gerencia-datos";
import { costeAlmacenPeriodo } from "@/dominio/cuenta-almacen";
import { pagosPendientesProveedores } from "@/dominio/pagos-proveedores";
import { diaDeFecha, type Rango } from "@/dominio/periodos";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { pedidosDocumentados } from "@/dominio/grupos";
import type { DocumentoDePedido, DocumentoFiscal } from "@/dominio/fiscal";

export type OpcionesCuenta = {
  rango: RangoFechas;
  /** El periodo con el que se compara; nulo si no se compara. */
  previo: RangoFechas | null;
  filtro: FiltroCuenta;
  /**
   * Leer solo la tienda del filtro (sin las demás ni el textil): las
   * pantallas de una tienda. Sin él se leen todas y se filtra aquí.
   */
  soloTienda?: boolean;
  /** Si hacen falta los gastos de estructura (y con ellos el beneficio). */
  gastos?: boolean;
  /** Si hace falta el bloque de dinero: cobrado, pendiente de cobro y de pago. */
  dinero?: boolean;
};

export type LecturaCuenta = {
  /** La cuenta del periodo; nula mientras se lee o si falla. */
  cuenta: Cuenta | null;
  /** La del periodo anterior; nula sin comparar o mientras se lee. */
  previa: Cuenta | null;
  /** Lo que ha entrado en la cuenta, ya filtrado: para separarla en columnas. */
  entrada: EntradaCuenta | null;
  /** La del periodo anterior (nula sin comparar o mientras se lee). */
  entradaPrevia: EntradaCuenta | null;
  /** La estructura de un rango (un mes del periodo), o nula si no se puede saber. */
  estructuraDe: (r: Rango) => EstructuraCuenta | null;
  /** Lo facturado sin pedido de un rango (un mes del periodo), con el filtro de la cuenta. */
  sinPedidoDe: (r: Rango) => ImportesSinPedido | null;
  cargando: boolean;
  error: Error | null;
  /** Vuelve a pedir lo que ha fallado. */
  reintentar: () => void;
  /** Mientras se vuelve a pedir lo que falló: el botón no se pulsa dos veces. */
  reintentando: boolean;
  /**
   * Cómo va cada cifra del bloque de dinero, que se lee aparte: si una falla,
   * el resto de la cuenta se ve igual y esa dice que no se pudo leer.
   */
  estadoDinero: Record<ClaveDinero, EstadoCifra>;
  /** Son las del periodo anterior mientras llega el nuevo: hay que avisar. */
  deAntes: boolean;
};

/** Las cifras del bloque de dinero, que se leen cada una por su lado. */
export type ClaveDinero = Extract<ClaveConcepto, "cobrado" | "pendiente_cobro" | "pendiente_pago">;

/** Cómo va la lectura de una cifra: leyéndose, con error o leída. */
export type EstadoCifra = { cargando: boolean; error: Error | null };

const LISTA: EstadoCifra = { cargando: false, error: null };

/** El estado de una consulta que hace falta (o no) para una cifra. */
const estadoDe = (
  activa: boolean,
  q: { isPending: boolean; error: unknown; data?: unknown },
): EstadoCifra =>
  !activa
    ? LISTA
    : { cargando: q.data === undefined && !q.error, error: (q.error as Error | null) ?? null };

type LecturaDocumentos = { data?: DocumentoDePedido[]; isError: boolean };
type LecturaFiscal = {
  data?: { documentos: DocumentoFiscal[]; referencias?: DocumentoFiscal[] };
  isError: boolean;
};

/**
 * Lo que tiene factura o ticket: los pedidos con documento vigente, para el
 * impuesto. undefined: todavía se lee (o no hace falta: sin gastos no hay
 * impuesto); null: no se puede saber (y el impuesto sale «—»).
 */
function documentado(
  conGastos: boolean,
  d: LecturaDocumentos,
): DocumentadoCuenta | null | undefined {
  if (!conGastos) return undefined;
  if (d.isError) return null;
  if (!d.data) return undefined;
  return { pedidos: pedidosDocumentados(d.data) };
}

/**
 * Lo facturado sin pedido (en un rango, si se da) con el filtro de la cuenta:
 * con una tienda, solo los de esa tienda (o los del textil); con una línea,
 * nada, porque una factura a mano no dice de qué línea es (se dice en la ⓘ de
 * «Ventas netas»). undefined: todavía se lee; null: no se ha podido leer (la
 * cuenta sigue sin ello).
 */
function sinPedidoDe(
  f: LecturaFiscal,
  filtro: FiltroCuenta,
  r?: Rango,
): ImportesSinPedido | null | undefined {
  if (filtro.linea !== "todo") return sinPedidoDelFiltro([], [], filtro);
  if (f.isError) return null;
  if (!f.data) return undefined;
  return sinPedidoDelFiltro(f.data.documentos, f.data.referencias ?? [], filtro, r);
}

/**
 * Los pedidos de los que hay que saber si tienen documento: los vendidos en
 * el periodo y los devueltos en él (de cualquier periodo). Nulo mientras falte
 * alguna de las dos lecturas.
 */
function conDevueltos(
  ventas: readonly Venta[] | undefined,
  devoluciones: readonly DevolucionCuenta[] | undefined,
): Pick<Venta, "id" | "canal">[] | null {
  if (!ventas || !devoluciones) return null;
  const vistos = new Set(ventas.map((v) => v.id).filter(Boolean));
  const devueltos = devoluciones
    .filter((d) => d.pedido_id && !vistos.has(d.pedido_id))
    // Las devoluciones son de pedidos de tienda (el textil no tiene).
    .map((d) => ({ id: d.pedido_id, canal: "web" as const }));
  return [...ventas, ...devueltos];
}

/** El rango vacío de las consultas que no hacen falta (no traen nada). */
const vacio = (r: RangoFechas): RangoFechas => ({ desde: r.hasta, hasta: r.desde });

const MOTIVO_PAGO_FILTRADO =
  "Solo con todas las tiendas y todas las líneas: las compras son de toda la empresa.";

/** Las ventas con lo de su envío (la cuenta lo necesita para el resultado de los envíos). */
function conEnvio(
  ventas: readonly Venta[],
  envios: ReadonlyMap<string, EnvioDeVenta>,
): VentaCuenta[] {
  return ventas.map((v) => {
    const e = v.id ? envios.get(v.id) : undefined;
    return {
      ...v,
      coste_envio_real: e?.coste_envio_real ?? null,
      con_envio: (Number(v.envio) || 0) > 0 || (e?.seguimiento ?? false),
    };
  });
}

/** Las ventas de un periodo: de todas las tiendas y el textil, o de una tienda. */
function useVentasCuenta(rango: RangoFechas, tiendaId: string | undefined, activo: boolean) {
  const todas = useVentasGerencia(rango, { activo: activo && !tiendaId });
  const deTienda = usePedidosPeriodo(
    { ...rango, tiendaId: tiendaId ?? "" },
    { activo: activo && !!tiendaId },
  );
  const datosTienda = deTienda.data;
  const ventas = useMemo(
    () => (datosTienda ? datosTienda.map(ventaDeTienda) : undefined),
    [datosTienda],
  );
  const envios = useEnviosDeVentas(tiendaId ? ventas : todas.data, { activo });
  return tiendaId
    ? {
        data: ventas,
        envios,
        isPending: deTienda.isPending,
        isPlaceholderData: deTienda.isPlaceholderData,
        error: deTienda.error,
      }
    : {
        data: todas.data,
        envios,
        isPending: todas.isPending,
        isPlaceholderData: todas.isPlaceholderData,
        error: todas.error,
      };
}

/** La cuenta de resultados de un periodo y del anterior, con los filtros dados. */
export function useCuentaResultados({
  rango,
  previo,
  filtro,
  soloTienda = false,
  gastos = true,
  dinero = true,
}: OpcionesCuenta): LecturaCuenta {
  const hoy = useMemo(() => new Date(), []);
  const tiendaReal =
    filtro.tienda !== TODAS && filtro.tienda !== TIENDA_TEXTIL.id ? filtro.tienda : undefined;
  const tiendaLectura = soloTienda ? tiendaReal : undefined;
  const conGastos = gastos && conEstructura(filtro);
  const rangoPrevio = previo ?? vacio(rango);

  const ventas = useVentasCuenta(rango, tiendaLectura, true);
  const ventasPrevias = useVentasCuenta(rangoPrevio, tiendaLectura, !!previo);
  const devoluciones = useDevolucionesPeriodo(rango, tiendaLectura);
  const devolucionesPrevias = useDevolucionesPeriodo(rangoPrevio, tiendaLectura, {
    activo: !!previo,
  });
  const { costeMetro, error: errorCosteMetro } = useCosteMetroHoy();
  const ajustes = useAjustesGerencia();
  const compras = useComprasGerencia({ activo: conGastos });
  const movimientos = useMovimientosAlmacen({ activo: conGastos });
  const pagos = usePagosProveedores({ activo: dinero && conEstructura(filtro) });
  // Qué tiene factura o ticket: el Impuesto sobre Sociedades sale solo de ahí
  // (decisión de Javier, 14-11-2026), y lo facturado sin pedido es venta.
  // Lo facturado sin pedido es venta siempre (con o sin gastos): se lee
  // siempre, salvo con filtro de línea, que no lo lleva.
  const conSinPedido = filtro.linea === "todo";
  const fiscal = useFiscal(rango, { activo: conSinPedido });
  const fiscalPrevio = useFiscal(rangoPrevio, { activo: conSinPedido && !!previo });
  // Los documentos de los pedidos vendidos y de los devueltos en el periodo:
  // una devolución de un pedido documentado de otro periodo también resta en
  // la base del impuesto.
  const pedidosDocs = useMemo(
    () => conDevueltos(ventas.data, devoluciones.data),
    [ventas.data, devoluciones.data],
  );
  const pedidosDocsPrevios = useMemo(
    () => conDevueltos(ventasPrevias.data, devolucionesPrevias.data),
    [ventasPrevias.data, devolucionesPrevias.data],
  );
  const docs = useDocumentosDePedidos(pedidosDocs ?? [], {
    activo: conGastos && !!pedidosDocs,
  });
  const docsPrevios = useDocumentosDePedidos(pedidosDocsPrevios ?? [], {
    activo: conGastos && !!previo && !!pedidosDocsPrevios,
  });
  const cobros = useCobrosPeriodo(rango, "cobro", tiendaLectura, { activo: dinero });
  const cobrosPrevios = useCobrosPeriodo(rangoPrevio, "cobro", tiendaLectura, {
    activo: dinero && !!previo,
  });
  const pendientes = usePendientesCobro({ activo: dinero });
  // Los pedidos solo de DTF UV, para repartir cobros y pendientes por línea.
  const soloUv = usePedidosSoloUv(tiendaLectura, {
    enabled: dinero && filtro.linea !== "todo",
  });

  const ajustesLeidos = ajustes.data ?? null;
  // Sin los ajustes de Gerencia (o sin poder leerlos), los de por defecto
  // solo para estimar el envío; el impuesto, sin tipo: no se inventa.
  const costeEnvioDefecto =
    ajustesLeidos?.resumen.coste_envio_defecto ?? AJUSTES_JORNADA_POR_DEFECTO.coste_envio_defecto;
  const tipoIs = ajustesLeidos?.impuestosDisponibles ? ajustesLeidos.ajustes.tipo_is : null;

  const listaGastos = useMemo(
    () =>
      conGastos
        ? montarGastosGerencia({
            ajustes: { data: ajustes.data, isError: ajustes.isError },
            compras: { data: compras.data, isError: compras.isError },
          })
        : null,
    [conGastos, ajustes.data, ajustes.isError, compras.data, compras.isError],
  );
  // Sin la tabla de movimientos (null) o si no se puede leer, el almacén no
  // resta nada; mientras se lee, todavía no hay estructura.
  const movs = movimientos.data;
  const almacenListo = movs !== undefined || !!movimientos.error;
  const estructuraDe = useCallback(
    (r: Rango): EstructuraCuenta | null => {
      if (!conGastos || !listaGastos || !almacenListo) return null;
      const almacen = movs
        ? costeAlmacenPeriodo(movs.movimientos, diaDeFecha(r.desde), diaDeFecha(r.hasta))
        : 0;
      return estructuraDelPeriodo(listaGastos, r, almacen, hoy);
    },
    [conGastos, listaGastos, almacenListo, movs, hoy],
  );

  const docActual = useMemo(
    () => documentado(conGastos, docs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conGastos, docs.data, docs.isError],
  );
  const docPrevio = useMemo(
    () => documentado(conGastos, docsPrevios),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conGastos, docsPrevios.data, docsPrevios.isError],
  );
  const spActual = useMemo(
    () => sinPedidoDe(fiscal, filtro),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fiscal.data, fiscal.isError, filtro],
  );
  const spPrevio = useMemo(
    () => sinPedidoDe(fiscalPrevio, filtro),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fiscalPrevio.data, fiscalPrevio.isError, filtro],
  );
  const sinPedidoDelRango = useCallback(
    (r: Rango): ImportesSinPedido | null => sinPedidoDe(fiscal, filtro, r) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fiscal.data, fiscal.isError, filtro],
  );

  const soloUvIds = soloUv.data;
  const montar = useCallback(
    (
      r: RangoFechas,
      v: readonly Venta[] | undefined,
      envios: ReadonlyMap<string, EnvioDeVenta> | undefined,
      devs: readonly DevolucionCuenta[] | undefined,
      cobrosLeidos:
        { disponible: boolean; cobros: Parameters<typeof cobradoDelPeriodo>[0] } | undefined,
      actual: boolean,
      doc: DocumentadoCuenta | null | undefined,
      sp: ImportesSinPedido | null | undefined,
    ): EntradaCuenta | null => {
      if (!v || !envios || !devs || costeMetro === undefined) return null;
      if (filtro.linea !== "todo" && dinero && !soloUvIds) return null;
      const uv = soloUvIds ?? new Set<string>();
      const estructura = conGastos ? estructuraDe(r) : null;
      if (conGastos && !estructura) return null;
      if (conGastos && doc === undefined) return null;
      // Sin lo facturado sin pedido, las ventas netas no serían las de verdad.
      if (sp === undefined) return null;
      return {
        ventas: ventasDelFiltro(conEnvio(v, envios), filtro),
        devoluciones: devolucionesDelFiltro(devs, filtro),
        costeMetroActual: costeMetro,
        costeEnvioDefecto,
        estructura,
        tipoIs,
        documentado: doc ?? null,
        sinPedido: sp,
        dinero: dinero
          ? {
              cobrado: cobrosLeidos?.disponible
                ? cobradoDelPeriodo(cobrosLeidos.cobros, filtro, uv)
                : null,
              // Lo pendiente es la foto de hoy: no tiene periodo anterior.
              pendienteCobro:
                actual && pendientes.data?.disponible
                  ? pendienteDeCobroHoy(pendientes.data.pedidos, filtro, uv)
                  : null,
              pendientePago:
                actual && pagos.data ? pagosPendientesProveedores(pagos.data, hoy).total : null,
            }
          : undefined,
      };
    },
    [
      costeMetro,
      costeEnvioDefecto,
      tipoIs,
      filtro,
      dinero,
      soloUvIds,
      conGastos,
      estructuraDe,
      pendientes.data,
      pagos.data,
      hoy,
    ],
  );

  const entrada = useMemo(
    () =>
      montar(
        rango,
        ventas.data,
        ventas.envios.data,
        devoluciones.data,
        cobros.data,
        true,
        docActual,
        spActual,
      ),
    [
      montar,
      rango,
      ventas.data,
      ventas.envios.data,
      devoluciones.data,
      cobros.data,
      docActual,
      spActual,
    ],
  );
  const entradaPrevia = useMemo(
    () =>
      previo
        ? montar(
            previo,
            ventasPrevias.data,
            ventasPrevias.envios.data,
            devolucionesPrevias.data,
            cobrosPrevios.data,
            false,
            docPrevio,
            spPrevio,
          )
        : null,
    [
      montar,
      previo,
      ventasPrevias.data,
      ventasPrevias.envios.data,
      devolucionesPrevias.data,
      cobrosPrevios.data,
      docPrevio,
      spPrevio,
    ],
  );

  const cuenta = useMemo(
    () => (entrada ? conMotivos(calcularCuenta(entrada), filtro) : null),
    [entrada, filtro],
  );
  const previa = useMemo(
    () => (entradaPrevia ? conMotivos(calcularCuenta(entradaPrevia), filtro) : null),
    [entradaPrevia, filtro],
  );

  const error =
    (ventas.error as Error | null) ??
    (ventas.envios.error as Error | null) ??
    devoluciones.error ??
    (errorCosteMetro as Error | null) ??
    (ajustes.error as Error | null) ??
    (conGastos ? (compras.error as Error | null) : null) ??
    // Sin las facturas, las ventas netas no llevarían lo facturado sin pedido.
    (conSinPedido ? (fiscal.error as Error | null) : null) ??
    (dinero && filtro.linea !== "todo" ? (soloUv.error as Error | null) : null) ??
    null;
  const { reintentar, reintentando } = useReintentarFallidas();

  const pagosActivos = dinero && conEstructura(filtro);
  const estadoDinero = useMemo(
    (): Record<ClaveDinero, EstadoCifra> => ({
      cobrado: estadoDe(dinero, cobros),
      pendiente_cobro: estadoDe(dinero, pendientes),
      pendiente_pago: estadoDe(pagosActivos, pagos),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dinero,
      pagosActivos,
      cobros.data,
      cobros.error,
      pendientes.data,
      pendientes.error,
      pagos.data,
      pagos.error,
    ],
  );

  return {
    cuenta,
    previa,
    entrada,
    entradaPrevia,
    estructuraDe,
    sinPedidoDe: sinPedidoDelRango,
    cargando: !error && !cuenta,
    error,
    reintentar,
    reintentando,
    estadoDinero,
    deAntes: ventas.isPlaceholderData || devoluciones.isPlaceholderData,
  };
}

/** Lo pendiente de pago con un filtro: no se puede repartir, y se dice por qué. */
function conMotivos(c: Cuenta, filtro: FiltroCuenta): Cuenta {
  if (conEstructura(filtro)) return c;
  return { ...c, pendiente_pago: { valor: null, falta: MOTIVO_PAGO_FILTRADO } };
}
