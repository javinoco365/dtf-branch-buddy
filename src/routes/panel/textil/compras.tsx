import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, FileUp, Loader2, PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { eur } from "@/lib/format";
import { revisarCompra, type CompraLeida } from "@/dominio/factura-compra";
import {
  borrarCompra,
  guardarCompra,
  hayLector,
  leerFacturaCompra,
  listCompras,
  registrarCompra,
} from "@/lib/compras.functions";
import { listStock } from "@/lib/textil.functions";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";

export const Route = createFileRoute("/panel/textil/compras")({
  head: () => ({ meta: [{ title: "Compras · DTF Culture" }] }),
  component: ComprasPage,
});

const COMPRA_VACIA: CompraLeida = {
  proveedor: null,
  nif_proveedor: null,
  numero: null,
  fecha: null,
  base: 0,
  iva: 0,
  total: 0,
  lineas: [],
};

function ComprasPage() {
  const qc = useQueryClient();
  const ficheroRef = useRef<HTMLInputElement>(null);
  const [revisando, setRevisando] = useState<{
    compra: CompraLeida;
    asignaciones: (string | null)[];
    lectura: string | null;
  } | null>(null);
  const [borrando, setBorrando] = useState<any>(null);

  const listFn = useServerFn(listCompras);
  const { data: compras = [], isLoading } = useQuery({
    queryKey: ["textil-compras"],
    queryFn: () => listFn(),
  });

  const stockFn = useServerFn(listStock);
  const { data: stock = [] } = useQuery({ queryKey: ["textil-stock"], queryFn: () => stockFn() });

  const lectorFn = useServerFn(hayLector);
  const { data: lector } = useQuery({ queryKey: ["hay-lector"], queryFn: () => lectorFn() });

  const leerFn = useServerFn(leerFacturaCompra);
  const leer = useMutation({
    mutationFn: (fichero: File) => {
      const fd = new FormData();
      fd.append("fichero", fichero);
      return leerFn({ data: fd });
    },
    onSuccess: (r: any) => {
      setRevisando({
        compra: r.compra,
        asignaciones: r.compra.lineas.map(() => null),
        lectura: r.bruto_json ?? null,
      });
      if (r.avisos.length > 0) {
        toast.warning(`Leída con ${r.avisos.length} cosa(s) que revisar`);
      } else {
        toast.success("Factura leída. Revísala antes de registrarla.");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo leer la factura"),
  });

  const registrarFn = useServerFn(registrarCompra);
  const guardarFn = useServerFn(guardarCompra);
  const registrar = useMutation({
    mutationFn: async () => {
      if (!revisando) throw new Error("Nada que registrar");
      const { id } = (await guardarFn({
        data: {
          ...revisando.compra,
          lectura_ia: revisando.lectura,
          lineas: revisando.compra.lineas.map((l, i) => ({
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            importe: l.importe,
            unidad: l.unidad ?? null,
            stock_id: revisando.asignaciones[i],
          })),
        },
      })) as { id: string };
      return registrarFn({ data: { id } });
    },
    onSuccess: (r: any) => {
      toast.success(`${r.movidas} línea(s) dadas de alta en el stock`);
      setRevisando(null);
      qc.invalidateQueries({ queryKey: ["textil-compras"] });
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo registrar la compra"),
  });

  const borrarFn = useServerFn(borrarCompra);
  const borrar = useMutation({
    mutationFn: (id: string) => borrarFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Compra borrada");
      setBorrando(null);
      qc.invalidateQueries({ queryKey: ["textil-compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo borrar"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">
            Sube la factura del proveedor y da el género de alta en el stock.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={ficheroRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) leer.mutate(f);
            }}
          />
          <Button
            onClick={() => ficheroRef.current?.click()}
            disabled={leer.isPending || lector?.disponible === false}
          >
            {leer.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            {leer.isPending ? "Leyendo…" : "Subir factura"}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setRevisando({ compra: { ...COMPRA_VACIA }, asignaciones: [], lectura: null })
            }
          >
            A mano
          </Button>
        </div>
      </div>

      {lector?.disponible === false && (
        <Card className="border-amber-500/50">
          <CardContent className="flex gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">El lector de facturas no está configurado.</p>
              <p className="text-muted-foreground">
                Falta la variable <span className="font-mono">ANTHROPIC_API_KEY</span> en el entorno
                del despliegue. Mientras tanto puedes dar las compras de alta a mano.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Número</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7}>Cargando…</TableCell>
                </TableRow>
              )}
              {!isLoading && compras.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Sin compras registradas.
                  </TableCell>
                </TableRow>
              )}
              {compras.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell>{c.fecha ?? "—"}</TableCell>
                  <TableCell className="font-medium">{c.proveedor ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.numero ?? "—"}</TableCell>
                  <TableCell className="text-right">{eur(Number(c.base))}</TableCell>
                  <TableCell className="text-right font-medium">{eur(Number(c.total))}</TableCell>
                  <TableCell>
                    <Badge variant={c.estado === "registrada" ? "default" : "outline"}>
                      {c.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.estado === "borrador" && (
                      <Button variant="ghost" size="icon" onClick={() => setBorrando(c)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`la compra ${borrando?.numero ?? ""}`}
        consecuencias={["Es un borrador: no ha tocado el stock."]}
        cargando={borrar.isPending}
        onConfirmar={() => borrando && borrar.mutate(borrando.id)}
      />

      <Dialog open={!!revisando} onOpenChange={(o) => !o && setRevisando(null)}>
        {revisando && (
          <RevisarCompra
            estado={revisando}
            stock={stock}
            onCambiar={setRevisando}
            onRegistrar={() => registrar.mutate()}
            registrando={registrar.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

/**
 * La pantalla de revisión.
 *
 * Existe porque la lectura de un modelo NO es un dato: es una propuesta. Los
 * movimientos de stock no se borran, así que un «12» leído como «120» quedaría
 * anotado para siempre. Aquí se comprueba y se casa cada línea con una variante
 * del catálogo antes de que entre nada.
 */
function RevisarCompra({
  estado,
  stock,
  onCambiar,
  onRegistrar,
  registrando,
}: {
  estado: { compra: CompraLeida; asignaciones: (string | null)[]; lectura: string | null };
  stock: any[];
  onCambiar: (e: any) => void;
  onRegistrar: () => void;
  registrando: boolean;
}) {
  const { compra, asignaciones } = estado;
  const avisos = revisarCompra(compra);
  const sinCasar = compra.lineas.filter((_, i) => !asignaciones[i]).length;

  const set = (cambios: Partial<CompraLeida>) =>
    onCambiar({ ...estado, compra: { ...compra, ...cambios } });

  const setLinea = (i: number, cambios: any) =>
    set({ lineas: compra.lineas.map((l, j) => (i === j ? { ...l, ...cambios } : l)) });

  const setAsignacion = (i: number, valor: string | null) =>
    onCambiar({
      ...estado,
      asignaciones: asignaciones.map((a, j) => (i === j ? valor : a)),
    });

  return (
    <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Revisar la compra antes de darla de alta</DialogTitle>
        <DialogDescription>
          Lo que se registre entra en el libro de stock y no se puede borrar. Comprueba las
          cantidades y di a qué artículo del catálogo corresponde cada línea.
        </DialogDescription>
      </DialogHeader>

      {avisos.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Los números no cuadran entre sí
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            {avisos.map((a, i) => (
              <div key={i}>
                {a.linea !== null && <span className="font-medium">Línea {a.linea + 1}: </span>}
                {a.mensaje}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Campo
          etiqueta="Proveedor"
          valor={compra.proveedor ?? ""}
          onChange={(v) => set({ proveedor: v || null })}
        />
        <Campo
          etiqueta="NIF"
          valor={compra.nif_proveedor ?? ""}
          onChange={(v) => set({ nif_proveedor: v || null })}
        />
        <Campo
          etiqueta="Número"
          valor={compra.numero ?? ""}
          onChange={(v) => set({ numero: v || null })}
        />
        <Campo
          etiqueta="Fecha"
          tipo="date"
          valor={compra.fecha ?? ""}
          onChange={(v) => set({ fecha: v || null })}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Concepto</TableHead>
            <TableHead className="w-24 text-right">Cantidad</TableHead>
            <TableHead className="w-28 text-right">Coste ud.</TableHead>
            <TableHead className="w-28 text-right">Importe</TableHead>
            <TableHead className="w-64">Artículo del catálogo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {compra.lineas.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                Sin líneas. Añade una para dar género de alta.
              </TableCell>
            </TableRow>
          )}
          {compra.lineas.map((l, i) => (
            <TableRow key={i}>
              <TableCell>
                <Input
                  value={l.descripcion}
                  onChange={(e) => setLinea(i, { descripcion: e.target.value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="any"
                  className="text-right"
                  value={l.cantidad}
                  onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="any"
                  className="text-right"
                  value={l.precio_unitario}
                  onChange={(e) => setLinea(i, { precio_unitario: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {eur(Number(l.importe))}
              </TableCell>
              <TableCell>
                <Select
                  value={asignaciones[i] ?? ""}
                  onValueChange={(v) => setAsignacion(i, v || null)}
                >
                  <SelectTrigger className={asignaciones[i] ? "" : "border-amber-500"}>
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
                    {stock.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {[s.nombre, s.color, s.talla].filter(Boolean).join(" · ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          onCambiar({
            ...estado,
            compra: {
              ...compra,
              lineas: [
                ...compra.lineas,
                { descripcion: "", cantidad: 1, precio_unitario: 0, importe: 0, unidad: null },
              ],
            },
            asignaciones: [...asignaciones, null],
          })
        }
      >
        Añadir línea
      </Button>

      <div className="grid grid-cols-3 gap-3">
        <Campo
          etiqueta="Base"
          tipo="number"
          valor={String(compra.base)}
          onChange={(v) => set({ base: Number(v) })}
        />
        <Campo
          etiqueta="IVA"
          tipo="number"
          valor={String(compra.iva)}
          onChange={(v) => set({ iva: Number(v) })}
        />
        <Campo
          etiqueta="Total"
          tipo="number"
          valor={String(compra.total)}
          onChange={(v) => set({ total: Number(v) })}
        />
      </div>

      <DialogFooter className="items-center gap-3">
        {sinCasar > 0 && (
          <span className="text-sm text-muted-foreground mr-auto">
            {sinCasar} línea(s) sin asignar a un artículo.
          </span>
        )}
        <Button
          onClick={onRegistrar}
          disabled={registrando || compra.lineas.length === 0 || sinCasar > 0}
        >
          {registrando ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <PackageCheck className="h-4 w-4 mr-2" />
          )}
          Dar de alta en el stock
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
  tipo = "text",
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{etiqueta}</Label>
      <Input
        type={tipo}
        step={tipo === "number" ? "any" : undefined}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
