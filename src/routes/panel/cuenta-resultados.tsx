import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { FileChartColumn } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EstadoVacio } from "@/components/EstadoVacio";
import { Explicacion } from "@/components/Explicacion";
import { AvisoActualizando } from "@/components/AvisoActualizando";
import { FiltrosPlegables, SelectFiltro } from "@/components/filtros/Filtros";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { SelectorLinea } from "@/components/filtros/SelectorLinea";
import { propsDatosDeAntes } from "@/lib/datos-de-antes";
import { useFiltrosUrl, usePeriodoUrl } from "@/lib/filtros-url";
import { useTiendas } from "@/lib/periodo";
import { useCuentaResultados } from "@/lib/cuenta";
import { eur, metros, numero, numeroJusto, porcentaje } from "@/lib/format";
import { mensajeDeError } from "@/lib/errores";
import {
  esSepararPor,
  FILAS_DINERO,
  FILAS_RESULTADOS,
  OPCIONES_SEPARAR,
  separarCuenta,
  sobreVentasNetas,
  variacionCifra,
  type Cifra,
  type Concepto,
  type Cuenta,
} from "@/dominio/cuenta";
import { definicionDeConcepto } from "@/dominio/definiciones";
import { esFiltroLinea, ETIQUETA_FILTRO_LINEA } from "@/dominio/por-linea";
import { formaVariacion } from "@/dominio/kpis";
import { etiquetaPeriodo, PERIODOS_CUADRO } from "@/dominio/periodos";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";

export const Route = createFileRoute("/panel/cuenta-resultados")({
  head: () => ({ meta: [{ title: "Cuenta de resultados · DTF Culture" }] }),
  component: CuentaResultados,
});

const FILTROS = { tienda: "todas", linea: "todo", separar: "nada" };

