import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Clock, Search, Wallet, X } from "lucide-react";
import { eur, fechaCorta } from "@/lib/format";
import { faltaLaTabla, tabla } from "@/lib/rpc";
import { useTiendas } from "@/lib/periodo";
import type { Cobro } from "@/lib/cobros.functions";
import { CobrosPedidoDialog } from "@/components/cobros/CobrosPedidoDialog";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import {
  DIAS_ANTIGUO,
  FILTRO_PENDIENTES_TODO,
  ORIGENES_PENDIENTE,
  diasDesde,
  filtrarPendientes,
  ordenarPendientes,
  origenPendiente,
  resumirPendientes,
  tiendaDelPendiente,
  type FiltroPendientes,
  type PedidoPendiente,
} from "@/dominio/pendientes";

const ETIQUETA_ORIGEN = Object.fromEntries(ORIGENES_PENDIENTE.map((o) => [o.valor, o.etiqueta]));

/**
 * Lo que queda por cobrar de los pedidos, de todas las tiendas y del textil.
 *
 * Lee la vista pedidos_pendientes_cobro, que ya trae solo los pedidos vivos
 * con saldo. «Cobrar» abre el mismo diálogo de cobros que los pedidos: lo
 * cobrado sale de aquí en cuanto el pedido queda saldado.
 */
