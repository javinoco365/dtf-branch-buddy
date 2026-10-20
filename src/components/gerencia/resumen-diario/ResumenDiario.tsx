import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, DownloadCloud, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { endOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { useAuth } from "@/lib/auth-context";
import { fechaLarga } from "@/lib/format";
import {
  resumenControlesAlmacen,
  useAjustesGerencia,
  useControlesAlmacen,
  useCosteMetroActual,
  useMovimientosAlmacen,
  usePagosProveedores,
  useProformasPendientes,
} from "@/lib/gerencia";
import { useDatosResumen, useDocumentosResumen, type DatosResumen } from "@/lib/resumen-diario";
import { recuperarRealizadoWoo } from "@/lib/woocommerce.functions";
import type { PeriodoUrl } from "@/lib/filtros-url";
import { leerEmpresa } from "@/lib/empresa";
import { tituloInforme } from "@/lib/resumen-diario-textos";
import { descargarBlob } from "@/lib/csv";
import type { DatosInformeSocios } from "@/lib/pdf-informe-socios";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import {
  AJUSTES_JORNADA_POR_DEFECTO,
  gastosFijosDelRango,
  gastosFijosDesglose,
  objetivoDelRango,
  type AjustesJornada,
  type GastoFijo,
  type Objetivo,
} from "@/dominio/gerencia";
import {
  PERIODOS_CUADRO,
  compararCon,
  diaDeFecha,
  etiquetaPeriodo,
  rangoDe,
  type Comparar,
  type Rango,
  type Seleccion,
} from "@/dominio/periodos";
import { diaRealizado } from "@/dominio/realizado";
import { resumenPeriodo, type DocumentoParaResumen, type Resumen } from "@/dominio/resumen-diario";
import { cuentaAlmacen, type InformeAlmacen } from "@/dominio/cuenta-almacen";
import { pagosPendientesProveedores } from "@/dominio/pagos-proveedores";
import { proformasSinFactura, proformasTextil, resumenProformas } from "@/dominio/proformas";
import { ErrorPestana, Nota } from "../comun";
import { Esquema } from "./Esquema";
import { Desglose } from "./Desglose";
import { Jornada } from "./Jornada";

/** El rango cortado en el final de hoy, si todavía no ha acabado. */
function transcurrido(r: Rango): Rango {
  const fin = endOfDay(new Date());
  return r.hasta > fin && r.desde <= fin ? { desde: r.desde, hasta: fin } : r;
}

type Tienda = { id: string; nombre: string; color?: string | null };

/**
 * El botón «Resumen diario» de Gerencia y su ventana: cómo ha ido el día (o
 * la semana, el mes…), por tienda y textil, para los socios. Página 1, el
 * esquema; página 2, el desglose. Se imprime (o se guarda en PDF) con una
 * página para cada parte.
 */
export function BotonResumenDiario(props: {
  tiendas: readonly Tienda[];
  /** Los gastos fijos con las compras que cuentan como gasto; nulo mientras cargan. */
  gastos: readonly GastoFijo[] | null;
  objetivos: readonly Objetivo[];
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setAbierto(true)} className="max-md:w-full">
        <CalendarClock className="h-4 w-4" />
        Resumen diario
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="resumen-imprimible grid-cols-1 max-w-6xl max-h-[94vh] overflow-y-auto max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:p-4">
          {/* Solo montado mientras está abierto: cerrado no lee nada. */}
          {abierto && <Contenido {...props} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const HOY: Seleccion["tipo"] = "hoy";

function Contenido({
  tiendas,
  gastos,
  objetivos,
}: {
  tiendas: readonly Tienda[];
  gastos: readonly GastoFijo[] | null;
  objetivos: readonly Objetivo[];
}) {
  // El periodo vive aquí, no en la dirección: el Resumen se abre siempre en hoy.
  const [seleccion, setSeleccion] = useState<Seleccion>(() => ({ tipo: HOY, ref: new Date() }));
  const [comparar, setComparar] = useState<Comparar>("anterior");
  const rango = useMemo(() => rangoDe(seleccion)!, [seleccion]);
  const comparacion = useMemo(() => compararCon(seleccion, comparar), [seleccion, comparar]);
  const periodo: PeriodoUrl = {
    seleccion,
    rango,
    elegir: setSeleccion,
    comparar,
    setComparar,
    comparacion,
    porDefecto: HOY,
  };
  // Sin comparación, un rango vacío: las consultas no pueden ser condicionales.
  const previo = useMemo<Rango>(
    () => comparacion?.previo ?? { desde: rango.hasta, hasta: rango.desde },
    [comparacion, rango],
  );

  const actual = useDatosResumen(rango);
  const anterior = useDatosResumen(previo);
  const docs = useDocumentosResumen(rango);
  const docsPrevios = useDocumentosResumen(previo);
  const ajustesGerencia = useAjustesGerencia();
  const costeMetro = useCosteMetroActual();
  const jornada: AjustesJornada = ajustesGerencia.data?.resumen ?? AJUSTES_JORNADA_POR_DEFECTO;

  const negocios = useMemo(
    () => [...tiendas.map((t) => ({ id: t.id, nombre: t.nombre })), TIENDA_TEXTIL],
    [tiendas],
  );

  // En useMemo: resumenPeriodo recorre todos los pedidos, cobros y documentos
  // del periodo, y antes se repetía en cada repintado del diálogo (cada tecla,
  // cada consulta que llegaba). Mismas entradas, mismo resultado.
  const { resumen, resumenPrevio } = useMemo(() => {
    const calcular = (r: Rango, datos?: DatosResumen, documentos?: DocumentoParaResumen[]) =>
      datos && documentos
        ? resumenPeriodo({
            desde: diaDeFecha(r.desde),
            hasta: diaDeFecha(r.hasta),
            hoy: diaRealizado(new Date().toISOString()) ?? diaDeFecha(new Date()),
            negocios,
            pedidos: datos.pedidos,
            cobros: datos.cobros,
            documentos,
            ajustes: {
              horaCorte: jornada.hora_corte,
              metrosHora: jornada.metros_hora,
              jornadaInicio: jornada.jornada_inicio,
              jornadaFin: jornada.jornada_fin,
              costeEnvioDefecto: jornada.coste_envio_defecto,
              costeMetroActual: costeMetro,
            },
            // Los gastos y el objetivo de lo que ha pasado del periodo: un año en
            // curso no carga los gastos de los meses que aún no han llegado.
            gastosFijos: gastos ? gastosFijosDelRango(gastos, transcurrido(r)) : null,
            objetivo: objetivoDelRango(objetivos, transcurrido(r)),
          })
        : null;

    const resumen: Resumen | null = calcular(rango, actual.data, docs.data);
    const resumenPrevio: Resumen | null = comparacion
      ? calcular(previo, anterior.data, docsPrevios.data)
      : null;
    return { resumen, resumenPrevio };
  }, [
    rango,
    previo,
    comparacion,
    actual.data,
    anterior.data,
    docs.data,
    docsPrevios.data,
    negocios,
    jornada,
    costeMetro,
    gastos,
    objetivos,
  ]);

  // Los gastos fijos uno a uno, para ver de dónde sale el total.
  const gastosDelPeriodo = useMemo(
    () => (gastos ? gastosFijosDesglose(gastos, transcurrido(rango)) : null),
    [gastos, rango],
  );

  // La página «Almacén» del informe. Si una parte no se puede leer, va a nulo
  // y el informe sale igual.
  const movimientosAlmacen = useMovimientosAlmacen();
  const controlesAlmacen = useControlesAlmacen(rango);
  const pagosProveedores = usePagosProveedores();
  // Sin la migración de proformas, nulo: el informe sale sin esa línea. Si
  // falla la lectura, el informe lo dice (no es «ninguna proforma»).
  const proformasPendientes = useProformasPendientes();
  const informeAlmacen = useMemo<InformeAlmacen | null>(() => {
    const movs = movimientosAlmacen.data;
    if (!movs) return null;
    const ahora = new Date();
    const controles = controlesAlmacen.data;
    const pagos = pagosProveedores.data
      ? pagosPendientesProveedores(pagosProveedores.data, ahora)
      : null;
    return {
      cuenta: cuentaAlmacen(movs.movimientos, diaDeFecha(rango.desde), diaDeFecha(rango.hasta)),
      valorHoy: controles?.disponible ? controles.valorCache : null,
      controles: resumenControlesAlmacen(controles, movs.movimientos, ahora),
      pagosProveedores: pagos ? { total: pagos.total, facturas: pagos.facturas } : null,
      // Es el bloque del almacén textil: solo las proformas textiles.
      proformasSinFactura: proformasPendientes.data
        ? resumenProformas(proformasSinFactura(proformasTextil(proformasPendientes.data), ahora))
        : null,
      proformasError: proformasPendientes.error?.message ?? null,
    };
  }, [
    movimientosAlmacen.data,
    controlesAlmacen.data,
    pagosProveedores.data,
    proformasPendientes.data,
    proformasPendientes.error,
    rango,
  ]);

  // Mientras se lee el almacén, el botón espera: «leyendo» no es «sin datos».
  const almacenLeido =
    !movimientosAlmacen.isPending &&
    !controlesAlmacen.isPending &&
    !pagosProveedores.isPending &&
    !proformasPendientes.isPending;

  const error = actual.error ?? docs.error;
  const etiqueta = etiquetaPeriodo(seleccion);

  return (
    <div className="min-w-0 space-y-5">
      <DialogHeader className="text-left">
        <DialogTitle className="text-xl">Resumen · {etiqueta}</DialogTitle>
        <DialogDescription>
          Tiendas y textil personalizado
          {comparacion ? `, frente a ${comparacion.etiqueta}` : ""}. Generado el{" "}
          {fechaLarga(new Date())}.
        </DialogDescription>
      </DialogHeader>

      <div className="no-imprimir flex flex-wrap items-center gap-2">
        <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />
        <div className="flex flex-wrap gap-2 md:ml-auto max-md:w-full">
          <Jornada
            ajustes={jornada}
            disponible={ajustesGerencia.data?.resumenDisponible ?? false}
          />
          <BotonInforme
            datos={
              resumen && almacenLeido
                ? {
                    resumen,
                    anterior: resumenPrevio,
                    tipoInforme: tituloInforme(seleccion).tipo,
                    periodo: tituloInforme(seleccion).titulo,
                    frente: comparacion?.etiqueta ?? null,
                    colores: Object.fromEntries(tiendas.map((t) => [t.id, t.color])),
                    jornada,
                    gastos: gastosDelPeriodo,
                    almacen: informeAlmacen,
                  }
                : null
            }
          />
        </div>
      </div>

      {actual.data && !actual.data.conRealizado && (
        <Nota>
          Falta aplicar la migración 20261027100000_pedidos_realizado.sql: sin ella no se sabe qué
          día se realizó cada pedido, así que los metros realizados salen a cero.
        </Nota>
      )}

      {error ? (
        <ErrorPestana que="los datos del Resumen" error={error} />
      ) : !resumen ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <TituloPagina numero={1} titulo="Resumen" />
            <Esquema
              r={resumen}
              anterior={resumenPrevio}
              frente={comparacion?.etiqueta}
              metrosHora={jornada.metros_hora}
            />
          </section>
          <section className="resumen-salto space-y-3">
            <TituloPagina numero={2} titulo="Desglose" etiqueta={etiqueta} />
            <Desglose
              r={resumen}
              ajustes={jornada}
              gastos={gastosDelPeriodo}
              acciones={<RecuperarFechas tiendas={tiendas} />}
            />
          </section>
        </>
      )}
    </div>
  );
}

type DatosBoton = Omit<DatosInformeSocios, "empresa" | "generado">;

/**
 * Descarga el informe de los socios en PDF: el mismo periodo y las mismas
 * cifras que se ven, con el formato de la casa.
 */
function BotonInforme({ datos }: { datos: DatosBoton | null }) {
  const generar = useMutation({
    mutationFn: async (d: DatosBoton) => {
      const [{ generarInformeSocios }, empresa] = await Promise.all([
        import("@/lib/pdf-informe-socios"),
        leerEmpresa(),
      ]);
      const blob = await generarInformeSocios({
        ...d,
        empresa: {
          razon_social: empresa?.razon_social?.trim() || "DTI S.L.",
          cif: empresa?.cif ?? null,
        },
        generado: new Date(),
      });
      descargarBlob(
        `Informe socios ${d.resumen.desde}${d.resumen.hasta !== d.resumen.desde ? ` a ${d.resumen.hasta}` : ""}.pdf`,
        blob,
      );
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo generar el informe"),
  });
  return (
    <Button
      size="sm"
      className="max-md:w-full"
      disabled={!datos || generar.isPending}
      onClick={() => datos && generar.mutate(datos)}
    >
      {generar.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileText className="h-4 w-4" />
      )}
      Informe PDF para socios
    </Button>
  );
}

function TituloPagina({
  numero,
  titulo,
  etiqueta,
}: {
  numero: number;
  titulo: string;
  /** En la página 2 impresa, para que se entienda suelta. */
  etiqueta?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b pb-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {numero}
      </span>
      <h3 className="text-sm font-semibold uppercase tracking-wider">{titulo}</h3>
      {etiqueta && (
        <span className="hidden text-sm text-muted-foreground print:inline">· {etiqueta}</span>
      )}
    </div>
  );
}

/**
 * Los pedidos web enviados antes de guardar la fecha de realizado: se le
 * pregunta a cada tienda WooCommerce cuándo se completaron. Solo administradores.
 */
function RecuperarFechas({ tiendas }: { tiendas: readonly Tienda[] }) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const recuperarFn = useServerFn(recuperarRealizadoWoo);
  const recuperar = useMutation({
    mutationFn: async () => {
      let actualizados = 0;
      for (const t of tiendas) {
        let desde = 0;
        for (;;) {
          const r = await recuperarFn({ data: { tienda_id: t.id, desde } });
          actualizados += r.actualizados;
          if (r.siguiente == null) break;
          desde = r.siguiente;
        }
      }
      return actualizados;
    },
    onSuccess: (n) => {
      toast.success(
        n ? `${n} fechas recuperadas de WooCommerce` : "WooCommerce no tenía más fechas",
      );
      queryClient.invalidateQueries({ queryKey: ["gerencia"] });
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudieron recuperar las fechas"),
  });
  if (!isAdmin || tiendas.length === 0) return null;
  return (
    <div className="no-imprimir pt-1">
      <Button
        variant="outline"
        size="sm"
        disabled={recuperar.isPending}
        onClick={() => recuperar.mutate()}
      >
        {recuperar.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <DownloadCloud className="h-4 w-4" />
        )}
        Recuperar fechas de WooCommerce
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        Los manuales y el textil se ponen a mano en Pedidos, tocando la fecha bajo el estado.
      </p>
    </div>
  );
}