function CuentaResultados() {
  // Todo en la dirección: un enlace abre la cuenta exactamente como estaba.
  const periodo = usePeriodoUrl("mes");
  const { valores: f, cambiar } = useFiltrosUrl(FILTROS);
  const linea = esFiltroLinea(f.linea) ? f.linea : "todo";
  const separar = esSepararPor(f.separar) ? f.separar : "nada";
  const filtro = useMemo(() => ({ tienda: f.tienda, linea }), [f.tienda, linea]);
  const { data: tiendas = [] } = useTiendas();

  // Sin «todo» en la lista, siempre hay rango.
  const rango = periodo.rango!;
  const comparacion = periodo.comparacion;
  // Separada en columnas no se compara: cada columna es ya una cuenta.
  const lectura = useCuentaResultados({
    rango,
    previo: separar === "nada" ? (comparacion?.previo ?? null) : null,
    filtro,
  });
  const { cuenta, previa, entrada, estructuraDe, documentadoDe } = lectura;

  const columnas = useMemo(
    () =>
      entrada && separar !== "nada"
        ? separarCuenta(entrada, separar, { tiendas, rango, estructuraDe, documentadoDe })
        : [],
    [entrada, separar, tiendas, rango, estructuraDe, documentadoDe],
  );

  const opcionesTienda = [
    { valor: "todas", etiqueta: "Todas las tiendas" },
    ...tiendas.map((t) => ({ valor: t.id, etiqueta: t.nombre })),
    { valor: TIENDA_TEXTIL.id, etiqueta: "Textil" },
  ];
  const resumenFiltros = [
    etiquetaPeriodo(periodo.seleccion),
    opcionesTienda.find((o) => o.valor === f.tienda)?.etiqueta,
    linea !== "todo" ? ETIQUETA_FILTRO_LINEA[linea] : null,
    separar !== "nada"
      ? `Separado por ${OPCIONES_SEPARAR.find((o) => o.valor === separar)?.etiqueta.toLowerCase()}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sinDatos =
    !!cuenta &&
    cuenta.pedidos === 0 &&
    (cuenta.devoluciones.valor ?? 0) === 0 &&
    (cuenta.gastos_estructura.valor ?? 0) === 0;
  const frente = separar === "nada" ? comparacion?.etiqueta : undefined;

  return (
    <div className="space-y-6">
      <CabeceraPantalla subtitulo="De lo que pagan los clientes a lo que le queda a la empresa. Sin IVA, salvo las ventas con IVA y el bloque de dinero. El ⓘ de cada fila dice qué es y cómo se calcula." />

      <FiltrosPlegables resumen={resumenFiltros}>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <SelectorPeriodo periodo={periodo} tipos={PERIODOS_CUADRO} conComparar />
            <SelectFiltro
              etiqueta="Tienda"
              valor={f.tienda}
              alCambiar={(tienda) => cambiar({ tienda })}
              opciones={opcionesTienda}
              ancho="w-[190px] max-md:w-[calc(50%-0.25rem)]"
            />
            <SelectFiltro
              etiqueta="Separar por"
              valor={separar}
              alCambiar={(s) => cambiar({ separar: s })}
              opciones={OPCIONES_SEPARAR.map((o) => ({
                valor: o.valor,
                etiqueta:
                  o.valor === "nada" ? "Sin separar" : `Separar por ${o.etiqueta.toLowerCase()}`,
              }))}
              ancho="w-[190px] max-md:w-[calc(50%-0.25rem)]"
            />
            <SelectorLinea
              valor={linea}
              alCambiar={(l) => cambiar({ linea: l })}
              className="max-md:w-full"
            />
          </CardContent>
        </Card>
      </FiltrosPlegables>

      <AvisoActualizando activo={lectura.deAntes} />

      {lectura.error && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-destructive">
            <span>No se ha podido cargar la cuenta: {mensajeDeError(lectura.error)}</span>
            <Button size="sm" variant="outline" onClick={lectura.reintentar}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {lectura.cargando && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      )}

      {sinDatos && (
        <EstadoVacio
          icono={FileChartColumn}
          titulo="Nada que contar en este periodo"
          descripcion="Sin pedidos, devoluciones ni gastos con estos filtros. Cambia de periodo o de tienda."
        />
      )}

      {cuenta && !sinDatos && (
        <div {...propsDatosDeAntes(lectura.deAntes, "space-y-6")}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resultados</CardTitle>
              <p className="text-xs text-muted-foreground">
                Lo marcado como «Estimado» lleva algo supuesto; «—», lo que no se puede saber con
                estos filtros.
              </p>
              <dl className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-sm">
                <Dato titulo="Pedidos" valor={numero(cuenta.pedidos, 0)} />
                <Dato
                  titulo="Ticket medio"
                  valor={cuenta.ticketMedio === null ? "—" : eur(cuenta.ticketMedio)}
                  nota="Ventas netas ÷ pedidos, sin IVA"
                />
                <Dato titulo="Metros DTF" valor={metros(cuenta.metros)} />
                {cuenta.metrosUv > 0 && (
                  <Dato titulo="Metros DTF UV" valor={metros(cuenta.metrosUv)} />
                )}
                <Dato
                  titulo="Cancelados"
                  valor={numero(cuenta.cancelados, 0)}
                  nota="No cuentan en ninguna cifra"
                />
              </dl>
            </CardHeader>
            <CardContent>
              {separar === "nada" ? (
                <TablaPeriodo cuenta={cuenta} previa={previa} frente={frente} />
              ) : (
                <TablaColumnas cuenta={cuenta} columnas={columnas} porMes={separar === "mes"} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Dinero</CardTitle>
              <p className="text-xs text-muted-foreground">
                Con IVA: es dinero de verdad. Lo aportado por los socios no es un ingreso y no sale
                aquí.
              </p>
            </CardHeader>
            <CardContent>
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Periodo</TableHead>
                    {frente && <TableHead className="text-right">{frente}</TableHead>}
                    {frente && <TableHead className="text-right">Variación</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FILAS_DINERO.map((c) => (
                    <TableRow key={c.clave}>
                      <TableCell>
                        <NombreFila c={c} />
                        {c.clave !== "cobrado" && (
                          <span className="block text-xs text-muted-foreground">
                            Hoy, sea del periodo que sea
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ValorCifra cifra={cuenta[c.clave]} />
                      </TableCell>
                      {frente && (
                        <TableCell className="text-right">
                          {c.clave === "cobrado" ? <ValorCifra cifra={previa?.cobrado} /> : "—"}
                        </TableCell>
                      )}
                      {frente && (
                        <TableCell className="text-right tabular-nums">
                          {c.clave === "cobrado"
                            ? textoVariacion(variacionCifra(cuenta.cobrado, previa?.cobrado))
                            : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground">
            Los impuestos por trimestre, el IVA y la numeración de facturas siguen en{" "}
            <Link
              to="/panel/gerencia"
              search={{ pestana: "fiscal" } as never}
              className="text-primary hover:underline"
            >
              Gerencia › Fiscal
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

/** Un dato suelto del periodo: «Pedidos 42». */
function Dato({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex items-baseline gap-1.5" title={nota}>
      <dt className="text-muted-foreground">{titulo}</dt>
      <dd className="font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

/** El nombre de la fila, con su signo en la cascada y su ⓘ. */
function NombreFila({ c }: { c: Concepto }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={c.destacado ? "font-semibold" : "text-muted-foreground"}>
        {c.signo === "−" || c.signo === "+" ? `${c.signo} ` : ""}
        {c.nombre}
      </span>
      <Explicacion titulo={c.nombre} definicion={definicionDeConcepto(c.clave)} />
    </span>
  );
}

/** Una cifra: su valor, «—» con el motivo, o la marca de estimado. */
function ValorCifra({
  cifra,
  negrita,
  breve,
}: {
  cifra: Cifra | null | undefined;
  negrita?: boolean;
  /** Sin el motivo debajo (en las columnas, donde se repetiría): al pasar el ratón. */
  breve?: boolean;
}) {
  if (!cifra) return <span className="text-muted-foreground">—</span>;
  if (cifra.valor === null) {
    return (
      <span className="inline-flex flex-col items-end" title={cifra.falta}>
        <span className="text-muted-foreground">—</span>
        {cifra.falta && !breve && (
          <span className="max-w-[16rem] text-right text-xs text-muted-foreground">
            {cifra.falta}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end">
      <span
        className={`tabular-nums ${negrita ? "font-semibold" : ""} ${cifra.valor < 0 ? "text-status-cancelado" : ""}`}
      >
        {eur(cifra.valor)}
      </span>
      {cifra.estimado && (
        <span className="text-xs text-status-pendiente" title={cifra.nota}>
          Estimado
        </span>
      )}
    </span>
  );
}

/** «+12,4 %», «−3,0 %» o «×61»; «—» sin datos para comparar. */
function textoVariacion(delta: number | null): string {
  if (delta === null) return "—";
  const forma = formaVariacion(delta);
  return forma.tipo === "veces"
    ? `×${numeroJusto(forma.valor, 1)}`
    : `${delta >= 0 ? "+" : "−"}${numero(forma.valor, 1)}\u00A0%`;
}

/** La cascada del periodo, frente al anterior, con el peso de cada fila en las ventas netas. */
function TablaPeriodo({
  cuenta,
  previa,
  frente,
}: {
  cuenta: Cuenta;
  previa: Cuenta | null;
  frente?: string;
}) {
  return (
    <Table movil="tarjetas">
      <TableHeader>
        <TableRow>
          <TableHead>Concepto</TableHead>
          <TableHead className="text-right">Periodo</TableHead>
          {frente && <TableHead className="text-right">{frente}</TableHead>}
          {frente && <TableHead className="text-right">Variación</TableHead>}
          <TableHead className="text-right">% s/ventas netas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {FILAS_RESULTADOS.map((c) => {
          const cifra = cuenta[c.clave];
          const pct = c.conIva ? null : sobreVentasNetas(cifra, cuenta.ventas_netas);
          return (
            <TableRow key={c.clave} className={c.destacado ? "bg-muted/30" : undefined}>
              <TableCell>
                <NombreFila c={c} />
                {cifra.estimado && cifra.nota && (
                  <span className="block text-xs text-muted-foreground">{cifra.nota}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <ValorCifra cifra={cifra} negrita={c.destacado} />
              </TableCell>
              {frente && (
                <TableCell className="text-right">
                  <ValorCifra cifra={previa?.[c.clave]} negrita={c.destacado} />
                </TableCell>
              )}
              {frente && (
                <TableCell className="text-right tabular-nums">
                  {textoVariacion(variacionCifra(cifra, previa?.[c.clave]))}
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {pct === null ? "—" : porcentaje(pct)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** La cascada con una columna por tienda, línea o mes, y el total. */
function TablaColumnas({
  cuenta,
  columnas,
  porMes,
}: {
  cuenta: Cuenta;
  columnas: readonly { clave: string; titulo: string; cuenta: Cuenta }[];
  porMes: boolean;
}) {
  if (columnas.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nada que separar con estos filtros.
      </p>
    );
  }
  return (
    <>
      {!porMes && (
        <p className="mb-3 text-xs text-muted-foreground">
          Cada columna, calculada por separado. Los gastos no son de una tienda ni de una línea:
          salen solo en el total.
        </p>
      )}
      <Table movil="tarjetas">
        <TableHeader>
          <TableRow>
            <TableHead>Concepto</TableHead>
            {columnas.map((col) => (
              <TableHead key={col.clave} className="text-right capitalize">
                {col.titulo}
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {FILAS_RESULTADOS.map((c) => (
            <TableRow key={c.clave} className={c.destacado ? "bg-muted/30" : undefined}>
              <TableCell>
                <NombreFila c={c} />
              </TableCell>
              {columnas.map((col) => (
                <TableCell key={col.clave} className="text-right">
                  <ValorCifra cifra={col.cuenta[c.clave]} negrita={c.destacado} breve />
                </TableCell>
              ))}
              <TableCell className="text-right">
                <ValorCifra cifra={cuenta[c.clave]} negrita={c.destacado} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
