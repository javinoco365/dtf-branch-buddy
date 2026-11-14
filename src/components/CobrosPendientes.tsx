import { useMemo, useState } from "react";
import { SiPuede } from "@/components/SiPuede";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eur, fechaCorta } from "@/lib/format";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Clock, Search, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFiltrosUrl, useTextoDiferido } from "@/lib/filtros-url";
import { useTiendas } from "@/lib/periodo";
import { avisarError } from "@/lib/errores";
import { ErrorCarga } from "@/components/ErrorCarga";
import { useServerFn } from "@tanstack/react-start";
import { cambiarEstadoCobro } from "@/lib/facturas.functions";
import { leerPorIds } from "@/lib/leer-por-ids";
import { tabla } from "@/lib/rpc";
import { pendienteDeFactura } from "@/dominio/cuenta";
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
import { ICONO } from "@/components/iconos";

type Factura = {
  id: string;
  tienda_id: string;
  serie: string;
  numero: number;
  fecha: string;
  fecha_vencimiento: string | null;
  estado: string;
  cliente_nombre: string | null;
  total: number;
  pedido_id: string | null;
  /** Lo cobrado de su pedido, con IVA (0 sin pedido). */
  cobrado: number;
  /** Lo que falta: total − cobrado; 0 en un borrador (ver pendienteDeFactura). */
  pendiente: number;
  tiendas?: { nombre: string; color: string | null } | null;
};

function diasVencidos(f: Factura) {
  const ref = f.fecha_vencimiento ?? f.fecha;
  const d = new Date(ref);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  return diff;
}

const FILTROS_FACTURAS = { fq: "", ftienda: "todas", festado: "todas" };

