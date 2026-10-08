import { createFileRoute } from "@tanstack/react-router";
import { useFiltrosUrl, usePeriodoUrl } from "@/lib/filtros-url";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { enRango } from "@/dominio/periodos";
import {
  BarraFiltros,
  CampoBusqueda,
  QuitarFiltros,
  SelectFiltro,
} from "@/components/filtros/Filtros";
import { normalizarTexto } from "@/dominio/clientes";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, FileCheck2, FileText, Loader2, Printer, Trash2, Undo2 } from "lucide-react";
import {
  listTextilFacturas,
  deleteTextilFactura,
  generarPdfFacturaTextil,
  generarTicket80Textil,
  urlFacturaTextil,
  rellenarPdfsTextil,
  canjearTicketTextil,
  anularTicketTextil,
} from "@/lib/textil.functions";
import { CanjearTicketDialog } from "@/components/documentos/CanjearTicketDialog";
import { PdfsPendientes } from "@/components/documentos/PdfsPendientes";
import { DescargarPdfs } from "@/components/archivo/DescargarPdfs";
import { deFacturaTextil, nombreZip } from "@/dominio/archivo";
import { situacionTicket, type SituacionTicket } from "@/dominio/tickets";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { contadoresDeSerie } from "@/lib/facturas.functions";
import { contadoresPorSerie, impedimentoBorrado } from "@/dominio/borrado-facturas";

export const Route = createFileRoute("/panel/textil/facturas")({
  head: () => ({ meta: [{ title: "Facturas textil · DTF Culture" }] }),
  component: FacturasPage,
});

function FacturasPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTextilFacturas);
  const [borrando, setBorrando] = useState<any>(null);
  const delFn = useServerFn(deleteTextilFactura);
  const { data = [] } = useQuery({ queryKey: ["textil-facturas"], queryFn: () => listFn() });
  // Por dónde va cada serie: solo la última se puede borrar.
  const contadoresFn = useServerFn(contadoresDeSerie);
  const { data: contadores = [] } = useQuery({
    queryKey: ["series-contadores"],
    queryFn: () => contadoresFn(),
  });
  const ultimos = useMemo(() => contadoresPorSerie(contadores), [contadores]);
  const impedimentoBorrando = borrando
    ? impedimentoBorrado(
        {
          estado: borrando.estado,
          serie: borrando.serie,
          ejercicio: borrando.ejercicio,
          numero: borrando.numero_serie,
        },
        ultimos,
        borrando.numero,
      )
    : null;
  // Los filtros viven en la dirección.
  const { valores: filtros, cambiar, quitar, hay } = useFiltrosUrl({ q: "", estado: "todos" });
  // Por defecto, todo: la lista se abre como siempre.
  const periodo = usePeriodoUrl("todo");
  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return (data as any[]).filter(
      (f) =>
        enRango(f.fecha, periodo.rango) &&
        (filtros.estado === "todos" || f.estado === filtros.estado) &&
        (!q ||
          normalizarTexto(f.numero).includes(q) ||
          normalizarTexto(f.cliente_nombre).includes(q) ||
          normalizarTexto(f.marca?.nombre).includes(q)),
    );
  }, [data, filtros.q, filtros.estado, periodo.rango]);
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["textil-facturas"] });
      qc.invalidateQueries({ queryKey: ["series-contadores"] });
      toast.success("Borrada. Su número lo cogerá la siguiente.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [generando, setGenerando] = useState<string | null>(null);
  const generarFn = useServerFn(generarPdfFacturaTextil);
  const urlFn = useServerFn(urlFacturaTextil);
  const rellenarFn = useServerFn(rellenarPdfsTextil);
  const ticket80Fn = useServerFn(generarTicket80Textil);
  const canjearFn = useServerFn(canjearTicketTextil);
  const anularFn = useServerFn(anularTicketTextil);
  const [canjeando, setCanjeando] = useState<any>(null);

  // Qué le ha pasado a cada ticket: canjeado, anulado o intacto.
  const situaciones = useMemo(() => {
    const docs = (data as any[]).map((f) => ({
      id: f.id as string,
      referencia: f.numero as string,
      rectifica_a_id: (f.rectifica_a_id as string | null) ?? null,
      sustituye_a_id: (f.sustituye_a_id as string | null) ?? null,
    }));
    const mapa = new Map<string, SituacionTicket>();
    for (const f of data as any[]) {
      if (f.tipo === "simplificada") mapa.set(f.id, situacionTicket(f.id, docs));
    }
    return mapa;
  }, [data]);

  // Anular no borra ni modifica el ticket: emite su rectificativa, las mismas
  // líneas en negativo. Los dos quedan en el libro y suman cero.
  const anular = useMutation({
    mutationFn: (id: string) => anularFn({ data: { factura_id: id } }),
    onSuccess: (r: any) => {
      toast.success(`Ticket anulado con la rectificativa ${r.referencia}`);
      qc.invalidateQueries({ queryKey: ["textil-facturas"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo anular"),
  });

  /** El ticket en 80 mm, con la pestaña abierta antes de la llamada por lo mismo que abajo. */
  async function abrirTicket80(factura: any) {
    const ventana = window.open("", "_blank");
    try {
      const { url } = await ticket80Fn({ data: { factura_id: factura.id } });
      if (!url) throw new Error("No se pudo obtener el ticket");
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    } catch (e: any) {
      ventana?.close();
      toast.error(e?.message ?? "No se pudo generar el ticket");
    }
  }

  /**
   * Genera el PDF si hace falta y lo abre.
   *
   * La ventana se abre ANTES de la llamada, no después: un navegador solo
   * permite abrir pestañas mientras dura el gesto del usuario, y al volver de
   * una espera de red ya la ha bloqueado. Se abre vacía y se le pone la
   * dirección cuando llega.
   */
  async function abrirPdf(factura: any) {
    const ventana = window.open("", "_blank");
    setGenerando(factura.id);
    try {
      if (!factura.pdf_path) {
        await generarFn({ data: { factura_id: factura.id } });
        qc.invalidateQueries({ queryKey: ["textil-facturas"] });
      }
      const { url } = (await urlFn({ data: { factura_id: factura.id } })) as {
        url: string | null;
      };
      if (!url) throw new Error("No se pudo obtener el PDF");
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    } catch (e: any) {
      ventana?.close();
      toast.error(e?.message ?? "No se pudo generar el PDF");
    } finally {
      setGenerando(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturas textil</h1>
          <p className="text-sm text-muted-foreground">
            Las facturas se generan al convertir un presupuesto aceptado.
          </p>
        </div>
        <DescargarPdfs
          docs={(filtrados as any[]).map(deFacturaTextil)}
          nombreZip={nombreZip(periodo.seleccion, periodo.rango, "Facturas_textil")}
        />
      </div>
      <BarraFiltros>
        <CampoBusqueda
          valor={filtros.q}
          alCambiar={(q) => cambiar({ q })}
          placeholder="Buscar nº, cliente o marca…"
        />
        <SelectFiltro
          etiqueta="Estado"
          valor={filtros.estado}
          alCambiar={(estado) => cambiar({ estado })}
          opciones={[
            { valor: "todos", etiqueta: "Todos los estados" },
            ...[...new Set((data as any[]).map((f) => String(f.estado)))]
              .sort()
              .map((e) => ({ valor: e, etiqueta: e })),
          ]}
        />
        <SelectorPeriodo periodo={periodo} />
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
      </BarraFiltros>
      <PdfsPendientes
        faltan={(data as any[]).filter((f) => f.estado !== "borrador" && !f.pdf_path).length}
        generar={(excluir) => rellenarFn({ data: { excluir, limite: 3 } })}
        alTerminar={() => qc.invalidateQueries({ queryKey: ["textil-facturas"] })}
      />
      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Sin facturas.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {f.numero}
                    {f.tipo === "simplificada" && (
                      <Badge variant="outline" className="ml-2 font-sans">
                        Ticket
                      </Badge>
                    )}
                    {situaciones.get(f.id)?.canjeado_por && (
                      <div className="font-sans text-[11px] text-muted-foreground">
                        Canjeado por {situaciones.get(f.id)?.canjeado_por}
                      </div>
                    )}
                    {situaciones.get(f.id)?.rectificado_por && (
                      <div className="font-sans text-[11px] text-muted-foreground">
                        Anulado por {situaciones.get(f.id)?.rectificado_por}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell>{f.cliente_nombre ?? "—"}</TableCell>
                  <TableCell>
                    {f.marca ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: f.marca.color ?? "#3b82f6" }}
                        />
                        {f.marca.nombre}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{f.estado}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{eur(Number(f.total))}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={f.pdf_path ? "Abrir el PDF" : "Generar el PDF"}
                      disabled={generando === f.id || f.estado === "borrador"}
                      onClick={() => abrirPdf(f)}
                    >
                      {generando === f.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : f.pdf_path ? (
                        <Download className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </Button>
                    {f.tipo === "simplificada" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Ticket en 80 mm"
                        aria-label="Ticket en 80 mm"
                        onClick={() => abrirTicket80(f)}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    )}
                    {situaciones.get(f.id)?.admite_cambios && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Canjear por factura"
                          aria-label="Canjear por factura"
                          onClick={() => setCanjeando(f)}
                        >
                          <FileCheck2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Anular con una rectificativa"
                          aria-label="Anular con una rectificativa"
                          disabled={anular.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Se emitirá una rectificativa que anula el ticket ${f.numero}. El ticket no se borra ni se modifica. ¿Continuar?`,
                              )
                            ) {
                              anular.mutate(f.id);
                            }
                          }}
                        >
                          <Undo2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setBorrando(f)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canjeando && (
        <CanjearTicketDialog
          open={!!canjeando}
          onOpenChange={(o) => !o && setCanjeando(null)}
          referencia={canjeando.numero}
          total={Number(canjeando.total)}
          nombreInicial={canjeando.cliente_nombre ?? null}
          canjear={(d) =>
            canjearFn({
              data: {
                factura_id: canjeando.id,
                nombre: d.nombre,
                nif: d.nif,
                direccion: d.direccion || null,
              },
            })
          }
          abrirPdf={async (id) => {
            await generarFn({ data: { factura_id: id } });
            return (await urlFn({ data: { factura_id: id } })).url;
          }}
          alCanjear={() => qc.invalidateQueries({ queryKey: ["textil-facturas"] })}
        />
      )}

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`la factura ${borrando?.numero ?? ""}`}
        cargando={del.isPending}
        consecuencias={
          borrando && borrando.estado !== "borrador" && !impedimentoBorrando
            ? [
                "Se borra del todo, con sus líneas y su PDF.",
                "Su número lo cogerá la siguiente factura de la serie.",
                "Queda constancia en el registro de auditoría.",
              ]
            : undefined
        }
        impedimento={impedimentoBorrando}
        onConfirmar={() => {
          del.mutate(borrando.id);
          setBorrando(null);
        }}
      />
    </div>
  );
}
