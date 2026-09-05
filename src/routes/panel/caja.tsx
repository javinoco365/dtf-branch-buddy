import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { descargarCSV } from "@/lib/csv";
import { porSocio, totalesCaja } from "@/dominio/caja";
import {
  borrarMovimientoCaja,
  listarCatalogosCaja,
  listarMovimientosCaja,
  type MovimientoCaja,
} from "@/lib/caja.functions";
import { CajaFormDialog } from "@/components/CajaFormDialog";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";

export const Route = createFileRoute("/panel/caja")({
  head: () => ({ meta: [{ title: "Caja · DTF Culture" }] }),
  component: CajaPage,
});

/** El año en curso, que es el rango con el que se abre. */
function rangoDelAnio() {
  const hoy = new Date();
  return {
    desde: `${hoy.getFullYear()}-01-01`,
    hasta: `${hoy.getFullYear()}-12-31`,
  };
}

function CajaPage() {
  const inicial = rangoDelAnio();
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [filtroCategoria, setFiltroCategoria] = useState<string>("todas");
  const [filtroSocio, setFiltroSocio] = useState<string>("todos");
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<MovimientoCaja | undefined>();
  const [borrando, setBorrando] = useState<MovimientoCaja | null>(null);

  const qc = useQueryClient();
  const listar = useServerFn(listarMovimientosCaja);
  const catalogos = useServerFn(listarCatalogosCaja);
  const borrar = useServerFn(borrarMovimientoCaja);

  const claveMovimientos = ["caja", desde, hasta] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: claveMovimientos,
    queryFn: () => listar({ data: { desde, hasta } }),
  });
  const { data: cat } = useQuery({ queryKey: ["caja-catalogos"], queryFn: () => catalogos() });

  const movimientos = data?.movimientos ?? [];

  const visibles = useMemo(
    () =>
      movimientos.filter(
        (m) =>
          (filtroCategoria === "todas" || m.categoria === filtroCategoria) &&
          (filtroSocio === "todos" || m.socio_id === filtroSocio),
      ),
    [movimientos, filtroCategoria, filtroSocio],
  );

  // Los totales salen del módulo de dominio, no de una suma escrita aquí.
  const totales = useMemo(() => totalesCaja(visibles), [visibles]);
  const socios = useMemo(() => porSocio(visibles), [visibles]);

  const mutBorrar = useMutation({
    mutationFn: (id: string) => borrar({ data: { id } }),
    onSuccess: () => {
      toast.success("Apunte borrado");
      setBorrando(null);
      qc.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido borrar"),
  });

  function exportar() {
    // En el CSV el gasto sí va en negativo: quien lo abra en una hoja de
    // cálculo espera poder sumar la columna y que salga el saldo.
    descargarCSV(`caja-${desde}-a-${hasta}.csv`, [
      ["Fecha", "Categoría", "Concepto", "Cliente", "Socio", "Importe", "Observaciones"],
      ...visibles.map((m) => [
        m.fecha,
        m.categoria === "ingreso" ? "Ingreso" : "Gasto",
        m.concepto_nombre,
        m.cliente_nombre ?? "",
        m.socio_nombre ?? "",
        m.categoria === "gasto" ? -m.importe : m.importe,
        m.observaciones ?? "",
      ]),
    ]);
  }

  const sinCatalogos = cat && cat.conceptos.filter((c) => c.activo).length === 0;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
          <p className="text-sm text-muted-foreground">
            Efectivo y aportaciones de los socios. No es el extracto del banco.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportar} disabled={visibles.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Exportar
          </Button>
          <Button
            onClick={() => {
              setEditando(undefined);
              setAbierto(true);
            }}
            disabled={sinCatalogos}
          >
            <Plus className="h-4 w-4 mr-2" /> Nuevo apunte
          </Button>
        </div>
      </div>

      {sinCatalogos && (
        <Card>
          <CardContent className="p-4 text-sm">
            No hay ningún concepto activo, así que todavía no se puede apuntar nada.{" "}
            <Link to="/panel/configuracion-caja" className="underline underline-offset-2">
              Añade conceptos en Ajustes
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              className="w-40"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              className="w-40"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Categoría</Label>
            <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="ingreso">Ingresos</SelectItem>
                <SelectItem value="gasto">Gastos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Socio</Label>
            <Select value={filtroSocio} onValueChange={setFiltroSocio}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {(cat?.socios ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Resumen titulo="Ingresos" valor={eur(totales.ingresos)} tono="text-emerald-600" />
        <Resumen titulo="Gastos" valor={eur(totales.gastos)} tono="text-red-600" />
        <Resumen
          titulo="Saldo del periodo"
          valor={eur(totales.saldo)}
          tono={totales.saldo < 0 ? "text-red-600" : "text-emerald-600"}
        />
      </div>

      {socios.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Puesto por cada socio en el periodo
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {socios.map((s) => (
                <span key={s.socio}>
                  {s.socio}: <span className="font-semibold tabular-nums">{eur(s.puesto)}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    ({s.apuntes} {s.apuntes === 1 ? "apunte" : "apuntes"})
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Cliente / Socio</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="w-28">Categoría</TableHead>
                <TableHead className="w-32 text-right">Importe</TableHead>
                <TableHead>Observaciones</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Cargando…
                  </TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-red-600 py-8">
                    {(error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && visibles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Sin apuntes en este periodo.
                  </TableCell>
                </TableRow>
              )}
              {visibles.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums">{fechaCorta(m.fecha)}</TableCell>
                  <TableCell>{m.cliente_nombre ?? m.socio_nombre ?? "—"}</TableCell>
                  <TableCell>{m.concepto_nombre}</TableCell>
                  <TableCell>
                    {/*
                      Con el color de la marca, «Ingreso» se lee como un aviso.
                      El distintivo acompaña al color del importe en vez de
                      competir con él.
                    */}
                    <Badge
                      variant="outline"
                      className={
                        m.categoria === "ingreso"
                          ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
                          : "border-red-600/30 text-red-700 dark:text-red-400"
                      }
                    >
                      {m.categoria === "ingreso" ? "Ingreso" : "Gasto"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      m.categoria === "gasto" ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {m.categoria === "gasto" ? "−" : "+"}
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

      <CajaFormDialog
        open={abierto}
        onOpenChange={setAbierto}
        movimiento={editando}
        conceptos={cat?.conceptos ?? []}
        socios={cat?.socios ?? []}
        onSaved={() => {
          setAbierto(false);
          qc.invalidateQueries({ queryKey: ["caja"] });
        }}
      />

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={
          borrando
            ? `el apunte del ${fechaCorta(borrando.fecha)}: ${borrando.concepto_nombre}, ${eur(borrando.importe)}`
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
