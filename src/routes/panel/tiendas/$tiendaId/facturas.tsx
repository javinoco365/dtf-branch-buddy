import { createFileRoute } from "@tanstack/react-router";
import { useFiltrosUrl } from "@/lib/filtros-url";
import {
  BarraFiltros,
  CampoBusqueda,
  QuitarFiltros,
  SelectFiltro,
} from "@/components/filtros/Filtros";
import { normalizarTexto } from "@/dominio/clientes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { eur, fechaCorta, referenciaFactura } from "@/lib/format";
import { calcularTotales } from "@/dominio/importes";
import {
  anularFactura,
  cambiarEstadoCobro,
  canjearTicket,
  emitirFactura,
  generarTicket80,
  generarYSubirFacturaPDF,
} from "@/lib/facturas.functions";
import { toast } from "sonner";
import { TicketsPendientesDialog } from "@/components/TicketsPendientesDialog";
import { EnviarDocumentoDialog } from "@/components/documentos/EnviarDocumentoDialog";
import { CanjearTicketDialog } from "@/components/documentos/CanjearTicketDialog";
import { situacionTicket, type SituacionTicket } from "@/dominio/tickets";
import {
  Download,
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Mail,
  Printer,
  Undo2,
} from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/facturas")({
  component: Facturas,
});

type Linea = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
};

