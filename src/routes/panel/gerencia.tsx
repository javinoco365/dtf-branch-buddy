import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelectFiltro } from "@/components/filtros/Filtros";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { PendienteDocumentar } from "@/components/gerencia/PendienteDocumentar";
import { BotonResumenDiario } from "@/components/gerencia/resumen-diario/BotonResumenDiario";
import type { DatosGerencia } from "@/components/gerencia/destinos";
import { useFiltrosUrl, usePeriodoUrl } from "@/lib/filtros-url";
import { useCobrosPeriodo, useTiendas } from "@/lib/periodo";
import { AvisoActualizando } from "@/components/AvisoActualizando";
import { propsDatosDeAntes } from "@/lib/datos-de-antes";
import {
  useAjustesGerencia,
  useBancoPeriodo,
  useComprasGerencia,
  useDocumentosDePedidos,
  useCajaPeriodo,
  useCosteMetroActual,
  usePendientesCobro,
  useVentasGerencia,
} from "@/lib/gerencia";
import { PERIODOS_CUADRO } from "@/dominio/periodos";
import { esGrupo, GRUPOS, type Grupo } from "@/dominio/grupos";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import {
  esPestanaGerencia,
  FUENTES_DE_PESTANA,
  FUENTES_GERENCIA,
  montarDatosGerencia,
  montarGastosGerencia,
  montarPendienteDocumentar,
  type FuenteGerencia,
} from "@/dominio/gerencia-datos";
import { CANALES, type Canal, type FiltroGerencia } from "@/dominio/gerencia";

// Cada pestaña en su propio trozo, cargado al abrirla: antes se descargaban
// las once (y la librería de gráficas) para enseñar solo una. Estos módulos se
// importan solo así, con import() (ver importaciones-mixtas.test.ts).
const CARGAR_PESTANA = {
  resumen: () => import("@/components/gerencia/Resumen"),
  ventas: () => import("@/components/gerencia/Ventas"),
  tesoreria: () => import("@/components/gerencia/Tesoreria"),
  clientes: () => import("@/components/gerencia/Clientes"),
  comercial: () => import("@/components/gerencia/Comercial"),
  produccion: () => import("@/components/gerencia/Produccion"),
  margen: () => import("@/components/gerencia/Margen"),
  resultados: () => import("@/components/gerencia/Resultados"),
  fiscal: () => import("@/components/gerencia/Fiscal"),
  textil: () => import("@/components/gerencia/Textil"),
  ajustes: () => import("@/components/gerencia/Ajustes"),
} as const;
const Resumen = lazy(() => CARGAR_PESTANA.resumen().then((m) => ({ default: m.Resumen })));
const Ventas = lazy(() => CARGAR_PESTANA.ventas().then((m) => ({ default: m.Ventas })));
const Tesoreria = lazy(() => CARGAR_PESTANA.tesoreria().then((m) => ({ default: m.Tesoreria })));
const Clientes = lazy(() => CARGAR_PESTANA.clientes().then((m) => ({ default: m.Clientes })));
const Comercial = lazy(() => CARGAR_PESTANA.comercial().then((m) => ({ default: m.Comercial })));
const Produccion = lazy(() => CARGAR_PESTANA.produccion().then((m) => ({ default: m.Produccion })));
const Margen = lazy(() => CARGAR_PESTANA.margen().then((m) => ({ default: m.Margen })));
const Resultados = lazy(() => CARGAR_PESTANA.resultados().then((m) => ({ default: m.Resultados })));
const Fiscal = lazy(() => CARGAR_PESTANA.fiscal().then((m) => ({ default: m.Fiscal })));
const Textil = lazy(() => CARGAR_PESTANA.textil().then((m) => ({ default: m.Textil })));
const Ajustes = lazy(() => CARGAR_PESTANA.ajustes().then((m) => ({ default: m.Ajustes })));

// Resumen es la que se abre por defecto: se pide en cuanto se carga el código
// de Gerencia (también al pasar el ratón por el enlace del menú), sin esperar
// a montar la pantalla.
if (typeof window !== "undefined") void CARGAR_PESTANA.resumen().catch(() => undefined);

