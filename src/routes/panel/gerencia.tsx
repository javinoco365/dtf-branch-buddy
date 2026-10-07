import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelectFiltro } from "@/components/filtros/Filtros";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { Resumen } from "@/components/gerencia/Resumen";
import { Ventas } from "@/components/gerencia/Ventas";
import { Tesoreria } from "@/components/gerencia/Tesoreria";
import { Ajustes } from "@/components/gerencia/Ajustes";
import type { DatosGerencia } from "@/components/gerencia/destinos";
import { useFiltrosUrl, usePeriodoUrl } from "@/lib/filtros-url";
import { useCobrosPeriodo, useTiendas } from "@/lib/periodo";
import {
  useAjustesGerencia,
  useBancoPeriodo,
  useCajaPeriodo,
  useCosteMetroActual,
  usePendientesCobro,
  useVentasGerencia,
} from "@/lib/gerencia";
import { PERIODOS_CUADRO } from "@/dominio/periodos";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
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

export const Route = createFileRoute("/panel/gerencia")({
  head: () => ({ meta: [{ title: "Gerencia · DTF Culture" }] }),
  component: Gerencia,
});

const FILTROS_GERENCIA = { pestana: "resumen", tienda: "todas", canal: "todos" };

const SIN_AJUSTES = { ajustes: AJUSTES_POR_DEFECTO, gastos: [], objetivos: [] };

const esCanal = (v: string): v is Canal => CANALES.some((c) => c.valor === v);

function Gerencia() {
  // Todo en la dirección: el periodo, los filtros y la pestaña. Así un enlace
  // abre Gerencia exactamente como estaba.
  const periodo = usePeriodoUrl("mes");
  const { valores: f, cambiar } = useFiltrosUrl(FILTROS_GERENCIA);
  const filtro: FiltroGerencia = useMemo(
    () => ({ tienda: f.tienda, canal: esCanal(f.canal) ? f.canal : "todos" }),
    [f.tienda, f.canal],
  );

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
  const { data: tiendas = [] } = useTiendas();
  const hoy = useMemo(() => new Date(), []);

  const datos: DatosGerencia | null = useMemo(() => {
    // Si los ajustes no se pueden leer, Gerencia sigue con los de siempre.
    const aj = ajustes.data ?? (ajustes.isError ? SIN_AJUSTES : null);
    if (!ventas.data || !aj) return null;
    const a = aj.ajustes;
    const delPeriodo = filtrarVentas(ventas.data, filtro);
    return {
      filtro,
      seleccion: periodo.seleccion,
      rango,
      comparacion: periodo.comparacion,
      costeMetro,
      tiendas,
      ventas: aplicarAjustesVentas(delPeriodo, a),
      ventasPrevias: aplicarAjustesVentas(filtrarVentas(ventasPrevias.data ?? [], filtro), a),
      webSinPagar: webSinPagar(delPeriodo),
      ajustes: a,
      gastos: aj.gastos,
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
    ajustes.data,
    ajustes.isError,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gerencia</h1>
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
        </CardContent>
      </Card>

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
          <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
        </TabsList>

        <TabsContent value="ajustes" className="mt-4">
          <Ajustes />
        </TabsContent>

        {enAjustes ? null : !datos ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[124px] w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <TabsContent value="resumen" className="mt-4">
              <Resumen d={datos} />
            </TabsContent>
            <TabsContent value="ventas" className="mt-4">
              <Ventas d={datos} />
            </TabsContent>
            <TabsContent value="tesoreria" className="mt-4">
              <Tesoreria d={datos} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
