import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, MoreVertical, Plus, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EstadoVacio } from "@/components/EstadoVacio";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { PresupuestoFormDialog } from "@/components/presupuestos/PresupuestoFormDialog";
import { eur, fechaCorta } from "@/lib/format";
import { useFiltrosUrl, usePeriodoUrl, useTextoDiferido } from "@/lib/filtros-url";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { enRango } from "@/dominio/periodos";
import {
  borrarPresupuesto,
  cambiarEstadoPresupuesto,
  confirmarPresupuesto,
  listPresupuestosTienda,
  type Presupuesto,
} from "@/lib/presupuestos.functions";
import {
  ESTADOS_PRESUPUESTO,
  estadoVisible,
  etiquetaEstadoPresupuesto,
  filtrarPresupuestos,
  validoHasta,
  type EstadoPresupuesto,
  type EstadoVisiblePresupuesto,
  type FiltroPresupuestos,
} from "@/dominio/presupuestos";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/presupuestos")({
  component: PresupuestosTienda,
});

const VARIANTE: Record<
  EstadoVisiblePresupuesto,
  "default" | "secondary" | "outline" | "destructive"
> = {
  borrador: "outline",
  enviado: "secondary",
  aceptado: "default",
  rechazado: "destructive",
  caducado: "outline",
};

