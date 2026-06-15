import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { eur, fechaCorta } from "@/lib/format";
import { generarYSubirFacturaPDF } from "@/lib/facturas.functions";
import { toast } from "sonner";
import { Download, FileText, Plus, Trash2, CheckCircle2, Loader2 } from "lucide-react";

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

function calcTotales(items: Linea[]) {
  let base = 0;
  let iva = 0;
  for (const it of items) {
    const sub = it.cantidad * it.precio_unitario;
    base += sub;
    iva += sub * (it.iva_rate / 100);
  }
  return {
    base: Number(base.toFixed(2)),
    iva: Number(iva.toFixed(2)),
    total: Number((base + iva).toFixed(2)),
  };
}

function Facturas() {
  const { tiendaId } = Route.useParams();
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [generandoId, setGenerandoId] = useState<string | null>(null);
  const generarPDFFn = useServerFn(generarYSubirFacturaPDF);

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

  const marcarPagada = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("facturas")
        .update({ estado: "pagada" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Factura marcada como pagada");
      qc.invalidateQueries({ queryKey: ["facturas", tiendaId] });
    },
    onError: (e: any) => toast.error(e.message),
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
            Serie {tienda?.serie_factura ?? "—"} · Próximo nº{" "}
            {tienda?.siguiente_numero_factura ?? "—"}
          </p>
        </div>
        <Dialog open={abierto} onOpenChange={setAbierto}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Nueva factura
            </Button>
          </DialogTrigger>
          <NuevaFacturaDialog
            tiendaId={tiendaId}
            tienda={tienda}
            onDone={() => {
              setAbierto(false);
              qc.invalidateQueries({ queryKey: ["facturas", tiendaId] });
              qc.invalidateQueries({ queryKey: ["tienda", tiendaId] });
            }}
          />
        </Dialog>
      </div>

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
              {facturas.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {f.serie}-{String(f.numero).padStart(5, "0")}
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
    </div>
  );
}

function NuevaFacturaDialog({
  tiendaId,
  tienda,
  onDone,
}: {
  tiendaId: string;
  tienda: any;
  onDone: () => void;
}) {
  const generarPDFFn = useServerFn(generarYSubirFacturaPDF);
  const [cliente, setCliente] = useState({ nombre: "", nif: "", direccion: "" });
  const [notas, setNotas] = useState("");
  const [estado, setEstado] = useState<"emitida" | "borrador" | "pagada">("emitida");
  const [items, setItems] = useState<Linea[]>([
    { descripcion: "", cantidad: 1, unidad: "ud", precio_unitario: 0, iva_rate: 21 },
  ]);
  const [enviando, setEnviando] = useState(false);
  const totales = calcTotales(items);

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
      const numero = tienda?.siguiente_numero_factura ?? 1;
      const serie = tienda?.serie_factura ?? "A";
      const fecha = new Date().toISOString().slice(0, 10);

      const { data: factura, error: errF } = await supabase
        .from("facturas")
        .insert({
          tienda_id: tiendaId,
          serie,
          numero,
          fecha,
          estado,
          cliente_nombre: cliente.nombre,
          cliente_nif: cliente.nif || null,
          cliente_direccion: cliente.direccion || null,
          emisor_nombre: tienda?.razon_social ?? tienda?.nombre ?? null,
          emisor_cif: tienda?.cif ?? null,
          emisor_direccion: tienda?.direccion ?? null,
          base_imponible: totales.base,
          iva_total: totales.iva,
          total: totales.total,
          notas: notas || null,
        })
        .select()
        .single();
      if (errF) throw errF;

      const filas = items.map((it) => {
        const sub = Number((it.cantidad * it.precio_unitario).toFixed(2));
        const ivaImp = Number((sub * (it.iva_rate / 100)).toFixed(2));
        return {
          factura_id: factura.id,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_unitario: it.precio_unitario,
          iva_rate: it.iva_rate,
          subtotal: sub,
          iva: ivaImp,
          total: Number((sub + ivaImp).toFixed(2)),
        };
      });
      const { error: errI } = await supabase.from("factura_items").insert(filas);
      if (errI) throw errI;

      await supabase
        .from("tiendas")
        .update({ siguiente_numero_factura: numero + 1 })
        .eq("id", tiendaId);

      try {
        const res = await generarPDFFn({ data: { factura_id: factura.id } });
        if (res?.url) window.open(res.url, "_blank");
        toast.success(`Factura ${serie}-${String(numero).padStart(5, "0")} emitida`);
      } catch (errPdf: any) {
        toast.warning(
          `Factura creada, pero no se pudo generar el PDF: ${errPdf?.message ?? "error desconocido"}`,
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
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Input
              value={cliente.nombre}
              onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })}
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
                    onChange={(e) =>
                      actualizarItem(i, { precio_unitario: Number(e.target.value) })
                    }
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
            <Select value={estado} onValueChange={(v) => setEstado(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="borrador">Borrador</SelectItem>
                <SelectItem value="emitida">Emitida</SelectItem>
                <SelectItem value="pagada">Pagada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
        </div>

        <div className="border-t pt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Base imponible</div>
            <div className="font-semibold">{eur(totales.base)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">IVA</div>
            <div className="font-semibold">{eur(totales.iva)}</div>
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