import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarraFiltros,
  CampoBusqueda,
  QuitarFiltros,
  SelectFiltro,
} from "@/components/filtros/Filtros";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { DescargarPdfs } from "@/components/archivo/DescargarPdfs";
import { useFiltrosUrl, usePeriodoUrl } from "@/lib/filtros-url";
import { listarArchivo } from "@/lib/archivo.functions";
import { eur, fechaCorta } from "@/lib/format";
import { normalizarTexto } from "@/dominio/clientes";
import { CLASES_ARCHIVO, nombreZip, resumenArchivo, type DocArchivo } from "@/dominio/archivo";
import { totalesArchivo } from "@/dominio/sumatorios-facturas";

export const Route = createFileRoute("/panel/archivo")({
  head: () => ({ meta: [{ title: "Archivo · DTF Culture" }] }),
  component: ArchivoPage,
});

/** Lo que se pinta en la tabla: con miles de filas, el navegador se arrastra. */
const FILAS_VISIBLES = 300;

/**
 * El archivo: facturas emitidas, tickets, rectificativas y facturas de compra
 * de un periodo, de todas las tiendas y del textil, para descargarlos de una
 * vez en un ZIP. Por defecto, el trimestre en curso (el del 303).
 */
function ArchivoPage() {
  const periodo = usePeriodoUrl("trimestre");
  const {
    valores: filtros,
    cambiar,
    quitar,
    hay,
  } = useFiltrosUrl({
    q: "",
    clase: "todas",
    procedencia: "todas",
    fichero: "todos",
  });

  const dia = (d: Date) => format(d, "yyyy-MM-dd");
  const desde = periodo.rango ? dia(periodo.rango.desde) : null;
  const hasta = periodo.rango ? dia(periodo.rango.hasta) : null;

  const listarFn = useServerFn(listarArchivo);
  const { data, isLoading, error } = useQuery({
    queryKey: ["archivo", desde, hasta],
    queryFn: () => listarFn({ data: { desde, hasta } }),
  });
  const docs = useMemo(() => (data ?? []) as DocArchivo[], [data]);

  const procedencias = useMemo(
    () =>
      [...new Set(docs.map((d) => d.procedencia ?? "Compras"))].sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    [docs],
  );
  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return docs.filter(
      (d) =>
        (filtros.clase === "todas" || d.clase === filtros.clase) &&
        (filtros.procedencia === "todas" || (d.procedencia ?? "Compras") === filtros.procedencia) &&
        (filtros.fichero === "todos" || (filtros.fichero === "con") === d.tieneFichero) &&
        (!q ||
          normalizarTexto(d.referencia).includes(q) ||
          normalizarTexto(d.tercero).includes(q) ||
          normalizarTexto(d.nif).includes(q)),
    );
  }, [docs, filtros.q, filtros.clase, filtros.procedencia, filtros.fichero]);
  const resumen = useMemo(() => resumenArchivo(filtrados), [filtrados]);
  // El pie suma todos los filtrados, también los que no se pintan, y separa
  // ventas de compras: sumarlas juntas no significa nada.
  const totales = useMemo(() => totalesArchivo(filtrados), [filtrados]);
  const recortada = filtrados.length > FILAS_VISIBLES;
  const hayVentas = resumen.total > resumen.porClase.compra;
  const etiquetaClase = (c: string) => CLASES_ARCHIVO.find((x) => x.valor === c)?.etiqueta ?? c;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Archivo</h1>
          <p className="text-sm text-muted-foreground">
            Facturas emitidas, tickets, rectificativas y facturas de compra de todas las tiendas y
            del textil. Elige el periodo, filtra y descárgalos en un ZIP.
          </p>
        </div>
        <DescargarPdfs docs={filtrados} nombreZip={nombreZip(periodo.seleccion, periodo.rango)} />
      </div>

      <BarraFiltros>
        <CampoBusqueda
          valor={filtros.q}
          alCambiar={(q) => cambiar({ q })}
          placeholder="Buscar nº, cliente, proveedor o NIF…"
        />
        <SelectFiltro
          etiqueta="Tipo de documento"
          valor={filtros.clase}
          alCambiar={(clase) => cambiar({ clase })}
          opciones={[
            { valor: "todas", etiqueta: "Todos los documentos" },
            ...CLASES_ARCHIVO.map((c) => ({ valor: c.valor, etiqueta: c.etiqueta })),
          ]}
          ancho="w-[200px]"
        />
        <SelectFiltro
          etiqueta="Procedencia"
          valor={filtros.procedencia}
          alCambiar={(procedencia) => cambiar({ procedencia })}
          opciones={[
            { valor: "todas", etiqueta: "Todas las procedencias" },
            ...procedencias.map((p) => ({ valor: p, etiqueta: p })),
          ]}
          ancho="w-[200px]"
        />
        <SelectFiltro
          etiqueta="Fichero"
          valor={filtros.fichero}
          alCambiar={(fichero) => cambiar({ fichero })}
          opciones={[
            { valor: "todos", etiqueta: "Con y sin fichero" },
            { valor: "con", etiqueta: "Con fichero" },
            { valor: "sin", etiqueta: "Sin fichero" },
          ]}
          ancho="w-[170px]"
        />
        <SelectorPeriodo periodo={periodo} />
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
      </BarraFiltros>

      {!isLoading && !error && docs.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {CLASES_ARCHIVO.map((c) => (
            <Badge key={c.valor} variant="outline" className="font-normal">
              {c.etiqueta}: <span className="ml-1 font-semibold">{resumen.porClase[c.valor]}</span>
            </Badge>
          ))}
          {resumen.sinFichero > 0 && (
            <Badge variant="outline" className="font-normal text-status-pendiente">
              Sin fichero: <span className="ml-1 font-semibold">{resumen.sinFichero}</span>
            </Badge>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Procedencia</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Cliente o proveedor</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Fichero</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7}>Cargando…</TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-destructive">
                    {(error as Error).message || "No se pudo leer el archivo"}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No hay documentos en este periodo con estos filtros.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.slice(0, FILAS_VISIBLES).map((d) => (
                <TableRow key={`${d.origen}-${d.id}`}>
                  <TableCell>{d.fecha ? fechaCorta(d.fecha) : "—"}</TableCell>
                  <TableCell>{etiquetaClase(d.clase)}</TableCell>
                  <TableCell>{d.procedencia ?? "Compras"}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {d.referencia || "—"}
                  </TableCell>
                  <TableCell>{d.tercero ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">{eur(d.total)}</TableCell>
                  <TableCell>
                    {d.tieneFichero ? (
                      <span className="text-xs text-muted-foreground">{d.ext.toUpperCase()}</span>
                    ) : (
                      <span className="text-xs text-status-pendiente">
                        {d.origen === "compra" ? "Sin fichero" : "Se genera al descargar"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {!isLoading && !error && filtrados.length > 0 && (
              <TableFooter>
                {hayVentas && (
                  <TableRow>
                    <TableCell colSpan={5} className="font-semibold">
                      Total ventas ·{" "}
                      {recortada
                        ? `los ${totales.ventas.documentos} documentos, no solo los que se ven`
                        : `${totales.ventas.documentos} documento${totales.ventas.documentos === 1 ? "" : "s"}`}
                      {totales.ventas.canjeados > 0 &&
                        ` · sin ${totales.ventas.canjeados} ticket${totales.ventas.canjeados === 1 ? "" : "s"} canjeado${totales.ventas.canjeados === 1 ? "" : "s"}`}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totales.ventas.total)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
                {totales.compras.documentos > 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="font-semibold">
                      Total compras (líquido) ·{" "}
                      {recortada
                        ? `las ${totales.compras.documentos} facturas, no solo las que se ven`
                        : `${totales.compras.documentos} factura${totales.compras.documentos === 1 ? "" : "s"}`}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totales.compras.total)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
      {filtrados.length > FILAS_VISIBLES && (
        <p className="text-sm text-muted-foreground">
          Se ven los {FILAS_VISIBLES} primeros de {filtrados.length}. El ZIP lleva todos.
        </p>
      )}
    </div>
  );
}