function PresupuestosTienda() {
  const { tiendaId } = Route.useParams();
  const qc = useQueryClient();
  const listar = useServerFn(listPresupuestosTienda);
  const cambiarEstado = useServerFn(cambiarEstadoPresupuesto);
  const borrar = useServerFn(borrarPresupuesto);
  const confirmar = useServerFn(confirmarPresupuesto);

  // Los filtros viven en la dirección.
  const { valores: u, cambiar, quitar, hay } = useFiltrosUrl({ q: "", estado: "todos" });
  // Por defecto, todo: la lista se abre como siempre.
  const periodo = usePeriodoUrl("todo");
  const [texto, setTexto] = useTextoDiferido(u.q, (q) => cambiar({ q }));
  const filtro: FiltroPresupuestos = useMemo(
    () => ({ texto: u.q, estado: u.estado as FiltroPresupuestos["estado"] }),
    [u.q, u.estado],
  );
  const [editando, setEditando] = useState<Presupuesto | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrando, setBorrando] = useState<Presupuesto | null>(null);
  const [confirmando, setConfirmando] = useState<Presupuesto | null>(null);

  const { data: tienda } = useQuery({
    queryKey: ["tienda-nombre", tiendaId],
    queryFn: async () =>
      (await supabase.from("tiendas").select("nombre").eq("id", tiendaId).maybeSingle()).data,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["presupuestos", tiendaId],
    queryFn: () => listar({ data: { tiendaId } }),
  });

  const hoy = useMemo(() => new Date(), []);
  const filtrados = useMemo(
    () =>
      filtrarPresupuestos(data?.presupuestos ?? [], filtro, hoy).filter((p) =>
        enRango(p.fecha, periodo.rango),
      ),
    [data, filtro, hoy, periodo.rango],
  );
  const totalFiltrado = filtrados.reduce((s, p) => s + Number(p.total), 0);
  const hayFiltro = hay();

  const refrescar = () => qc.invalidateQueries({ queryKey: ["presupuestos", tiendaId] });

  const estadoMut = useMutation({
    mutationFn: (v: { id: string; estado: EstadoPresupuesto }) => cambiarEstado({ data: v }),
    onSuccess: () => {
      toast.success("Estado actualizado");
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmarMut = useMutation({
    mutationFn: (id: string) => confirmar({ data: { id } }),
    onSuccess: (r) => {
      toast.success(r.numero ? `Pedido ${r.numero} creado` : "Pedido creado");
      setConfirmando(null);
      refrescar();
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      qc.invalidateQueries({ queryKey: ["cobros-pendientes-pedidos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const borrarMut = useMutation({
    mutationFn: (id: string) => borrar({ data: { id } }),
    onSuccess: () => {
      toast.success("Presupuesto borrado");
      setBorrando(null);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Presupuestos · {tienda?.nombre ?? "Tienda"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Presupuestos de esta tienda, con productos del catálogo o líneas libres.
          </p>
        </div>
        <Button onClick={() => setNuevo(true)} disabled={data?.disponible === false}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo presupuesto
        </Button>
      </div>

      {data?.disponible === false && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Los presupuestos de tienda necesitan la migración{" "}
            <code>20261001100000_presupuestos_tiendas.sql</code>.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se han podido cargar los presupuestos: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente o nº de presupuesto…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filtro.estado} onValueChange={(v) => cambiar({ estado: v })}>
            <SelectTrigger className="w-[180px]" aria-label="Estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS_PRESUPUESTO.map((e) => (
                <SelectItem key={e.valor} value={e.valor}>
                  {e.etiqueta}
                </SelectItem>
              ))}
              <SelectItem value="caducado">Caducado</SelectItem>
            </SelectContent>
          </Select>
          <SelectorPeriodo periodo={periodo} />
          {hayFiltro && (
            <Button variant="ghost" size="sm" onClick={() => quitar()}>
              <X className="h-4 w-4 mr-1" /> Quitar filtros
            </Button>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {filtrados.length} presupuesto{filtrados.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold text-foreground">{eur(totalFiltrado)}</span>
          </div>
        </CardContent>
      </Card>

      {!isLoading && !error && data?.disponible !== false && filtrados.length === 0 ? (
        <EstadoVacio
          icono={FileText}
          titulo={hayFiltro ? "Nada con estos filtros" : "Todavía no hay presupuestos"}
          descripcion={
            hayFiltro
              ? "Ningún presupuesto cumple los filtros elegidos."
              : "Crea el primero con «Nuevo presupuesto»."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Válido hasta</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Cargando…
                    </TableCell>
                  </TableRow>
                )}
                {filtrados.map((p) => {
                  const visible = estadoVisible(p, hoy);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                      <TableCell>{fechaCorta(p.fecha)}</TableCell>
                      <TableCell>{fechaCorta(validoHasta(p.fecha, p.validez_dias))}</TableCell>
                      <TableCell className="max-w-[240px] truncate">
                        {p.cliente_nombre ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={VARIANTE[visible]}>
                          {etiquetaEstadoPresupuesto(visible)}
                        </Badge>
                        {p.pedido?.numero && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Pedido <span className="font-mono">{p.pedido.numero}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {eur(Number(p.total))}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setEditando(p)}
                              disabled={!!p.pedido_id}
                            >
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setConfirmando(p)}
                              disabled={!!p.pedido_id || p.estado === "rechazado"}
                            >
                              Confirmar: crear el pedido
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {ESTADOS_PRESUPUESTO.filter((e) => e.valor !== p.estado).map((e) => (
                              <DropdownMenuItem
                                key={e.valor}
                                onClick={() => estadoMut.mutate({ id: p.id, estado: e.valor })}
                                disabled={!!p.pedido_id}
                              >
                                Marcar como {e.etiqueta.toLowerCase()}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setBorrando(p)}
                              disabled={!!p.pedido_id}
                            >
                              Borrar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <PresupuestoFormDialog
        open={nuevo || !!editando}
        onOpenChange={(o) => {
          if (!o) {
            setNuevo(false);
            setEditando(null);
          }
        }}
        tiendaId={tiendaId}
        presupuesto={editando ?? undefined}
        onGuardado={() => {
          setNuevo(false);
          setEditando(null);
          refrescar();
        }}
      />

      <AlertDialog open={!!confirmando} onOpenChange={(o) => !o && setConfirmando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar el presupuesto {confirmando?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se crea un pedido de esta tienda con las mismas líneas e importes (
              {eur(Number(confirmando?.total ?? 0))}). El presupuesto queda aceptado y ya no se
              edita. Los cobros, parciales o no, se registran luego en el pedido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmarMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmando) confirmarMut.mutate(confirmando.id);
              }}
            >
              {confirmarMut.isPending ? "Creando…" : "Crear el pedido"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`el presupuesto ${borrando?.numero ?? ""}`}
        consecuencias={["Se borran también sus líneas.", "Su número no se vuelve a usar."]}
        cargando={borrarMut.isPending}
        onConfirmar={() => borrando && borrarMut.mutate(borrando.id)}
      />
    </div>
  );
}
