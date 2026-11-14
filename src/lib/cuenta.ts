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
import { useQueryClient } from "@tanstack/react-query";
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
  TODAS,
  ventasDelFiltro,
  type Cuenta,
  type DevolucionCuenta,
  type DocumentadoCuenta,
  type EntradaCuenta,
  type EstructuraCuenta,
  type FiltroCuenta,
  type VentaCuenta,
} from "@/dominio/cuenta";
import { AJUSTES_JORNADA_POR_DEFECTO, ventaDeTienda, type Venta } from "@/dominio/gerencia";
import { montarGastosGerencia } from "@/dominio/gerencia-datos";
import { costeAlmacenPeriodo } from "@/dominio/cuenta-almacen";
import { pagosPendientesProveedores } from "@/dominio/pagos-proveedores";
import { diaDeFecha, type Rango } from "@/dominio/periodos";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { facturadoSinPedido, pedidosDocumentados } from "@/dominio/grupos";
import type { DocumentoDePedido } from "@/dominio/fiscal";

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
  /** La estructura de un rango (un mes del periodo), o nula si no se puede saber. */
  estructuraDe: (r: Rango) => EstructuraCuenta | null;
  /** Lo que tiene factura o ticket en un rango (un mes del periodo), para el impuesto. */
  documentadoDe: (r: Rango) => DocumentadoCuenta | null;
  cargando: boolean;
  error: Error | null;
  /** Vuelve a pedir lo que ha fallado. */
  reintentar: () => void;
  /** Son las del periodo anterior mientras llega el nuevo: hay que avisar. */
  deAntes: boolean;
};

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
  const qc = useQueryClient();
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
  const { costeMetro } = useCosteMetroHoy();
  const ajustes = useAjustesGerencia();
  const compras = useComprasGerencia({ activo: conGastos });
  const movimientos = useMovimientosAlmacen({ activo: conGastos });
  const pagos = usePagosProveedores({ activo: dinero && conEstructura(filtro) });
  // Qué tiene factura o ticket: el Impuesto sobre Sociedades sale solo de ahí
  // (decisión de Javier, 14-11-2026), y lo facturado sin pedido es venta.
  const fiscal = useFiscal(rango, { activo: conGastos });
  const fiscalPrevio = useFiscal(rangoPrevio, { activo: conGastos && !!previo });
  const docs = useDocumentosDePedidos(ventas.data ?? [], {
    activo: conGastos && !!ventas.data,
  });
  const docsPrevios = useDocumentosDePedidos(ventasPrevias.data ?? [], {
    activo: conGastos && !!previo && !!ventasPrevias.data,
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

  // undefined: todavía se lee; null: no se puede saber (y el impuesto sale «—»).
  const documentado = (
    d: { data?: DocumentoDePedido[]; isError: boolean },
    f: {
      data?: {
        documentos: Parameters<typeof facturadoSinPedido>[0];
        referencias: Parameters<typeof facturadoSinPedido>[1];
      };
      isError: boolean;
    },
    r?: Rango,
  ): DocumentadoCuenta | null | undefined => {
    if (!conGastos) return undefined;
    if (d.isError || f.isError) return null;
    if (!d.data || !f.data) return undefined;
    const desde = r ? diaDeFecha(r.desde) : null;
    const hasta = r ? diaDeFecha(r.hasta) : null;
    const delRango = r
      ? f.data.documentos.filter((x) => x.fecha >= desde! && x.fecha <= hasta!)
      : f.data.documentos;
    return {
      pedidos: pedidosDocumentados(d.data),
      facturadoSinPedido: facturadoSinPedido(delRango, [
        ...(f.data.referencias ?? []),
        ...f.data.documentos,
      ]),
    };
  };
  const docActual = documentado(docs, fiscal);
  const docPrevio = documentado(docsPrevios, fiscalPrevio);
  const documentadoDe = useCallback(
    (r: Rango): DocumentadoCuenta | null => documentado(docs, fiscal, r) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conGastos, docs.data, docs.isError, fiscal.data, fiscal.isError],
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
    ): EntradaCuenta | null => {
      if (!v || !envios || !devs || costeMetro === undefined) return null;
      if (filtro.linea !== "todo" && dinero && !soloUvIds) return null;
      const uv = soloUvIds ?? new Set<string>();
      const estructura = conGastos ? estructuraDe(r) : null;
      if (conGastos && !estructura) return null;
      if (conGastos && doc === undefined) return null;
      return {
        ventas: ventasDelFiltro(conEnvio(v, envios), filtro),
        devoluciones: devolucionesDelFiltro(devs, filtro),
        costeMetroActual: costeMetro,
        costeEnvioDefecto,
        estructura,
        tipoIs,
        documentado: doc ?? null,
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
      ),
    [montar, rango, ventas.data, ventas.envios.data, devoluciones.data, cobros.data, docActual],
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
    (ajustes.error as Error | null) ??
    (conGastos ? (compras.error as Error | null) : null) ??
    (dinero && filtro.linea !== "todo" ? (soloUv.error as Error | null) : null) ??
    null;
  const reintentar = useCallback(() => {
    void qc.refetchQueries({ predicate: (q) => q.state.status === "error" });
  }, [qc]);

  return {
    cuenta,
    previa,
    entrada,
    estructuraDe,
    documentadoDe,
    cargando: !error && !cuenta,
    error,
    reintentar,
    deAntes: ventas.isPlaceholderData || devoluciones.isPlaceholderData,
  };
}

/** Lo pendiente de pago con un filtro: no se puede repartir, y se dice por qué. */
function conMotivos(c: Cuenta, filtro: FiltroCuenta): Cuenta {
  if (conEstructura(filtro)) return c;
  return { ...c, pendiente_pago: { valor: null, falta: MOTIVO_PAGO_FILTRADO } };
}
