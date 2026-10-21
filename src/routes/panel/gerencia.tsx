import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo } from "react";
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
import {
  esGrupo,
  gastosDelGrupo,
  GRUPOS,
  pedidosDocumentados,
  pendienteDocumentar,
  ventasDelGrupo,
  type Grupo,
} from "@/dominio/grupos";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { gastosConCompras } from "@/dominio/compras";
import {
  AJUSTES_POR_DEFECTO,
  aplicarAjustesVentas,
  CANALES,
  filtrarCobrosGerencia,
  filtrarPendientesGerencia,
  filtrarVentas,
  type Canal,
  type FiltroGerencia,
  webSinPagar,
} from "@/dominio/gerencia";

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

const SIN_AJUSTES = { ajustes: AJUSTES_POR_DEFECTO, gastos: [], objetivos: [] };

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

  const ventas = useVentasGerencia(rango);
  const ventasPrevias = useVentasGerencia(previo);
  const cobros = useCobrosPeriodo(rango, "cobro");
  const cobrosPrevios = useCobrosPeriodo(previo, "cobro");
  const pendientes = usePendientesCobro();
  const caja = useCajaPeriodo(rango);
  const banco = useBancoPeriodo(rango);
  const costeMetro = useCosteMetroActual();
  const ajustes = useAjustesGerencia();
  // Las facturas de compra que cuestan como un gasto (y los recibos de los gastos fijos).
  const compras = useComprasGerencia();
  // Qué pedidos tienen factura o ticket: de ahí salen los grupos A y B.
  const docs = useDocumentosDePedidos(ventas.data ?? []);
  const docsPrevios = useDocumentosDePedidos(ventasPrevias.data ?? []);
  const { data: tiendas = [] } = useTiendas();
  const hoy = useMemo(() => new Date(), []);

  const datos: DatosGerencia | null = useMemo(() => {
    // Si los ajustes no se pueden leer, Gerencia sigue con los de siempre.
    const aj = ajustes.data ?? (ajustes.isError ? SIN_AJUSTES : null);
    if (!ventas.data || !aj) return null;
    // Sin las compras, el beneficio saldría mejor de lo que es: se espera.
    if (!compras.data && !compras.isError) return null;
    const gastos = gastosConCompras(aj.gastos, compras.data ?? []);
    // Para separar A y B hacen falta los documentos; sin ellos, todavía no.
    if (grupo !== "total" && (!docs.data || (periodo.comparacion && !docsPrevios.data))) {
      return null;
    }
    const a = aj.ajustes;
    const delPeriodo = filtrarVentas(ventas.data, filtro);
    const todas = aplicarAjustesVentas(delPeriodo, a);
    const documentados = pedidosDocumentados(docs.data ?? []);
    const documentadosPrevios = pedidosDocumentados(docsPrevios.data ?? []);
    return {
      grupo,
      ventasTodas: todas,
      documentados: docs.data ? documentados : null,
      pendiente: docs.data ? pendienteDocumentar(todas, documentados) : null,
      filtro,
      seleccion: periodo.seleccion,
      rango,
      comparacion: periodo.comparacion,
      costeMetro,
      tiendas,
      ventas: ventasDelGrupo(todas, documentados, grupo),
      ventasPrevias: ventasDelGrupo(
        aplicarAjustesVentas(filtrarVentas(ventasPrevias.data ?? [], filtro), a),
        documentadosPrevios,
        grupo,
      ),
      webSinPagar: webSinPagar(delPeriodo),
      ajustes: a,
      gastos,
      gastosDelGrupo: gastosDelGrupo(gastos, grupo),
      objetivos: aj.objetivos,
      cobros: filtrarCobrosGerencia(cobros.data?.cobros ?? [], filtro),
      cobrosPrevios: filtrarCobrosGerencia(cobrosPrevios.data?.cobros ?? [], filtro),
      cobrosDisponibles: cobros.data?.disponible ?? false,
      pendientes: filtrarPendientesGerencia(pendientes.data?.pedidos ?? [], filtro),
      pendientesDisponibles: pendientes.data?.disponible ?? false,
      caja: caja.data?.movimientos,
      banco: banco.data,
      hoy,
    };
  }, [
    ventas.data,
    ventasPrevias.data,
    docs.data,
    docsPrevios.data,
    grupo,
    ajustes.data,
    ajustes.isError,
    compras.data,
    compras.isError,
    cobros.data,
    cobrosPrevios.data,
    pendientes.data,
    caja.data,
    banco.data,
    filtro,
    periodo.seleccion,
    periodo.comparacion,
    rango,
    costeMetro,
    tiendas,
    hoy,
  ]);

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
    ventasPrevias.isPlaceholderData ||
    cobros.isPlaceholderData ||
    cobrosPrevios.isPlaceholderData;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold">Gerencia</h1>
          <div className="flex flex-wrap items-center justify-end gap-2 max-md:w-full">
            <PendienteDocumentar
              pendiente={deAntes ? null : (datos?.pendiente ?? null)}
              tiendas={tiendas}
            />
            <BotonResumenDiario
              tiendas={tiendas}
              gastos={datos?.gastos ?? null}
              objetivos={datos?.objetivos ?? ajustes.data?.objetivos ?? []}
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
        <TabsList className="max-md:w-full max-md:justify-start max-md:overflow-x-auto">
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
