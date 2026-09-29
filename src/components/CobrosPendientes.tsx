import { useMemo } from "react";
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
import { CheckCircle2, AlertTriangle, Clock, Wallet, Search, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFiltrosUrl, useTextoDiferido } from "@/lib/filtros-url";
import { useTiendas } from "@/lib/periodo";

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

  const { data: facturas = [], isLoading } = useQuery({
    queryKey: ["cobros-pendientes", tiendaId ?? "global"],
    queryFn: async () => {
      let q = supabase
        .from("facturas")
        .select(
          "id,tienda_id,serie,numero,fecha,fecha_vencimiento,estado,cliente_nombre,total,tiendas(nombre,color)",
        )
        .in("estado", ["emitida", "vencida", "borrador"])
        .order("fecha", { ascending: true });
      if (tiendaId) q = q.eq("tienda_id", tiendaId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Factura[];
    },
  });

  const marcar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("facturas").update({ estado: "pagada" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marcada como cobrada");
      qc.invalidateQueries({ queryKey: ["cobros-pendientes"] });
      qc.invalidateQueries({ queryKey: ["facturas"] });
    },
    onError: (e: any) => toast.error(e.message),
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

  const totalPendiente = filtradas.reduce((s, f) => s + Number(f.total), 0);
  const vencidas = filtradas.filter((f) => diasVencidos(f) > 0);
  const totalVencido = vencidas.reduce((s, f) => s + Number(f.total), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <KPI
          icon={<Wallet className="h-4 w-4" />}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Nº</TableHead>
                {!tiendaId && <TableHead>Tienda</TableHead>}
                <TableHead>Cliente</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Importe</TableHead>
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
                    <TableCell className="text-right font-semibold">{eur(f.total)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => marcar.mutate(f.id)}
                        disabled={marcar.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1 text-green-600" /> Cobrado
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && filtradas.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={tiendaId ? 7 : 8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40 text-green-600" />
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