export function PedidosPendientes({ tiendaId }: { tiendaId?: string }) {
  const [filtro, setFiltro] = useState<FiltroPendientes>(
    tiendaId ? { ...FILTRO_PENDIENTES_TODO, tienda: tiendaId } : FILTRO_PENDIENTES_TODO,
  );
  const [cobrando, setCobrando] = useState<PedidoPendiente | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cobros-pendientes-pedidos", tiendaId ?? "todas"],
    queryFn: async (): Promise<{ disponible: boolean; pedidos: PedidoPendiente[] }> => {
      let q = tabla(supabase, "pedidos_pendientes_cobro").select("*");
      if (tiendaId) q = q.eq("tienda_id", tiendaId);
      const { data, error } = await q;
      if (faltaLaTabla(error)) return { disponible: false, pedidos: [] };
      if (error) throw error;
      return { disponible: true, pedidos: (data ?? []) as PedidoPendiente[] };
    },
  });

  const { data: tiendas = [] } = useTiendas();
  const tiendasYTextil = useMemo(() => [...tiendas, TIENDA_TEXTIL], [tiendas]);
  const nombreTienda = useMemo(
    () => new Map(tiendasYTextil.map((t) => [t.id, t.nombre])),
    [tiendasYTextil],
  );

  const hoy = useMemo(() => new Date(), []);
  const filtrados = useMemo(
    () => ordenarPendientes(filtrarPendientes(data?.pedidos ?? [], filtro)),
    [data, filtro],
  );
  const resumen = useMemo(() => resumirPendientes(filtrados, hoy), [filtrados, hoy]);

  const hayFiltro =
    filtro.texto.trim() !== "" ||
    (!tiendaId && filtro.tienda !== "todas") ||
    filtro.origen !== "todos" ||
    filtro.soloParciales;

  if (data && !data.disponible) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Los pedidos pendientes necesitan la migración{" "}
          <code>20260930100000_pedidos_pendientes_cobro.sql</code>.
        </CardContent>
      </Card>
    );
  }

  const columnas = tiendaId ? 8 : 9;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Total pendiente"
          value={eur(resumen.pendiente)}
        />
        <Kpi
          icon={<Clock className="h-4 w-4" />}
          label="Pedidos por cobrar"
          value={String(resumen.pedidos)}
          subtitle={`${resumen.parciales} cobrado${resumen.parciales === 1 ? "" : "s"} en parte`}
        />
        <Kpi
          icon={<AlertTriangle className="h-4 w-4" />}
          label={`Más de ${DIAS_ANTIGUO} días`}
          value={eur(resumen.pendienteAntiguo)}
          subtitle={`${resumen.antiguos} pedido${resumen.antiguos === 1 ? "" : "s"}`}
          peligro={resumen.antiguos > 0}
        />
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente o nº de pedido…"
              value={filtro.texto}
              onChange={(e) => setFiltro((f) => ({ ...f, texto: e.target.value }))}
              className="pl-9"
            />
          </div>
          {!tiendaId && (
            <Select
              value={filtro.tienda}
              onValueChange={(v) => setFiltro((f) => ({ ...f, tienda: v }))}
            >
              <SelectTrigger className="w-[190px]" aria-label="Tienda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las tiendas</SelectItem>
                {tiendasYTextil.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={filtro.origen}
            onValueChange={(v) =>
              setFiltro((f) => ({ ...f, origen: v as FiltroPendientes["origen"] }))
            }
          >
            <SelectTrigger className="w-[180px]" aria-label="Origen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los orígenes</SelectItem>
              {ORIGENES_PENDIENTE.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm cursor-pointer px-2">
            <Checkbox
              checked={filtro.soloParciales}
              onCheckedChange={(v) => setFiltro((f) => ({ ...f, soloParciales: v === true }))}
            />
            Solo cobrados en parte
          </label>
          {hayFiltro && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFiltro(
                  tiendaId
                    ? { ...FILTRO_PENDIENTES_TODO, tienda: tiendaId }
                    : FILTRO_PENDIENTES_TODO,
                )
              }
            >
              <X className="h-4 w-4 mr-1" /> Quitar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            No se han podido cargar los pendientes: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                {!tiendaId && <TableHead>Tienda</TableHead>}
                <TableHead>Origen</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={columnas} className="text-center py-8 text-muted-foreground">
                    Cargando…
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((p) => {
                const dias = diasDesde(p.fecha, hoy);
                const origen = origenPendiente(p);
                return (
                  <TableRow key={`${p.tipo}-${p.id}`}>
                    <TableCell>
                      {fechaCorta(p.fecha)}
                      <div
                        className={`text-xs ${
                          dias > DIAS_ANTIGUO
                            ? "text-destructive font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {dias === 0 ? "hoy" : `hace ${dias} día${dias === 1 ? "" : "s"}`}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {p.cliente_nombre ?? "—"}
                    </TableCell>
                    {!tiendaId && (
                      <TableCell className="text-xs text-muted-foreground">
                        {nombreTienda.get(tiendaDelPendiente(p)) ?? "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={origen === "web" ? "default" : "outline"}>
                        {ETIQUETA_ORIGEN[origen]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(Number(p.total))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(p.cobrado) > 0 ? eur(Number(p.cobrado)) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {eur(Number(p.pendiente))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setCobrando(p)}>
                        {origen === "web" ? "Ver" : "Cobrar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && !error && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnas} className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40 text-green-600" />
                    {hayFiltro
                      ? "Ningún pedido pendiente cumple los filtros."
                      : "Todo cobrado: no hay pedidos pendientes."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {filtrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={columnas - 2} className="font-semibold">
                    TOTAL PENDIENTE
                  </TableCell>
                  <TableCell className="text-right font-bold">{eur(resumen.pendiente)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {cobrando && <CobrarPendiente pedido={cobrando} onCerrar={() => setCobrando(null)} />}
    </div>
  );
}

/** El diálogo de cobros de un pedido pendiente, con sus cobros leídos al abrirlo. */
function CobrarPendiente({ pedido, onCerrar }: { pedido: PedidoPendiente; onCerrar: () => void }) {
  const columna = pedido.tipo === "tienda" ? "pedido_id" : "textil_pedido_id";
  const { data: cobros = [] } = useQuery({
    queryKey: ["cobros-pedido", pedido.id],
    queryFn: async () => {
      const { data, error } = await tabla(supabase, "cobros")
        .select("*")
        .eq(columna, pedido.id)
        .order("fecha", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Cobro[];
    },
  });

  return (
    <CobrosPedidoDialog
      open
      onOpenChange={(o) => !o && onCerrar()}
      pedido={{
        id: pedido.id,
        numero: pedido.numero,
        total: pedido.total ?? 0,
        tipo: pedido.tipo,
        cancelado: false,
        web: pedido.tipo === "tienda" && pedido.origen === "woocommerce",
      }}
      cobros={cobros}
    />
  );
}

function Kpi({
  icon,
  label,
  value,
  subtitle,
  peligro,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  peligro?: boolean;
}) {
  return (
    <Card className={peligro ? "border-destructive/30 bg-destructive/5" : ""}>
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