/** Mientras llega el código de una pestaña: lo mismo que mientras llegan los datos. */
function EsqueletoPestana() {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
      ))}
    </div>
  );
}

export const Route = createFileRoute("/panel/gerencia")({
  head: () => ({ meta: [{ title: "Gerencia · DTF Culture" }] }),
  component: Gerencia,
});

const FILTROS_GERENCIA = { pestana: "resumen", tienda: "todas", canal: "todos", grupo: "total" };

const SIN_COBROS = { disponible: false, cobros: [] };
const SIN_PENDIENTES = { disponible: false, pedidos: [] };

/** Ajustes no lee nada de lo de las pestañas. */
const SIN_FUENTES: readonly FuenteGerencia[] = [];

const esCanal = (v: string): v is Canal => CANALES.some((c) => c.valor === v);

function Gerencia() {
  // Todo en la dirección: el periodo, los filtros y la pestaña. Así un enlace
  // abre Gerencia exactamente como estaba.
  const periodo = usePeriodoUrl("mes");
  const { valores: f, cambiar } = useFiltrosUrl(FILTROS_GERENCIA);
  // El código de la pestaña abierta se pide ya, a la vez que los datos, y no
  // después de que lleguen (sería otra espera en cadena).
  useEffect(() => {
    const cargar = CARGAR_PESTANA[f.pestana as keyof typeof CARGAR_PESTANA];
    void cargar?.().catch(() => undefined);
  }, [f.pestana]);
  const filtro: FiltroGerencia = useMemo(
    () => ({ tienda: f.tienda, canal: esCanal(f.canal) ? f.canal : "todos" }),
    [f.tienda, f.canal],
  );
  const grupo: Grupo = esGrupo(f.grupo) ? f.grupo : "total";

  // Sin «todo» en la lista, siempre hay rango. Sin comparación, un rango
  // vacío: las consultas no pueden ser condicionales.
  const rango = periodo.rango!;
  const previo = periodo.comparacion?.previo ?? { desde: rango.hasta, hasta: rango.desde };

  // Cada pestaña pide solo lo que enseña (FUENTES_DE_PESTANA), con las mismas
  // claves de caché: al volver a una pestaña ya leída, sale al momento. Las
  // ventas, sus documentos y los ajustes se piden siempre: de ellos sale la
  // insignia de lo pendiente de documentar, que está en todas.
  const fuentes = esPestanaGerencia(f.pestana)
    ? FUENTES_DE_PESTANA[f.pestana]
    : f.pestana === "ajustes"
      ? SIN_FUENTES
      : FUENTES_GERENCIA;
  const pide = (fuente: FuenteGerencia) => fuentes.includes(fuente);
  // El Resumen diario necesita los gastos con sus compras: se piden al abrirlo.
  const [resumenAbierto, setResumenAbierto] = useState(false);

  const ventas = useVentasGerencia(rango);
  const ventasPrevias = useVentasGerencia(previo, { activo: pide("ventasPrevias") });
  const cobros = useCobrosPeriodo(rango, "cobro", undefined, { activo: pide("cobros") });
  const cobrosPrevios = useCobrosPeriodo(previo, "cobro", undefined, {
    activo: pide("cobrosPrevios"),
  });
  const pendientes = usePendientesCobro({ activo: pide("pendientes") });
  const caja = useCajaPeriodo(rango, { activo: pide("caja") });
  const banco = useBancoPeriodo(rango, { activo: pide("banco") });
  const costeMetro = useCosteMetroActual({ activo: pide("costeMetro") });
  const ajustes = useAjustesGerencia();
  // Las facturas de compra que cuestan como un gasto (y los recibos de los gastos fijos).
  const compras = useComprasGerencia({ activo: pide("compras") || resumenAbierto });
  // Qué pedidos tienen factura o ticket: de ahí salen los grupos A y B.
  const docs = useDocumentosDePedidos(ventas.data ?? []);
  const docsPrevios = useDocumentosDePedidos(ventasPrevias.data ?? [], {
    activo: pide("ventasPrevias"),
  });
  const { data: tiendas = [] } = useTiendas();
  const hoy = useMemo(() => new Date(), []);

  // Lo que no se pide no entra: una consulta apagada puede traer aún los
  // datos de otro periodo para enseñar mientras tanto.
  const previasLeidas = pide("ventasPrevias") ? ventasPrevias.data : undefined;
  const docsPreviosLeidos = pide("ventasPrevias") ? docsPrevios.data : undefined;
  // Si no se pueden leer, lo mismo que sin datos (vacío y «—»), pero ya
  // leídos: así el Resumen distingue «cargando» de «no hay».
  const cobrosLeidos = pide("cobros")
    ? (cobros.data ?? (cobros.isError ? SIN_COBROS : undefined))
    : undefined;
  const cobrosPreviosLeidos = pide("cobrosPrevios") ? cobrosPrevios.data : undefined;
  const pendientesLeidos = pide("pendientes")
    ? (pendientes.data ?? (pendientes.isError ? SIN_PENDIENTES : undefined))
    : undefined;
  const cajaLeida = pide("caja") ? caja.data : undefined;
  const bancoLeido = pide("banco") ? banco.data : undefined;

  const datos: DatosGerencia | null = useMemo(
    () =>
      montarDatosGerencia(
        {
          grupo,
          filtro,
          seleccion: periodo.seleccion,
          rango,
          comparacion: periodo.comparacion,
          costeMetro,
          tiendas,
          hoy,
          ventas: ventas.data,
          ventasPrevias: previasLeidas,
          docs: docs.data,
          docsPrevios: docsPreviosLeidos,
          ajustes: { data: ajustes.data, isError: ajustes.isError },
          compras: { data: compras.data, isError: compras.isError },
          cobros: cobrosLeidos,
          cobrosPrevios: cobrosPreviosLeidos,
          pendientes: pendientesLeidos,
          caja: cajaLeida,
          banco: bancoLeido,
        },
        fuentes,
      ),
    [
      fuentes,
      ventas.data,
      previasLeidas,
      docs.data,
      docsPreviosLeidos,
      grupo,
      ajustes.data,
      ajustes.isError,
      compras.data,
      compras.isError,
      cobrosLeidos,
      cobrosPreviosLeidos,
      pendientesLeidos,
      cajaLeida,
      bancoLeido,
      filtro,
      periodo.seleccion,
      periodo.comparacion,
      rango,
      costeMetro,
      tiendas,
      hoy,
    ],
  );
  // La insignia y el Resumen diario, sin esperar a lo que pide la pestaña.
  const pendiente = useMemo(
    () =>
      montarPendienteDocumentar({
        ventas: ventas.data,
        docs: docs.data,
        ajustes: { data: ajustes.data, isError: ajustes.isError },
        filtro,
      }),
    [ventas.data, docs.data, ajustes.data, ajustes.isError, filtro],
  );
  const gastos = useMemo(
    () =>
      montarGastosGerencia({
        ajustes: { data: ajustes.data, isError: ajustes.isError },
        compras: { data: compras.data, isError: compras.isError },
      }),
    [ajustes.data, ajustes.isError, compras.data, compras.isError],
  );

  const opcionesTienda = [
    { valor: "todas", etiqueta: "Todas las tiendas" },
    ...tiendas.map((t) => ({ valor: t.id, etiqueta: t.nombre })),
    { valor: TIENDA_TEXTIL.id, etiqueta: TIENDA_TEXTIL.nombre },
  ];
  const opcionesCanal = [
    { valor: "todos", etiqueta: "Todos los canales" },
    ...CANALES.map((c) => ({ valor: c.valor, etiqueta: c.etiqueta })),
  ];
  // Los ajustes no dependen del periodo ni de los filtros.
  const enAjustes = f.pestana === "ajustes";
  // Mientras llegan las del periodo nuevo se ven las del anterior: se avisa,
  // se atenúan y no se puede actuar sobre ellas.
  const deAntes =
    ventas.isPlaceholderData ||
    (pide("ventasPrevias") && ventasPrevias.isPlaceholderData) ||
    (pide("cobros") && cobros.isPlaceholderData) ||
    (pide("cobrosPrevios") && cobrosPrevios.isPlaceholderData);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold">Gerencia</h1>
          <div className="flex flex-wrap items-center justify-end gap-2 max-md:w-full">
            <PendienteDocumentar
              pendiente={ventas.isPlaceholderData ? null : pendiente}
              tiendas={tiendas}
            />
            <BotonResumenDiario
              tiendas={tiendas}
              gastos={gastos}
              objetivos={ajustes.data?.objetivos ?? []}
              alCambiarAbierto={setResumenAbierto}
            />
          </div>
        </div>
        <p className="text-muted-foreground">
          Toda la empresa: tiendas y textil. El ⓘ de cada cifra explica qué es y cómo se calcula
          (con el ratón encima, o tocándolo en el móvil).
        </p>
      </div>

      <Card className={enAjustes ? "hidden" : undefined}>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />
          <SelectFiltro
            etiqueta="Tienda"
            valor={filtro.tienda}
            alCambiar={(tienda) => cambiar({ tienda })}
            opciones={opcionesTienda}
            ancho="w-[190px] max-md:w-[calc(50%-0.25rem)]"
          />
          <SelectFiltro
            etiqueta="Canal"
            valor={filtro.canal}
            alCambiar={(canal) => cambiar({ canal })}
            opciones={opcionesCanal}
            ancho="w-[170px] max-md:w-[calc(50%-0.25rem)]"
          />
          <SelectFiltro
            etiqueta="Números"
            valor={grupo}
            alCambiar={(g) => cambiar({ grupo: g })}
            opciones={GRUPOS.map((g) => ({ valor: g.valor, etiqueta: g.etiqueta }))}
            ancho="w-[190px] max-md:w-full"
          />
        </CardContent>
      </Card>

      <AvisoActualizando activo={deAntes && !enAjustes} />

      {ventas.error && !enAjustes && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se han podido cargar los pedidos: {ventas.error.message}
          </CardContent>
        </Card>
      )}

      <Tabs value={f.pestana} onValueChange={(pestana) => cambiar({ pestana })}>
        <TabsList className="max-md:w-full max-md:justify-start max-md:overflow-x-auto md:max-lg:h-auto md:max-lg:flex-wrap md:max-lg:justify-start">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="tesoreria">Cobros y tesorería</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="comercial">Comercial</TabsTrigger>
          <TabsTrigger value="produccion">Producción</TabsTrigger>
          <TabsTrigger value="margen">Margen</TabsTrigger>
          <TabsTrigger value="resultados">Resultados</TabsTrigger>
          <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
          <TabsTrigger value="textil">Textil</TabsTrigger>
          <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
        </TabsList>

        <TabsContent value="ajustes" className="mt-4">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <Ajustes />
          </Suspense>
        </TabsContent>

        {enAjustes ? null : !datos ? (
          <EsqueletoPestana />
        ) : (
          <div {...propsDatosDeAntes(deAntes)}>
            <Suspense fallback={<EsqueletoPestana />}>
              <TabsContent value="resumen" className="mt-4">
                <Resumen d={datos} />
              </TabsContent>
              <TabsContent value="ventas" className="mt-4">
                <Ventas d={datos} />
              </TabsContent>
              <TabsContent value="tesoreria" className="mt-4">
                <Tesoreria d={datos} />
              </TabsContent>
              <TabsContent value="clientes" className="mt-4">
                <Clientes d={datos} />
              </TabsContent>
              <TabsContent value="comercial" className="mt-4">
                <Comercial d={datos} />
              </TabsContent>
              <TabsContent value="produccion" className="mt-4">
                <Produccion d={datos} />
              </TabsContent>
              <TabsContent value="margen" className="mt-4">
                <Margen d={datos} />
              </TabsContent>
              <TabsContent value="resultados" className="mt-4">
                <Resultados d={datos} />
              </TabsContent>
              <TabsContent value="fiscal" className="mt-4">
                <Fiscal d={datos} />
              </TabsContent>
              <TabsContent value="textil" className="mt-4">
                <Textil d={datos} />
              </TabsContent>
            </Suspense>
          </div>
        )}
      </Tabs>
    </div>
  );
}
