import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Wallet } from "lucide-react";
import {
  listTextilPedidos,
  upsertTextilPedido,
  updateTextilPedidoEstado,
  deleteTextilPedido,
  listTextilClientes,
  listMarcas,
  getEmpresaGlobal,
  listStock,
  listTextilCobros,
} from "@/lib/textil.functions";
import type { Cobro } from "@/lib/cobros.functions";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { LineasEditor, type Linea } from "@/components/textil/LineasEditor";
import {
  SelectorClienteTextil,
  type ClienteTextil,
} from "@/components/textil/SelectorClienteTextil";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { CobrosPedidoDialog, EstadoCobroTexto } from "@/components/cobros/CobrosPedidoDialog";
import { resumenCobros } from "@/dominio/cobros";
import { normalizarTexto } from "@/dominio/clientes";
import { useFiltrosUrl } from "@/lib/filtros-url";
import {
  BarraFiltros,
  CampoBusqueda,
  QuitarFiltros,
  SelectFiltro,
} from "@/components/filtros/Filtros";

export const Route = createFileRoute("/panel/textil/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos textil · DTF Culture" }] }),
  component: PedidosPage,
});

const ESTADOS = ["pendiente", "en_produccion", "listo", "enviado", "entregado", "cancelado"];

const FILTROS_PEDIDOS_TEXTIL = { q: "", estado: "todos", cobro: "todos" };

function PedidosPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTextilPedidos);
  const upsertFn = useServerFn(upsertTextilPedido);
  const estFn = useServerFn(updateTextilPedidoEstado);
  const delFn = useServerFn(deleteTextilPedido);
  const cliFn = useServerFn(listTextilClientes);
  const marcasFn = useServerFn(listMarcas);
  const empFn = useServerFn(getEmpresaGlobal);
  const stockFn = useServerFn(listStock);

  const { data = [] } = useQuery({ queryKey: ["textil-pedidos"], queryFn: () => listFn() });
  const { valores: filtros, cambiar, quitar, hay } = useFiltrosUrl(FILTROS_PEDIDOS_TEXTIL);
  const { data: clientes = [] } = useQuery({
    queryKey: ["textil-clientes"],
    queryFn: () => cliFn(),
  });
  const { data: marcas = [] } = useQuery({
    queryKey: ["textil-marcas"],
    queryFn: () => marcasFn(),
  });
  const { data: empresa } = useQuery({ queryKey: ["empresa-global"], queryFn: () => empFn() });
  const { data: stock = [] } = useQuery({ queryKey: ["textil-stock"], queryFn: () => stockFn() });
  const cobrosFn = useServerFn(listTextilCobros);
  const { data: datosCobros } = useQuery({
    queryKey: ["textil-cobros"],
    queryFn: () => cobrosFn(),
  });
  const cobrosPorPedido = useMemo(() => {
    const m = new Map<string, Cobro[]>();
    for (const c of datosCobros?.cobros ?? []) {
      if (!c.textil_pedido_id) continue;
      m.set(c.textil_pedido_id, [...(m.get(c.textil_pedido_id) ?? []), c]);
    }
    return m;
  }, [datosCobros]);
  const cobrosDisponibles = datosCobros?.disponible ?? true;

  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return (data as any[]).filter((p) => {
      if (filtros.estado !== "todos" && p.estado !== filtros.estado) return false;
      if (filtros.cobro !== "todos") {
        // «Con algo pendiente» incluye lo cobrado en parte.
        const e = resumenCobros(p.total, cobrosPorPedido.get(p.id) ?? []).estado;
        if (filtros.cobro === "pendiente" && e !== "pendiente" && e !== "parcial") return false;
        if (filtros.cobro === "parcial" && e !== "parcial") return false;
        if (filtros.cobro === "cobrado" && e !== "cobrado" && e !== "excedido") return false;
      }
      return (
        !q ||
        normalizarTexto(p.numero).includes(q) ||
        normalizarTexto(p.cliente_nombre).includes(q) ||
        normalizarTexto(p.marca?.nombre).includes(q)
      );
    });
  }, [data, filtros.q, filtros.estado, filtros.cobro, cobrosPorPedido]);

  const [open, setOpen] = useState(false);
  const [borrando, setBorrando] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [cobrando, setCobrando] = useState<any>(null);

  const inv = () => qc.invalidateQueries({ queryKey: ["textil-pedidos"] });
  const save = useMutation({
    mutationFn: (d: any) => upsertFn({ data: d }),
    onSuccess: () => {
      inv();
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      toast.success("Guardado");
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const setEst = useMutation({
    mutationFn: ({ id, estado }: any) => estFn({ data: { id, estado } }),
    onSuccess: () => {
      inv();
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      inv();
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      toast.success("Eliminado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const defaultMarcaId = (empresa as any)?.textil_marca_predeterminada_id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pedidos textil</h1>
          <p className="text-sm text-muted-foreground">Pedidos manuales del módulo textil.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Nuevo pedido
        </Button>
      </div>
      {!cobrosDisponibles && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Los cobros de los pedidos necesitan la migración <code>20260929100000_cobros.sql</code>.
            Hasta que se aplique, no se pueden registrar.
          </CardContent>
        </Card>
      )}
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
            ...ESTADOS.map((e) => ({ valor: e, etiqueta: e.replace("_", " ") })),
          ]}
        />
        {cobrosDisponibles && (
          <SelectFiltro
            etiqueta="Cobro"
            valor={filtros.cobro}
            alCambiar={(cobro) => cambiar({ cobro })}
            opciones={[
              { valor: "todos", etiqueta: "Cobrado o no" },
              { valor: "pendiente", etiqueta: "Con algo pendiente" },
              { valor: "parcial", etiqueta: "Cobrado en parte" },
              { valor: "cobrado", etiqueta: "Cobrado entero" },
            ]}
          />
        )}
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
        <div className="text-xs text-muted-foreground ml-auto">
          {filtrados.length} pedido{filtrados.length === 1 ? "" : "s"}
        </div>
      </BarraFiltros>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {data.length === 0 ? "Sin pedidos." : "Ningún pedido cumple los filtros."}
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((p: any) => {
                const cobro = resumenCobros(p.total, cobrosPorPedido.get(p.id) ?? []);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                    <TableCell>{fechaCorta(p.fecha)}</TableCell>
                    <TableCell>{p.cliente_nombre ?? "—"}</TableCell>
                    <TableCell>{p.marca?.nombre ?? "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={p.estado}
                        onValueChange={(v) => setEst.mutate({ id: p.id, estado: v })}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTADOS.map((e) => (
                            <SelectItem key={e} value={e}>
                              {e}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-medium">{eur(Number(p.total))}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(cobro.cobrado)}</TableCell>
                    <TableCell className="text-right">
                      <div className="tabular-nums">{eur(Math.max(cobro.pendiente, 0))}</div>
                      {p.estado !== "cancelado" && <EstadoCobroTexto estado={cobro.estado} />}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Cobros"
                        title="Cobros"
                        disabled={!cobrosDisponibles}
                        onClick={() => setCobrando(p)}
                      >
                        <Wallet className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(p);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setBorrando(p)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`el pedido ${borrando?.numero ?? ""}`}
        consecuencias={
          borrando?.estado === "enviado" || borrando?.estado === "entregado"
            ? ["El género que salió con este pedido vuelve al stock."]
            : ["El stock que tenía reservado queda libre."]
        }
        cargando={del.isPending}
        onConfirmar={() => {
          del.mutate(borrando.id);
          setBorrando(null);
        }}
      />

      {cobrando && (
        <CobrosPedidoDialog
          open={!!cobrando}
          onOpenChange={(o) => !o && setCobrando(null)}
          pedido={(() => {
            const p = data.find((x: any) => x.id === cobrando.id) ?? cobrando;
            return {
              id: p.id,
              numero: p.numero,
              total: p.total,
              tipo: "textil" as const,
              cancelado: p.estado === "cancelado",
            };
          })()}
          cobros={cobrosPorPedido.get(cobrando.id) ?? []}
        />
      )}

      {open && (
        <PedidoDialog
          open={open}
          onOpenChange={setOpen}
          pedido={editing}
          clientes={clientes}
          marcas={marcas}
          stock={stock}
          defaultMarcaId={defaultMarcaId}
          onSave={(v: any) => save.mutate(v)}
          loading={save.isPending}
        />
      )}
    </div>
  );
}

function PedidoDialog({
  open,
  onOpenChange,
  pedido,
  clientes,
  marcas,
  stock,
  defaultMarcaId,
  onSave,
  loading,
}: any) {
  const initial = pedido ?? {
    fecha: new Date().toISOString().slice(0, 10),
    estado: "pendiente",
    envio: 0,
    marca_id: defaultMarcaId,
    items: [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_pct: 21 }],
  };
  const [f, setF] = useState<any>({
    ...initial,
    items: (initial.items ?? []).map((it: any) => ({
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      iva_pct: Number(it.iva_pct),
      stock_id: it.stock_id ?? null,
    })),
  });

  const setCliente = (c: ClienteTextil) => {
    setF({ ...f, cliente_id: c.id, cliente_nombre: c.nombre, cliente_email: c.email });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pedido ? `Editar ${pedido.numero}` : "Nuevo pedido"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Cliente</Label>
              <SelectorClienteTextil
                clientes={clientes}
                valor={f.cliente_id}
                onElegir={setCliente}
              />
            </div>
            <div>
              <Label>Marca</Label>
              <Select
                value={f.marca_id ?? "__none__"}
                onValueChange={(v) => setF({ ...f, marca_id: v === "__none__" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguna</SelectItem>
                  {marcas.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                value={f.fecha}
                onChange={(e) => setF({ ...f, fecha: e.target.value })}
              />
            </div>
            <div>
              <Label>Método pago</Label>
              <Input
                value={f.metodo_pago ?? ""}
                onChange={(e) => setF({ ...f, metodo_pago: e.target.value })}
              />
            </div>
            <div>
              <Label>Envío</Label>
              <Input
                type="number"
                step="0.01"
                value={f.envio}
                onChange={(e) => setF({ ...f, envio: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={f.estado} onValueChange={(v) => setF({ ...f, estado: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <LineasEditor
            stock={stock}
            items={f.items}
            onChange={(items: Linea[]) => setF({ ...f, items })}
          />
          <div>
            <Label>Notas</Label>
            <Textarea
              value={f.notas ?? ""}
              onChange={(e) => setF({ ...f, notas: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={loading || f.items.length === 0}
            onClick={() =>
              onSave({
                id: pedido?.id,
                cliente_id: f.cliente_id || null,
                cliente_nombre: f.cliente_nombre || null,
                cliente_email: f.cliente_email || null,
                marca_id: f.marca_id || null,
                fecha: f.fecha,
                estado: f.estado,
                metodo_pago: f.metodo_pago || null,
                envio: Number(f.envio) || 0,
                notas: f.notas || null,
                items: f.items,
              })
            }
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