function Facturas() {
  const { tiendaId } = Route.useParams();
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [generandoId, setGenerandoId] = useState<string | null>(null);
  const generarPDFFn = useServerFn(generarYSubirFacturaPDF);
  const ticket80Fn = useServerFn(generarTicket80);
  const [porCorreo, setPorCorreo] = useState<any>(null);
  const [canjeando, setCanjeando] = useState<any>(null);
  const canjearFn = useServerFn(canjearTicket);
  const cambiarEstadoCobroFn = useServerFn(cambiarEstadoCobro);
  const anularFacturaFn = useServerFn(anularFactura);

  const { data: tienda } = useQuery({
    queryKey: ["tienda", tiendaId],
    queryFn: async () =>
      (await supabase.from("tiendas").select("*").eq("id", tiendaId).maybeSingle()).data,
  });

  const { data: facturas = [], isLoading } = useQuery({
    queryKey: ["facturas", tiendaId],
    queryFn: async () =>
      (
        await supabase
          .from("facturas")
          .select("*")
          .eq("tienda_id", tiendaId)
          .order("fecha", { ascending: false })
      ).data ?? [],
  });
  // Los filtros viven en la dirección.
  const { valores: filtros, cambiar, quitar, hay } = useFiltrosUrl({ q: "", estado: "todos" });
  // Qué le ha pasado a cada ticket: canjeado, anulado o intacto.
  const situaciones = useMemo(() => {
    const docs = (facturas as any[]).map((f) => ({
      id: f.id as string,
      referencia: referenciaFactura(f.serie, f.ejercicio, f.numero),
      rectifica_a_id: (f.rectifica_a_id as string | null) ?? null,
      sustituye_a_id: (f.sustituye_a_id as string | null) ?? null,
    }));
    const mapa = new Map<string, SituacionTicket>();
    for (const f of facturas as any[]) {
      if (f.tipo === "simplificada") mapa.set(f.id, situacionTicket(f.id, docs));
    }
    return mapa;
  }, [facturas]);

  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return (facturas as any[]).filter(
      (f) =>
        (filtros.estado === "todos" || f.estado === filtros.estado) &&
        (!q ||
          normalizarTexto(referenciaFactura(f.serie, f.ejercicio, f.numero)).includes(q) ||
          normalizarTexto(f.cliente_nombre).includes(q)),
    );
  }, [facturas, filtros.q, filtros.estado]);

  // El navegador ya no puede escribir en facturas: perdió el permiso cuando la
  // factura pasó a ser inmutable. El estado de cobro no es parte del documento
  // fiscal, así que se cambia por una función de servidor que sí queda auditada.
  const marcarPagada = useMutation({
    mutationFn: async (id: string) => {
      await cambiarEstadoCobroFn({ data: { factura_id: id, estado: "pagada" } });
    },
    onSuccess: () => {
      toast.success("Factura marcada como pagada");
      qc.invalidateQueries({ queryKey: ["facturas", tiendaId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Anular no borra ni modifica la original: emite una rectificativa con las
  // mismas líneas en negativo. Las dos quedan en el libro y suman cero.
  const anular = useMutation({
    // R5 es el motivo propio de la rectificativa de un ticket (factura simplificada).
    mutationFn: async (f: { id: string; tipo: string }) =>
      anularFacturaFn({
        data: { factura_id: f.id, motivo: f.tipo === "simplificada" ? "R5" : "R1" },
      }),
    onSuccess: (r: any) => {
      toast.success(`Anulada con la rectificativa ${r.referencia}`);
      qc.invalidateQueries({ queryKey: ["facturas", tiendaId] });
    },
    onError: (e: any) => toast.error(e.message ?? "No se pudo anular"),
  });

  // Si pdf_url es una URL firmada absoluta y no ha expirado, abrirla directamente.
  // Si no, llamar a la server function para generar + subir el PDF y obtener URL firmada.
  async function descargar(f: any) {
    if (f.pdf_url && /^https?:\/\//.test(f.pdf_url)) {
      window.open(f.pdf_url, "_blank");
      return;
    }
    setGenerandoId(f.id);
    try {
      const res = await generarPDFFn({ data: { factura_id: f.id } });
      if (res?.url) {
        window.open(res.url, "_blank");
        toast.success("PDF generado");
        qc.invalidateQueries({ queryKey: ["facturas", tiendaId] });
      } else {
        toast.error("No se pudo generar el PDF");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Error generando el PDF");
    } finally {
      setGenerandoId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Facturas · {tienda?.nombre ?? "Tienda"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Numeración única de la sociedad. El número lo asigna la base al emitir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TicketsPendientesDialog tiendaId={tiendaId} />
          <Dialog open={abierto} onOpenChange={setAbierto}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Nueva factura
              </Button>
            </DialogTrigger>
            <NuevaFacturaDialog
              tiendaId={tiendaId}
              onDone={() => {
                setAbierto(false);
                qc.invalidateQueries({ queryKey: ["facturas", tiendaId] });
              }}
            />
          </Dialog>
        </div>
      </div>

      <BarraFiltros>
        <CampoBusqueda
          valor={filtros.q}
          alCambiar={(q) => cambiar({ q })}
          placeholder="Buscar nº o cliente…"
        />
        <SelectFiltro
          etiqueta="Estado"
          valor={filtros.estado}
          alCambiar={(estado) => cambiar({ estado })}
          opciones={[
            { valor: "todos", etiqueta: "Todos los estados" },
            ...[...new Set((facturas as any[]).map((f) => String(f.estado)))]
              .sort()
              .map((e) => ({ valor: e, etiqueta: e })),
          ]}
        />
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
      </BarraFiltros>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {referenciaFactura(f.serie, f.ejercicio, f.numero)}
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
                  <TableCell>{f.cliente_nombre ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        f.estado === "pagada"
                          ? "default"
                          : f.estado === "vencida" || f.estado === "anulada"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {f.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{eur(f.base_imponible)}</TableCell>
                  <TableCell className="text-right">{eur(f.iva_total)}</TableCell>
                  <TableCell className="text-right font-semibold">{eur(f.total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => descargar(f)}
                        disabled={generandoId === f.id}
                        title={f.pdf_url ? "Descargar PDF" : "Generar y descargar PDF"}
                      >
                        {generandoId === f.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                      {f.tipo === "simplificada" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Ticket en 80 mm"
                          aria-label="Ticket en 80 mm"
                          onClick={async () => {
                            // La pestaña se abre antes de la llamada: al volver de
                            // la red el navegador ya no deja abrir ventanas.
                            const ventana = window.open("", "_blank");
                            try {
                              const r = await ticket80Fn({ data: { factura_id: f.id } });
                              if (!r.url) throw new Error("No se pudo obtener el ticket");
                              if (ventana) ventana.location.href = r.url;
                              else window.location.href = r.url;
                            } catch (e: any) {
                              ventana?.close();
                              toast.error(e?.message ?? "No se pudo generar el ticket");
                            }
                          }}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Enviar por correo"
                        aria-label="Enviar por correo"
                        onClick={() => setPorCorreo(f)}
                      >
                        <Mail className="h-4 w-4" />
                      </Button>
                      {f.estado !== "pagada" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => marcarPagada.mutate(f.id)}
                          disabled={marcarPagada.isPending}
                          title="Marcar como pagada"
                        >
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      {situaciones.get(f.id)?.admite_cambios && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Canjear por factura"
                          aria-label="Canjear por factura"
                          onClick={() => setCanjeando(f)}
                        >
                          <FileCheck2 className="h-4 w-4" />
                        </Button>
                      )}
                      {f.tipo !== "rectificativa" &&
                        situaciones.get(f.id)?.admite_cambios !== false && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Se emitirá una factura rectificativa que anula la ${referenciaFactura(f.serie, f.ejercicio, f.numero)}. La original no se borra ni se modifica. ¿Continuar?`,
                                )
                              ) {
                                anular.mutate({ id: f.id, tipo: f.tipo });
                              }
                            }}
                            disabled={anular.isPending}
                            title="Anular con una rectificativa"
                          >
                            <Undo2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && facturas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Sin facturas emitidas. Crea la primera con “Nueva factura”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canjeando && (
        <CanjearTicketDialog
          open={!!canjeando}
          onOpenChange={(o) => !o && setCanjeando(null)}
          referencia={referenciaFactura(canjeando.serie, canjeando.ejercicio, canjeando.numero)}
          total={Number(canjeando.total)}
          nombreInicial={canjeando.cliente_nombre ?? null}
          canjear={(d) =>
            canjearFn({
              data: {
                factura_id: canjeando.id,
                receptor: { nombre: d.nombre, nif: d.nif, direccion: d.direccion || null },
              },
            })
          }
          abrirPdf={async (id) => (await generarPDFFn({ data: { factura_id: id } }))?.url ?? null}
          alCanjear={() => qc.invalidateQueries({ queryKey: ["facturas", tiendaId] })}
        />
      )}

      {porCorreo && (
        <EnviarDocumentoDialog
          open={!!porCorreo}
          onOpenChange={(o) => !o && setPorCorreo(null)}
          facturaId={porCorreo.id}
          referencia={referenciaFactura(porCorreo.serie, porCorreo.ejercicio, porCorreo.numero)}
          esTicket={porCorreo.tipo === "simplificada"}
          emailInicial={porCorreo.receptor_snapshot?.email ?? null}
        />
      )}
    </div>
  );
}

function NuevaFacturaDialog({ tiendaId, onDone }: { tiendaId: string; onDone: () => void }) {
  const generarPDFFn = useServerFn(generarYSubirFacturaPDF);
  const emitirFacturaFn = useServerFn(emitirFactura);
  const [cliente, setCliente] = useState({ nombre: "", nif: "", direccion: "" });
  const [clienteId, setClienteId] = useState<string | null>(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [vencimiento, setVencimiento] = useState("");
  const [notas, setNotas] = useState("");

  // Los clientes ya dados de alta en esta tienda, para no reescribir el NIF y
  // la dirección en cada factura.
  const { data: clientes } = useQuery({
    queryKey: ["clientes-tienda", tiendaId],
    queryFn: async () =>
      (
        await supabase
          .from("clientes")
          .select("id, nombre, nif, direccion, codigo_postal, ciudad, provincia")
          .eq("tienda_id", tiendaId)
          .order("nombre")
      ).data ?? [],
  });

  function elegirCliente(id: string) {
    const c = clientes?.find((x) => x.id === id);
    if (!c) return;
    setClienteId(c.id);
    setCliente({
      nombre: c.nombre ?? "",
      nif: c.nif ?? "",
      direccion:
        [c.direccion, [c.codigo_postal, c.ciudad].filter(Boolean).join(" "), c.provincia]
          .filter(Boolean)
          .join(", ") || "",
    });
  }
  const [items, setItems] = useState<Linea[]>([
    { descripcion: "", cantidad: 1, unidad: "ud", precio_unitario: 0, iva_rate: 21 },
  ]);
  const [enviando, setEnviando] = useState(false);
  const totales = calcularTotales(items);

  function actualizarItem(i: number, patch: Partial<Linea>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function emitir() {
    if (!cliente.nombre.trim()) {
      toast.error("Introduce el nombre del cliente");
      return;
    }
    if (items.some((it) => !it.descripcion.trim() || it.cantidad <= 0)) {
      toast.error("Completa todas las líneas (descripción y cantidad)");
      return;
    }
    setEnviando(true);
    try {
      // El número de factura NO se calcula aquí. Lo asigna emitir_factura() en
      // la base, dentro de una transacción con la fila de la serie bloqueada.
      // Antes se leía siguiente_numero_factura de la tienda desde el navegador
      // y se incrementaba después, así que dos pestañas a la vez producían un
      // número repetido o un hueco en la serie.
      const factura = await emitirFacturaFn({
        data: {
          tienda_id: tiendaId,
          receptor: {
            nombre: cliente.nombre.trim(),
            nif: cliente.nif.trim() || null,
            direccion: cliente.direccion.trim() || null,
          },
          lineas: items.map((it) => ({
            descripcion: it.descripcion.trim(),
            cantidad: it.cantidad,
            unidad: it.unidad,
            precio_unitario: it.precio_unitario,
            iva_rate: it.iva_rate,
          })),
          fecha,
          fecha_vencimiento: vencimiento || null,
          cliente_id: clienteId,
          notas: notas.trim() || null,
        },
      });

      // La referencia la compone la base junto con el número. Antes se armaba
      // aquí como `serie-numero`, que con la serie ordinaria vacía anunciaba
      // "Factura -00001 emitida".
      const referencia = factura.referencia;

      try {
        const res = await generarPDFFn({ data: { factura_id: factura.id } });
        if (res?.url) window.open(res.url, "_blank");
        toast.success(`Factura ${referencia} emitida`);
      } catch (errPdf: any) {
        toast.warning(
          `Factura ${referencia} emitida, pero no se pudo generar el PDF: ${errPdf?.message ?? "error desconocido"}`,
        );
      }
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Error emitiendo factura");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nueva factura</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {clientes && clientes.length > 0 && (
            <div className="col-span-2 space-y-1.5">
              <Label>Cliente guardado</Label>
              <Select onValueChange={elegirCliente}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir uno para rellenar los datos…" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                      {c.nif ? ` · ${c.nif}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Opcional. Puedes escribir los datos a mano y dejarlo sin elegir.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Input
              value={cliente.nombre}
              onChange={(e) => {
                setCliente({ ...cliente, nombre: e.target.value });
                setClienteId(null);
              }}
              placeholder="Razón social / nombre"
            />
          </div>
          <div className="space-y-1.5">
            <Label>NIF / CIF</Label>
            <Input
              value={cliente.nif}
              onChange={(e) => setCliente({ ...cliente, nif: e.target.value })}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Dirección</Label>
            <Input
              value={cliente.direccion}
              onChange={(e) => setCliente({ ...cliente, direccion: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fecha de emisión</Label>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              No puede ser anterior a la última factura emitida.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Vencimiento</Label>
            <Input
              type="date"
              value={vencimiento}
              onChange={(e) => setVencimiento(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Opcional.</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Líneas</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setItems([
                  ...items,
                  { descripcion: "", cantidad: 1, unidad: "ud", precio_unitario: 0, iva_rate: 21 },
                ])
              }
            >
              <Plus className="h-3 w-3 mr-1" /> Línea
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  {i === 0 && <Label className="text-xs">Descripción</Label>}
                  <Input
                    value={it.descripcion}
                    onChange={(e) => actualizarItem(i, { descripcion: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  {i === 0 && <Label className="text-xs">Cant.</Label>}
                  <Input
                    type="number"
                    step="0.01"
                    value={it.cantidad}
                    onChange={(e) => actualizarItem(i, { cantidad: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-1">
                  {i === 0 && <Label className="text-xs">Ud.</Label>}
                  <Input
                    value={it.unidad}
                    onChange={(e) => actualizarItem(i, { unidad: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">€ / ud.</Label>}
                  <Input
                    type="number"
                    step="0.01"
                    value={it.precio_unitario}
                    onChange={(e) => actualizarItem(i, { precio_unitario: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">IVA %</Label>}
                  <Input
                    type="number"
                    step="1"
                    value={it.iva_rate}
                    onChange={(e) => actualizarItem(i, { iva_rate: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Estado</Label>
            {/* Ya no se elige: emitir una factura la emite. El cobro se marca
                después, desde el listado, y anular es una rectificativa. */}
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Se emitirá con número correlativo de la serie
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
        </div>

        <div className="border-t pt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Base imponible</div>
            <div className="font-semibold">{eur(totales.base_imponible)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">IVA</div>
            <div className="font-semibold">{eur(totales.iva_total)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-bold">{eur(totales.total)}</div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={emitir} disabled={enviando}>
          {enviando ? "Emitiendo…" : "Emitir factura"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
