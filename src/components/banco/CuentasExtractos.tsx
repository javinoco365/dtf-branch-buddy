import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { eur, fechaCorta } from "@/lib/format";
import { analizarExtracto, guardarCuenta, importarExtracto } from "@/lib/banco.functions";
import { useCuentasBanco } from "./useCuentasBanco";
import type { Decimal, OrdenFecha } from "@/dominio/extractos";

/**
 * Las cuentas del banco y sus extractos. Al subir un extracto se ve primero
 * lo que se ha entendido (formato detectado, movimientos, saldos y si cuadra)
 * y se elige lo que no se pudo saber; luego se importa.
 */

const ETIQUETA_ORDEN: Record<OrdenFecha, string> = {
  dma: "Día/mes/año (03/10/2026)",
  mda: "Mes/día/año (10/03/2026)",
  amd: "Año-mes-día (2026-10-03)",
};
const ETIQUETA_SEPARADOR: Record<string, string> = {
  ";": "punto y coma",
  ",": "coma",
  "\t": "tabulador",
  "|": "barra",
};

type Analisis = Awaited<ReturnType<typeof analizarExtracto>>;

export function CuentasExtractos({ alImportar }: { alImportar: () => void }) {
  const qc = useQueryClient();
  const { data } = useCuentasBanco();
  const cuentas = (data?.cuentas ?? []) as any[];
  const extractos = (data?.extractos ?? []) as any[];
  const ficheroRef = useRef<HTMLInputElement>(null);
  const [cuentaId, setCuentaId] = useState<string>("");
  const [nueva, setNueva] = useState({ banco: "", alias: "", iban: "" });
  const [revision, setRevision] = useState<{
    fichero: File;
    analisis: Analisis;
    orden_fecha?: OrdenFecha;
    decimal?: Decimal;
    saldo_inicial: string;
    saldo_final: string;
  } | null>(null);

  const guardarFn = useServerFn(guardarCuenta);
  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({ data: { banco: nueva.banco, alias: nueva.alias, iban: nueva.iban || null } }),
    onSuccess: (r: any) => {
      toast.success("Cuenta añadida");
      setNueva({ banco: "", alias: "", iban: "" });
      setCuentaId(r.id);
      qc.invalidateQueries({ queryKey: ["banco-cuentas"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo guardar la cuenta"),
  });

  const formulario = (
    f: File,
    extra: {
      orden_fecha?: OrdenFecha;
      decimal?: Decimal;
      saldo_inicial?: string;
      saldo_final?: string;
    },
  ) => {
    const fd = new FormData();
    fd.append("fichero", f);
    fd.append("cuenta_id", cuentaId);
    fd.append(
      "opciones",
      JSON.stringify({ orden_fecha: extra.orden_fecha, decimal: extra.decimal }),
    );
    if (extra.saldo_inicial) fd.append("saldo_inicial", extra.saldo_inicial);
    if (extra.saldo_final) fd.append("saldo_final", extra.saldo_final);
    return fd;
  };

  const analizarFn = useServerFn(analizarExtracto);
  const analizar = useMutation({
    mutationFn: (v: {
      fichero: File;
      orden_fecha?: OrdenFecha;
      decimal?: Decimal;
      saldo_inicial?: string;
      saldo_final?: string;
    }) => analizarFn({ data: formulario(v.fichero, v) }),
    onSuccess: (analisis, v) =>
      setRevision({
        fichero: v.fichero,
        analisis,
        orden_fecha: v.orden_fecha,
        decimal: v.decimal,
        saldo_inicial: v.saldo_inicial ?? "",
        saldo_final: v.saldo_final ?? "",
      }),
    onError: (e: any) => toast.error(e?.message ?? "No se pudo leer el extracto"),
  });

  const importarFn = useServerFn(importarExtracto);
  const importar = useMutation({
    mutationFn: () => {
      if (!revision) throw new Error("Nada que importar");
      return importarFn({ data: formulario(revision.fichero, revision) });
    },
    onSuccess: (r: any) => {
      toast.success(
        `${r.nuevas} movimiento(s) nuevos` + (r.repetidas > 0 ? `, ${r.repetidas} ya estaban` : ""),
      );
      setRevision(null);
      qc.invalidateQueries({ queryKey: ["banco-cuentas"] });
      alImportar();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo importar"),
  });

  // Elegir una opción o escribir un saldo vuelve a leer el fichero con ella.
  const reanalizar = (cambio: Partial<NonNullable<typeof revision>>) => {
    if (!revision) return;
    const r = { ...revision, ...cambio };
    analizar.mutate({
      fichero: r.fichero,
      orden_fecha: r.orden_fecha,
      decimal: r.decimal,
      saldo_inicial: r.saldo_inicial,
      saldo_final: r.saldo_final,
    });
  };

  const nombreCuenta = (id: string) => {
    const c = cuentas.find((x) => x.id === id);
    return c ? `${c.alias} · ${c.banco}` : "—";
  };
  const a = revision?.analisis;
  const pendientes = a?.formato.ambiguo ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cuentas y extractos</CardTitle>
          <p className="text-xs text-muted-foreground">
            Elige la cuenta y sube su extracto (Excel, CSV o Norma 43). Antes de importar verás qué
            se ha entendido y si cuadra.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Cuenta</Label>
              <Select value={cuentaId} onValueChange={setCuentaId}>
                <SelectTrigger className="w-72 max-md:w-full">
                  <SelectValue
                    placeholder={cuentas.length ? "Elige la cuenta" : "Añade una cuenta"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {cuentas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.alias} · {c.banco}
                      {c.iban ? ` · …${String(c.iban).slice(-4)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              ref={ficheroRef}
              type="file"
              accept=".xlsx,.csv,.txt,.n43,.q43,.aeb"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) analizar.mutate({ fichero: f });
              }}
            />
            <Button
              onClick={() => ficheroRef.current?.click()}
              disabled={!cuentaId || analizar.isPending}
            >
              {analizar.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4 mr-2" />
              )}
              Subir extracto
            </Button>
          </div>

          <form
            className="flex flex-wrap items-end gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              guardar.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">Banco</Label>
              <Input
                required
                value={nueva.banco}
                placeholder="Ej. BBVA"
                onChange={(e) => setNueva({ ...nueva, banco: e.target.value })}
                className="w-36"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Alias</Label>
              <Input
                required
                value={nueva.alias}
                placeholder="Ej. Principal"
                onChange={(e) => setNueva({ ...nueva, alias: e.target.value })}
                className="w-36"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">IBAN</Label>
              <Input
                value={nueva.iban}
                placeholder="ES00 0000 0000 0000 0000 0000"
                onChange={(e) => setNueva({ ...nueva, iban: e.target.value })}
                className="w-72 max-md:w-full"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={guardar.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Añadir cuenta
            </Button>
          </form>

          {extractos.length > 0 && (
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Extracto</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead className="text-right">Movimientos</TableHead>
                  <TableHead className="text-right">Saldo inicial</TableHead>
                  <TableHead className="text-right">Saldo final</TableHead>
                  <TableHead>¿Cuadra?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extractos.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="font-medium break-all">{x.fichero}</TableCell>
                    <TableCell>{nombreCuenta(x.cuenta_id)}</TableCell>
                    <TableCell>
                      {x.desde ? `${fechaCorta(x.desde)} – ${fechaCorta(x.hasta)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {x.movimientos}
                      {x.nuevos < x.movimientos && (
                        <span className="block text-xs text-muted-foreground">
                          {x.nuevos} nuevos
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {x.saldo_inicial === null ? "—" : eur(Number(x.saldo_inicial))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {x.saldo_final === null ? "—" : eur(Number(x.saldo_final))}
                    </TableCell>
                    <TableCell>
                      {x.cuadra ? (
                        <Badge variant="secondary">Cuadra</Badge>
                      ) : (
                        <Badge variant="destructive">
                          {x.saldo_inicial === null || x.saldo_final === null
                            ? "Sin saldos"
                            : "No cuadra"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!revision} onOpenChange={(o) => !o && setRevision(null)}>
        {revision && a && (
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Antes de importar: {revision.fichero.name}</DialogTitle>
              <DialogDescription>
                En {nombreCuenta(cuentaId)}. Esto es lo que se ha entendido del fichero.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Formato: </span>
                {a.formato.tipo === "norma43"
                  ? "Norma 43"
                  : a.formato.tipo === "excel"
                    ? "Excel"
                    : "CSV"}
              </p>
              {a.formato.codificacion && (
                <p>
                  <span className="text-muted-foreground">Codificación: </span>
                  {a.formato.codificacion}
                </p>
              )}
              {a.formato.separador && (
                <p>
                  <span className="text-muted-foreground">Separador: </span>
                  {ETIQUETA_SEPARADOR[a.formato.separador] ?? a.formato.separador}
                </p>
              )}
              {a.formato.orden_fecha && !pendientes.includes("orden_fecha") && (
                <p>
                  <span className="text-muted-foreground">Fechas: </span>
                  {ETIQUETA_ORDEN[a.formato.orden_fecha]}
                </p>
              )}
              {a.formato.decimal &&
                !pendientes.includes("decimal") &&
                a.formato.tipo !== "norma43" && (
                  <p>
                    <span className="text-muted-foreground">Decimal: </span>
                    {a.formato.decimal === "," ? "coma (1.234,56)" : "punto (1,234.56)"}
                  </p>
                )}
              <p>
                <span className="text-muted-foreground">Movimientos: </span>
                {a.movimientos}
                {a.desde && ` · del ${fechaCorta(a.desde)} al ${fechaCorta(a.hasta!)}`}
              </p>
            </div>

            {pendientes.length > 0 && (
              <Card className="border-amber-500/50">
                <CardContent className="space-y-3 py-4 text-sm">
                  <p className="flex gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    Mirando el fichero no se puede saber esto. Elígelo:
                  </p>
                  {pendientes.includes("orden_fecha") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Orden de las fechas</Label>
                      <Select onValueChange={(v) => reanalizar({ orden_fecha: v as OrdenFecha })}>
                        <SelectTrigger className="w-72 max-md:w-full">
                          <SelectValue placeholder="Elige el orden" />
                        </SelectTrigger>
                        <SelectContent>
                          {(["dma", "mda"] as const).map((o) => (
                            <SelectItem key={o} value={o}>
                              {ETIQUETA_ORDEN[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {pendientes.includes("decimal") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Separador decimal</Label>
                      <Select onValueChange={(v) => reanalizar({ decimal: v as Decimal })}>
                        <SelectTrigger className="w-72 max-md:w-full">
                          <SelectValue placeholder="Elige el decimal" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value=",">Coma (1.234,56)</SelectItem>
                          <SelectItem value=".">Punto (1,234.56)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.muestra.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell>{fechaCorta(m.fecha)}</TableCell>
                    <TableCell className="break-all">{m.concepto || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(m.importe)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.saldo === null ? "—" : eur(m.saldo)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {a.movimientos > a.muestra.length && (
              <p className="text-xs text-muted-foreground">
                Y {a.movimientos - a.muestra.length} más.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Saldo inicial</Label>
                {a.saldos_del_fichero ? (
                  <p className="tabular-nums">{eur(Number(a.saldo_inicial))}</p>
                ) : (
                  <Input
                    inputMode="decimal"
                    placeholder="El del extracto"
                    value={revision.saldo_inicial}
                    onChange={(e) => setRevision({ ...revision, saldo_inicial: e.target.value })}
                    onBlur={() => reanalizar({})}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Saldo final</Label>
                {a.saldos_del_fichero ? (
                  <p className="tabular-nums">{eur(Number(a.saldo_final))}</p>
                ) : (
                  <Input
                    inputMode="decimal"
                    placeholder="El del extracto"
                    value={revision.saldo_final}
                    onChange={(e) => setRevision({ ...revision, saldo_final: e.target.value })}
                    onBlur={() => reanalizar({})}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Movimientos suman</Label>
                <p className="tabular-nums">{eur(a.suma)}</p>
              </div>
            </div>
            <p className="flex items-center gap-2 text-sm">
              {a.cuadra ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-status-completado" />
                  Cuadra: saldo inicial + movimientos = saldo final.
                </>
              ) : a.diferencia === null ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Sin saldos no se puede comprobar si cuadra. Escríbelos si los tienes.
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  No cuadra: faltan {eur(a.diferencia)}. ¿Falta algún movimiento en el fichero?
                </>
              )}
            </p>
            {a.avisos.map((av, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                {av}
              </p>
            ))}

            <DialogFooter>
              <Button
                onClick={() => importar.mutate()}
                disabled={pendientes.length > 0 || importar.isPending || analizar.isPending}
              >
                {importar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Importar {a.movimientos} movimiento(s)
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
