import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { eur, fechaCorta, numero } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { porSocioInversion, totalesInversion } from "@/dominio/inversion";
import {
  borrarInversion,
  listarInversion,
  type MovimientoInversion,
} from "@/lib/inversion.functions";
import { listarCatalogosCaja } from "@/lib/caja.functions";
import { InversionFormDialog } from "@/components/InversionFormDialog";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";

export const Route = createFileRoute("/panel/inversion")({
  head: () => ({ meta: [{ title: "Inversión · DTF Culture" }] }),
  component: InversionPage,
});

function InversionPage() {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<MovimientoInversion | undefined>();
  const [borrando, setBorrando] = useState<MovimientoInversion | null>(null);

  const qc = useQueryClient();
  const listar = useServerFn(listarInversion);
  const catalogos = useServerFn(listarCatalogosCaja);
  const borrar = useServerFn(borrarInversion);

  const { data, isLoading, error } = useQuery({
    queryKey: ["inversion"],
    queryFn: () => listar(),
  });
  const { data: cat } = useQuery({ queryKey: ["caja-catalogos"], queryFn: () => catalogos() });

  const movimientos = data?.movimientos ?? [];
  const totales = useMemo(() => totalesInversion(movimientos), [movimientos]);
  const socios = useMemo(() => porSocioInversion(movimientos), [movimientos]);

  const mutBorrar = useMutation({
    mutationFn: (id: string) => borrar({ data: { id } }),
    onSuccess: () => {
      toast.success("Apunte borrado");
      setBorrando(null);
      qc.invalidateQueries({ queryKey: ["inversion"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido borrar"),
  });

  function exportar() {
    descargarCSV("inversion.csv", [
      ["Fecha", "Socio", "Tipo", "Importe", "Observaciones"],
      ...movimientos.map((m) => [
        m.fecha,
        m.socio_nombre,
        m.tipo === "aportacion" ? "Aportación" : "Retirada",
        m.tipo === "retirada" ? -m.importe : m.importe,
        m.observaciones ?? "",
      ]),
    ]);
  }

  const sinSocios = cat && cat.socios.filter((s) => s.activo).length === 0;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inversión</h1>
          <p className="text-sm text-muted-foreground">
            Lo que ha puesto cada socio y lo que ha recuperado. Desde el principio, sin filtro de
            fechas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportar} disabled={movimientos.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Exportar
          </Button>
          <Button
            onClick={() => {
              setEditando(undefined);
              setAbierto(true);
            }}
            disabled={sinSocios}
          >
            <Plus className="h-4 w-4 mr-2" /> Nuevo apunte
          </Button>
        </div>
      </div>

      {sinSocios && (
        <Card>
          <CardContent className="p-4 text-sm">
            No hay ningún socio activo.{" "}
            <Link to="/panel/configuracion-caja" className="underline underline-offset-2">
              Añade socios en Ajustes
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Resumen titulo="Aportado" valor={eur(totales.aportado)} tono="text-status-completado" />
        <Resumen titulo="Recuperado" valor={eur(totales.recuperado)} tono="text-status-pendiente" />
        <Resumen
          titulo="Sigue dentro"
          valor={eur(totales.pendiente)}
          tono={totales.pendiente < 0 ? "text-status-cancelado" : "text-foreground"}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead className="text-right">Aportado</TableHead>
                <TableHead className="text-right">Recuperado</TableHead>
                <TableHead className="text-right">Sigue dentro</TableHead>
                <TableHead className="text-right w-24">% del capital</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {socios.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Todavía no hay ninguna inversión anotada.
                  </TableCell>
                </TableRow>
              )}
              {socios.map((s) => (
                <TableRow key={s.socio}>
                  <TableCell className="font-medium">{s.socio}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(s.aportado)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {s.recuperado > 0 ? eur(s.recuperado) : "—"}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${
                      s.pendiente < 0 ? "text-status-cancelado" : ""
                    }`}
                  >
                    {eur(s.pendiente)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {numero(s.porcentaje, 1)} %
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Socio</TableHead>
                <TableHead className="w-32">Tipo</TableHead>
                <TableHead className="w-32 text-right">Importe</TableHead>
                <TableHead>Observaciones</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Cargando…
                  </TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-destructive py-8">
                    {(error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && movimientos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Sin apuntes.
                  </TableCell>
                </TableRow>
              )}
              {movimientos.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums">{fechaCorta(m.fecha)}</TableCell>
                  <TableCell>{m.socio_nombre}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        m.tipo === "aportacion"
                          ? "border-status-completado/40 text-status-completado"
                          : "border-status-pendiente/40 text-status-pendiente"
                      }
                    >
                      {m.tipo === "aportacion" ? "Aportación" : "Retirada"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      m.tipo === "retirada" ? "text-status-pendiente" : "text-status-completado"
                    }`}
                  >
                    {m.tipo === "retirada" ? "−" : "+"}
                    {eur(m.importe)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {m.observaciones ?? ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditando(m);
                        setAbierto(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setBorrando(m)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Esto no es la caja. Un gasto que paga un socio de su bolsillo se anota en{" "}
        <Link to="/panel/caja" className="underline underline-offset-2">
          Caja
        </Link>
        , y ahí ya cuenta como dinero puesto por él. Anotarlo además aquí lo contaría dos veces.
      </p>

      <InversionFormDialog
        open={abierto}
        onOpenChange={setAbierto}
        movimiento={editando}
        socios={cat?.socios ?? []}
        onSaved={() => {
          setAbierto(false);
          qc.invalidateQueries({ queryKey: ["inversion"] });
        }}
      />

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={
          borrando
            ? `el apunte del ${fechaCorta(borrando.fecha)}: ${borrando.socio_nombre}, ${eur(borrando.importe)}`
            : "el apunte"
        }
        consecuencias={["Queda registrado en la auditoría quién lo ha borrado y qué decía"]}
        onConfirmar={() => borrando && mutBorrar.mutate(borrando.id)}
        cargando={mutBorrar.isPending}
      />
    </div>
  );
}

function Resumen({ titulo, valor, tono }: { titulo: string; valor: string; tono: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{titulo}</p>
        <p className={`text-2xl font-bold tabular-nums ${tono}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}