export function CobrosPendientes({ tiendaId }: { tiendaId?: string }) {
  const qc = useQueryClient();
  // Con prefijo «f»: comparten la dirección con los filtros de la pestaña de
  // pedidos y no deben pisarse.
  const { valores: filtros, cambiar, quitar, hay } = useFiltrosUrl(FILTROS_FACTURAS);
  const [busqueda, setBusqueda] = useTextoDiferido(filtros.fq, (fq) => cambiar({ fq }));
  const { data: tiendasLista = [] } = useTiendas();

  const {
    data: facturas = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["cobros-pendientes", tiendaId ?? "global"],
    queryFn: async () => {
      let q = supabase
        .from("facturas")
        .select(
          "id,tienda_id,pedido_id,serie,numero,fecha,fecha_vencimiento,estado,cliente_nombre,total,tiendas(nombre,color)",
        )
        .in("estado", ["emitida", "vencida", "borrador"])
        .order("fecha", { ascending: true });
      if (tiendaId) q = q.eq("tienda_id", tiendaId);
      const { data, error } = await q;
      if (error) throw error;
      const filas = (data ?? []) as unknown as Omit<Factura, "cobrado" | "pendiente">[];
      // Lo ya cobrado de cada pedido: un pago a medias no es deuda entera.
      const pedidos = filas.map((f) => f.pedido_id).filter((id): id is string => !!id);
      const { data: cobros, error: errCobros } = await leerPorIds<{
        pedido_id: string;
        importe: number;
      }>(pedidos, (trozo, a, b) =>
        tabla(supabase, "cobros")
          .select("pedido_id, importe")
          .in("pedido_id", trozo)
          .order("id")
          .range(a, b),
      );
      if (errCobros) throw new Error(errCobros.message);
      const cobradoDe = new Map<string, number>();
      for (const c of cobros) {
        cobradoDe.set(c.pedido_id, (cobradoDe.get(c.pedido_id) ?? 0) + Number(c.importe));
      }
      return filas.map((f): Factura => {
        const cobrado = f.pedido_id ? (cobradoDe.get(f.pedido_id) ?? 0) : 0;
        return { ...f, cobrado, pendiente: pendienteDeFactura({ ...f, cobrado }) };
      });
    },
  });

  // Por el servidor y factura_cambiar_estado_cobro(), como el ✓ de Tienda ›
  // Facturas. Antes escribía en `facturas` desde el navegador, que no tiene ese
  // permiso desde 20260902130000_motor_facturacion.sql: el botón siempre fallaba.
  // Con un toque se marcaba pagada la factura que no era: ahora se confirma,
  // con la factura y lo que falta por cobrar a la vista.
  const [cobrando, setCobrando] = useState<Factura | null>(null);
  const cambiarEstadoFn = useServerFn(cambiarEstadoCobro);
  const marcar = useMutation({
    mutationFn: (id: string) => cambiarEstadoFn({ data: { factura_id: id, estado: "pagada" } }),
    onSuccess: () => {
      toast.success("Marcada como cobrada");
      setCobrando(null);
      qc.invalidateQueries({ queryKey: ["cobros-pendientes"] });
      qc.invalidateQueries({ queryKey: ["facturas"] });
    },
    onError: (e: any) => avisarError(e),
  });

  const filtradas = useMemo(() => {
    const q = filtros.fq.trim().toLowerCase();
    return facturas.filter((f) => {
      if (!tiendaId && filtros.ftienda !== "todas" && f.tienda_id !== filtros.ftienda) return false;
      if (filtros.festado === "vencida" && diasVencidos(f) <= 0) return false;
      if (filtros.festado === "al_dia" && diasVencidos(f) > 0) return false;
      if (filtros.festado === "borrador" && f.estado !== "borrador") return false;
      if (!q) return true;
      return (
        (f.cliente_nombre ?? "").toLowerCase().includes(q) ||
        `${f.serie}-${f.numero}`.toLowerCase().includes(q) ||
        (f.tiendas?.nombre ?? "").toLowerCase().includes(q)
      );
    });
  }, [facturas, filtros.fq, filtros.ftienda, filtros.festado, tiendaId]);

  // Lo que de verdad se debe: sin borradores y restando lo ya cobrado.
  const totalPendiente = filtradas.reduce((s, f) => s + f.pendiente, 0);
  const vencidas = filtradas.filter((f) => f.estado !== "borrador" && diasVencidos(f) > 0);
  const totalVencido = vencidas.reduce((s, f) => s + f.pendiente, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <KPI
          icon={<ICONO.pendienteCobro className="h-4 w-4" />}
          label="Total pendiente"
          value={eur(totalPendiente)}
          tone="default"
        />
        <KPI
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Vencido"
          value={eur(totalVencido)}
          subtitle={`${vencidas.length} factura${vencidas.length === 1 ? "" : "s"}`}
          tone="danger"
        />
        <KPI
          icon={<Clock className="h-4 w-4" />}
          label="Facturas pendientes"
          value={String(filtradas.length)}
          tone="muted"
        />
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, nº factura o tienda…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          {!tiendaId && (
            <Select value={filtros.ftienda} onValueChange={(ftienda) => cambiar({ ftienda })}>
              <SelectTrigger className="w-[180px]" aria-label="Tienda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las tiendas</SelectItem>
                {tiendasLista.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={filtros.festado} onValueChange={(festado) => cambiar({ festado })}>
            <SelectTrigger className="w-[170px]" aria-label="Situación">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="vencida">Vencidas</SelectItem>
              <SelectItem value="al_dia">Sin vencer</SelectItem>
              <SelectItem value="borrador">Borradores</SelectItem>
            </SelectContent>
          </Select>
          {hay() && (
            <Button variant="ghost" size="sm" onClick={() => quitar()}>
              <X className="h-4 w-4 mr-1" /> Quitar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Nº</TableHead>
                {!tiendaId && <TableHead>Tienda</TableHead>}
                <TableHead>Cliente</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Falta por cobrar</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((f) => {
                const dias = diasVencidos(f);
                const vencida = dias > 0;
                return (
                  <TableRow key={f.id}>
                    <TableCell>{fechaCorta(f.fecha)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {f.serie}-{String(f.numero).padStart(5, "0")}
                    </TableCell>
                    {!tiendaId && (
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              background: f.tiendas?.color ?? "hsl(var(--muted-foreground))",
                            }}
                          />
                          {f.tiendas?.nombre ?? "—"}
                        </span>
                      </TableCell>
                    )}
                    <TableCell>{f.cliente_nombre ?? "—"}</TableCell>
                    <TableCell>
                      {f.fecha_vencimiento ? fechaCorta(f.fecha_vencimiento) : "—"}
                      {vencida && (
                        <div className="text-xs text-destructive font-medium">
                          {dias} día{dias === 1 ? "" : "s"} vencida
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={vencida ? "destructive" : "secondary"}>
                        {vencida ? "vencida" : f.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {f.estado === "borrador" ? (
                        <span className="text-muted-foreground">{eur(f.total)}</span>
                      ) : (
                        eur(f.pendiente)
                      )}
                      {f.estado === "borrador" && (
                        <div className="text-xs font-normal text-muted-foreground">
                          borrador: no suma
                        </div>
                      )}
                      {f.estado !== "borrador" && f.cobrado > 0 && (
                        <div className="text-xs font-normal text-muted-foreground">
                          de {eur(f.total)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <SiPuede accion="escribir">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCobrando(f)}
                          disabled={marcar.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1 text-aviso-bien-texto" /> Cobrado
                        </Button>
                      </SiPuede>
                    </TableCell>
                  </TableRow>
                );
              })}
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={tiendaId ? 7 : 8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Cargando…
                  </TableCell>
                </TableRow>
              )}
              {error && !isLoading && (
                <ErrorCarga
                  error={error}
                  que="los cobros pendientes"
                  onReintentar={refetch}
                  reintentando={isFetching}
                  colSpan={tiendaId ? 7 : 8}
                />
              )}
              {!isLoading && !error && filtradas.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={tiendaId ? 7 : 8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40 text-aviso-bien-texto" />
                    Sin cobros pendientes.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {filtradas.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={tiendaId ? 5 : 6} className="font-semibold">
                    TOTAL PENDIENTE
                  </TableCell>
                  <TableCell className="text-right font-bold">{eur(totalPendiente)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!cobrando}
        onOpenChange={(o) => !o && !marcar.isPending && setCobrando(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Marcar como cobrada la factura{" "}
              {cobrando ? `${cobrando.serie}-${String(cobrando.numero).padStart(5, "0")}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {cobrando && (
                  <p>
                    {cobrando.cliente_nombre ?? "Sin cliente"} · emitida el{" "}
                    {fechaCorta(cobrando.fecha)}
                    {cobrando.tiendas?.nombre ? ` · ${cobrando.tiendas.nombre}` : ""}
                  </p>
                )}
                <p>
                  Queda pendiente{" "}
                  <span className="font-semibold text-foreground">
                    {eur(cobrando ? Number(cobrando.total) : 0)}
                  </span>
                  . Al confirmar, la factura pasa a pagada y deja de salir aquí.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={marcar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={marcar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (cobrando) marcar.mutate(cobrando.id);
              }}
            >
              {marcar.isPending ? "Marcando…" : "Sí, está cobrada"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KPI({
  icon,
  label,
  value,
  subtitle,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  tone: "default" | "danger" | "muted";
}) {
  const toneCls =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "muted"
        ? "bg-muted/30"
        : "";
  return (
    <Card className={toneCls}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
          {icon} {label}
        </div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}
