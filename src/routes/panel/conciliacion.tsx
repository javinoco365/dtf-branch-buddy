import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Check, FileUp, Loader2, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { esSegura, type Propuesta } from "@/dominio/conciliacion";
import {
  conciliar,
  desconciliar,
  importarExtracto,
  listMovimientosBanco,
  proponerConciliacion,
} from "@/lib/banco.functions";

export const Route = createFileRoute("/panel/conciliacion")({
  head: () => ({ meta: [{ title: "Conciliación bancaria · CRM DTF" }] }),
  component: ConciliacionPage,
});

const ETIQUETA_MOTIVO: Record<string, string> = {
  referencia: "Trae el número de factura",
  cliente_e_importe: "Cliente e importe",
  importe: "Solo el importe",
};

function ConciliacionPage() {
  const qc = useQueryClient();
  const ficheroRef = useRef<HTMLInputElement>(null);
  const [elegidas, setElegidas] = useState<Record<string, string>>({});

  const proponerFn = useServerFn(proponerConciliacion);
  const { data, isLoading } = useQuery({
    queryKey: ["conciliacion"],
    queryFn: () => proponerFn(),
  });

  const movimientos = data?.movimientos ?? [];
  const pendientes = data?.pendientes ?? [];
  const propuestas: Propuesta[] = data?.propuestas ?? [];

  const porMovimiento = useMemo(() => {
    const m = new Map<string, Propuesta>();
    for (const p of propuestas) m.set(p.movimiento_id, p);
    return m;
  }, [propuestas]);

  const facturaPorId = useMemo(() => new Map(pendientes.map((f: any) => [f.id, f])), [pendientes]);

  const seguras = propuestas.filter(esSegura);

  function refrescar() {
    setElegidas({});
    qc.invalidateQueries({ queryKey: ["conciliacion"] });
    qc.invalidateQueries({ queryKey: ["facturas"] });
    qc.invalidateQueries({ queryKey: ["cobros-pendientes"] });
  }

  const importarFn = useServerFn(importarExtracto);
  const importar = useMutation({
    mutationFn: (fichero: File) => {
      const fd = new FormData();
      fd.append("fichero", fichero);
      return importarFn({ data: fd });
    },
    onSuccess: (r: any) => {
      toast.success(
        `${r.nuevas} movimiento(s) nuevos` + (r.repetidas > 0 ? `, ${r.repetidas} ya estaban` : ""),
      );
      refrescar();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo leer el extracto"),
  });

  const conciliarFn = useServerFn(conciliar);
  const aplicar = useMutation({
    mutationFn: async (lista: { movimiento_id: string; factura_id: string; motivo: any }[]) => {
      // De una en una y a propósito: si una falla —porque otra pestaña acaba de
      // cobrar esa factura— las anteriores ya están hechas y se dice cuántas.
      let hechas = 0;
      for (const c of lista) {
        await conciliarFn({ data: c });
        hechas++;
      }
      return hechas;
    },
    onSuccess: (n) => {
      toast.success(`${n} factura(s) marcadas como cobradas`);
      refrescar();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "No se pudo conciliar");
      refrescar();
    },
  });

  const desconciliarFn = useServerFn(desconciliar);
  const deshacer = useMutation({
    mutationFn: (movimiento_id: string) => desconciliarFn({ data: { movimiento_id } }),
    onSuccess: () => {
      toast.success("Conciliación deshecha. La factura vuelve a pendiente de cobro.");
      refrescar();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo deshacer"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conciliación bancaria</h1>
          <p className="text-sm text-muted-foreground">
            Sube el extracto del banco y marca de una vez las facturas cobradas.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={ficheroRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) importar.mutate(f);
            }}
          />
          <Button onClick={() => ficheroRef.current?.click()} disabled={importar.isPending}>
            {importar.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            Subir extracto
          </Button>
          <Button
            variant="secondary"
            disabled={seguras.length === 0 || aplicar.isPending}
            onClick={() =>
              aplicar.mutate(
                seguras.map((p) => ({
                  movimiento_id: p.movimiento_id,
                  factura_id: p.factura_id,
                  motivo: p.motivo,
                })),
              )
            }
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Aplicar las {seguras.length} seguras
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right w-28">Importe</TableHead>
                <TableHead className="w-72">Factura</TableHead>
                <TableHead className="w-44">Por qué</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6}>Cargando…</TableCell>
                </TableRow>
              )}
              {!isLoading && movimientos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No hay ingresos sin conciliar. Sube el extracto del banco para empezar.
                  </TableCell>
                </TableRow>
              )}
              {movimientos.map((m: any) => {
                const p = porMovimiento.get(m.id);
                const elegida = elegidas[m.id] ?? p?.factura_id ?? "";
                const factura: any = elegida ? facturaPorId.get(elegida) : null;
                const segura = p ? esSegura(p) : false;

                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{fechaCorta(m.fecha)}</TableCell>
                    <TableCell className="text-sm">{m.concepto || "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {eur(Number(m.importe))}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={elegida}
                        onValueChange={(v) => setElegidas({ ...elegidas, [m.id]: v })}
                      >
                        <SelectTrigger className={segura ? "" : "border-amber-500/60"}>
                          <SelectValue placeholder="Sin casar" />
                        </SelectTrigger>
                        <SelectContent>
                          {pendientes.map((f: any) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.referencia} · {eur(Number(f.total))} ·{" "}
                              {f.cliente_nombre ?? "sin cliente"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {p ? (
                          <>
                            <Badge variant={segura ? "default" : "outline"}>
                              {ETIQUETA_MOTIVO[p.motivo] ?? p.motivo}
                            </Badge>
                            {p.candidatas > 1 && (
                              <div className="text-xs text-muted-foreground">
                                {p.candidatas} facturas encajan
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Ninguna encaja</span>
                        )}
                        {/* La diferencia se calcula contra la factura ELEGIDA, no
                            contra la propuesta: al cambiarla a mano hay que ver
                            si el importe deja de cuadrar. */}
                        {factura && Math.abs(Number(m.importe) - Number(factura.total)) > 0 && (
                          <div className="text-xs text-amber-600">
                            Difiere {eur(Number(m.importe) - Number(factura.total))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Marcar como cobrada"
                        disabled={!elegida || aplicar.isPending}
                        onClick={() =>
                          aplicar.mutate([
                            {
                              movimiento_id: m.id,
                              factura_id: elegida,
                              motivo: elegidas[m.id] ? "manual" : (p?.motivo ?? "manual"),
                            },
                          ])
                        }
                      >
                        <Check className="h-4 w-4 text-emerald-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        «Aplicar las seguras» solo toca las que no admiten duda: las que traen el número de factura
        en el concepto, o las que coinciden en cliente e importe sin que haya otra factura que
        encaje igual. Las demás se revisan una a una. Si te equivocas, el botón de deshacer devuelve
        la factura a pendiente de cobro: el documento fiscal no se toca en ningún momento.
      </p>

      <MovimientosConciliados onDeshacer={(id) => deshacer.mutate(id)} />
    </div>
  );
}

/** Lo ya casado, para poder deshacerlo. */
function MovimientosConciliados({ onDeshacer }: { onDeshacer: (id: string) => void }) {
  const listFn = useServerFn(listMovimientosBanco);
  const { data = [] } = useQuery({
    queryKey: ["banco-movimientos"],
    queryFn: () => listFn(),
  });
  const casados = (data as any[]).filter((m) => (m.conciliacion ?? []).length > 0);

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Ya conciliados ({casados.length})
      </summary>
      {casados.length === 0 ? (
        <p className="text-muted-foreground py-3">Todavía no has conciliado nada.</p>
      ) : (
        <ConciliadosTabla casados={casados} onDeshacer={onDeshacer} />
      )}
    </details>
  );
}

function ConciliadosTabla({
  casados,
  onDeshacer,
}: {
  casados: any[];
  onDeshacer: (id: string) => void;
}) {
  return (
    <Table className="mt-2">
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Fecha</TableHead>
          <TableHead>Concepto</TableHead>
          <TableHead className="text-right w-28">Importe</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {casados.map((m: any) => (
          <TableRow key={m.id}>
            <TableCell>{fechaCorta(m.fecha)}</TableCell>
            <TableCell>{m.concepto || "—"}</TableCell>
            <TableCell className="text-right">{eur(Number(m.importe))}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="icon" title="Deshacer" onClick={() => onDeshacer(m.id)}>
                <Undo2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
