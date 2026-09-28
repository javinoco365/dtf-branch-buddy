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
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { PresupuestoFormDialog } from "@/components/presupuestos/PresupuestoFormDialog";
import { eur, fechaCorta } from "@/lib/format";
import {
  borrarPresupuesto,
  cambiarEstadoPresupuesto,
  listPresupuestosTienda,
  type Presupuesto,
} from "@/lib/presupuestos.functions";
import {
  ESTADOS_PRESUPUESTO,
  FILTRO_PRESUPUESTOS_TODO,
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

  const [filtro, setFiltro] = useState<FiltroPresupuestos>(FILTRO_PRESUPUESTOS_TODO);
  const [editando, setEditando] = useState<Presupuesto | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrando, setBorrando] = useState<Presupuesto | null>(null);

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
    () => filtrarPresupuestos(data?.presupuestos ?? [], filtro, hoy),
    [data, filtro, hoy],
  );
  const totalFiltrado = filtrados.reduce((s, p) => s + Number(p.total), 0);
  const hayFiltro = filtro.texto.trim() !== "" || filtro.estado !== "todos";

  const refrescar = () => qc.invalidateQueries({ queryKey: ["presupuestos", tiendaId] });

  const estadoMut = useMutation({
    mutationFn: (v: { id: string; estado: EstadoPresupuesto }) => cambiarEstado({ data: v }),
    onSuccess: () => {
      toast.success("Estado actualizado");
      refrescar();
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
              value={filtro.texto}
              onChange={(e) => setFiltro((f) => ({ ...f, texto: e.target.value }))}
              className="pl-9"
            />
          </div>
          <Select
            value={filtro.estado}
            onValueChange={(v) =>
              setFiltro((f) => ({ ...f, estado: v as FiltroPresupuestos["estado"] }))
            }
          >
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
          {hayFiltro && (
            <Button variant="ghost" size="sm" onClick={() => setFiltro(FILTRO_PRESUPUESTOS_TODO)}>
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
            <Table>
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
                            <DropdownMenuSeparator />
                            {ESTADOS_PRESUPUESTO.filter((e) => e.valor !== p.estado).map((e) => (
                              <DropdownMenuItem
                                key={e.valor}
                                onClick={() => estadoMut.mutate({ id: p.id, estado: e.valor })}
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
