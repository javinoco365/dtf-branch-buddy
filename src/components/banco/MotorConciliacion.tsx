import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Undo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { eur, fechaCorta, numeroJusto } from "@/lib/format";
import {
  aplicarPlan,
  confirmarEnlace,
  deshacerEnlace,
  desmarcarTraspaso,
  enlazarManual,
  verEnlaces,
  verTraspasos,
  type Cuantos,
  type DocumentoConciliable,
  type EnlaceGuardado,
  type Recortado,
} from "@/lib/conciliacion.functions";
import {
  DIAS_ANTES,
  DIAS_DESPUES,
  ETIQUETA_MOTIVO,
  sugerencias,
  type Enlace,
  type Movimiento,
  type Plan,
} from "@/dominio/motor-conciliacion";
import { tramoDePagina } from "@/dominio/paginacion";
import { totalesConSigno } from "@/dominio/sumatorios";
import { totalesEnlaces } from "@/dominio/sumatorios-banco";
import { useCuentasBanco } from "./useCuentasBanco";

export type DatosConciliacion = {
  /** Los movimientos sin conciliar (ni traspaso) de la ventana. */
  movimientos: Movimiento[];
  /** Los documentos por conciliar de la ventana: los que el motor puede proponer. */
  documentos: DocumentoConciliable[];
  plan: Plan;
  /** Si quedaron pendientes fuera de lo que se mira. */
  recortado?: Recortado;
  /** Cuántos de cada cosa se miran como mucho. */
  limite?: number;
  /** Cuántos hay en las pestañas del historial. */
  cuantos?: Cuantos;
  /**
   * La migración que falta para mirar solo lo pendiente. Sin ella, la ventana
   * se lee de las tablas como antes: lo más reciente, pendiente o no.
   */
  falta?: string;
};

const claveDoc = (d: { tipo: string; id: string }) => `${d.tipo}:${d.id}`;

/** La clave de las páginas del historial: se refrescan juntas tras cada cambio. */
const CLAVE_HISTORIAL = "conciliacion-historial";

/**
 * Conciliación con el motor. Verde: importe, fecha y contraparte, sin duda de
 * qué va con qué. Ámbar: casa el importe y la fecha, o varias cantidades
 * suman; se guarda como «revisar» y no cambia nada hasta que se confirma.
 */
export function MotorConciliacion({
  datos,
  alCambiar,
}: {
  datos: DatosConciliacion;
  alCambiar: () => void;
}) {
  const qc = useQueryClient();
  const { data: banco } = useCuentasBanco();
  const [sugerir, setSugerir] = useState<Movimiento | null>(null);

  const alias = useMemo(
    () =>
      new Map<string, string>(
        (banco?.cuentas ?? []).map((c: any) => [String(c.id), String(c.alias)]),
      ),
    [banco],
  );
  const docs = useMemo(() => new Map(datos.documentos.map((d) => [claveDoc(d), d])), [datos]);
  const movs = useMemo(() => new Map(datos.movimientos.map((m) => [m.id, m])), [datos]);

  // La propuesta de cada movimiento libre, para pintarla en su fila.
  const propuestaDe = useMemo(() => {
    const m = new Map<string, Enlace>();
    for (const e of [...datos.plan.verdes, ...datos.plan.ambares])
      for (const id of e.movimientos) m.set(id, e);
    return m;
  }, [datos]);
  const traspasoPropuesto = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of datos.plan.traspasos) {
      m.set(t.a, t.b);
      m.set(t.b, t.a);
    }
    return m;
  }, [datos]);

  // Solo llega lo que está por conciliar: los movimientos son todos «sin
  // conciliar» y los documentos, todos libres.
  const sinConciliar = datos.movimientos;
  const libres = datos.documentos;
  const cuantos = datos.cuantos ?? { revisar: 0, conciliados: 0, traspasos: 0 };
  // Abonos y cargos por separado: un neto solo esconde cuánto entra y cuánto sale.
  const totalSinConciliar = totalesConSigno(sinConciliar, (m) => m.importe);
  const { verdes, ambares, traspasos: tp } = datos.plan;
  const hayPlan = verdes.length + ambares.length + tp.length > 0;
  const recorte = avisoRecorte(datos.recortado, datos.limite, !datos.falta);

  const refrescar = () => {
    alCambiar();
    qc.invalidateQueries({ queryKey: [CLAVE_HISTORIAL] });
    qc.invalidateQueries({ queryKey: ["compras"] });
    qc.invalidateQueries({ queryKey: ["facturas"] });
  };
  const aviso = (e: any, porDefecto: string) => toast.error(e?.message ?? porDefecto);

  const aplicarFn = useServerFn(aplicarPlan);
  const aplicar = useMutation({
    mutationFn: () => aplicarFn(),
    onSuccess: (r) => {
      toast.success(
        `${r.verdes} conciliados, ${r.ambares} a revisar, ${r.traspasos} traspasos` +
          (r.errores.length ? `. ${r.errores.length} no se pudieron: ${r.errores[0]}` : ""),
      );
      refrescar();
    },
    onError: (e) => aviso(e, "No se pudo aplicar la propuesta"),
  });
  const confirmarFn = useServerFn(confirmarEnlace);
  const confirmar = useMutation({
    mutationFn: (grupo: string) => confirmarFn({ data: { grupo } }),
    onSuccess: () => {
      toast.success("Confirmado: queda conciliado");
      refrescar();
    },
    onError: (e) => aviso(e, "No se pudo confirmar"),
  });
  const deshacerFn = useServerFn(deshacerEnlace);
  const deshacer = useMutation({
    mutationFn: (grupo: string) => deshacerFn({ data: { grupo } }),
    onSuccess: () => {
      toast.success("Deshecho. Lo que se marcó como pagado vuelve a pendiente.");
      refrescar();
    },
    onError: (e) => aviso(e, "No se pudo deshacer"),
  });
  const desmarcarFn = useServerFn(desmarcarTraspaso);
  const desmarcar = useMutation({
    mutationFn: (movimiento_id: string) => desmarcarFn({ data: { movimiento_id } }),
    onSuccess: () => {
      toast.success("Ya no es un traspaso");
      refrescar();
    },
    onError: (e) => aviso(e, "No se pudo desmarcar"),
  });
  const enlazarFn = useServerFn(enlazarManual);
  const enlazar = useMutation({
    mutationFn: (v: { movimiento: string; documento: DocumentoConciliable }) =>
      enlazarFn({
        data: {
          movimientos: [v.movimiento],
          documentos: [{ tipo: v.documento.tipo, id: v.documento.id }],
        },
      }),
    onSuccess: () => {
      toast.success("Enlazado y conciliado");
      setSugerir(null);
      refrescar();
    },
    onError: (e) => aviso(e, "No se pudo enlazar"),
  });

  const cuentaDe = (m: Movimiento) =>
    m.cuenta_id ? (alias.get(m.cuenta_id) ?? "—") : "Sin cuenta";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge className="bg-emerald-600 hover:bg-emerald-600">{verdes.length} verdes</Badge>
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              {ambares.length} a revisar
            </Badge>
            <Badge variant="secondary">{tp.length} traspasos</Badge>
            <span className="text-muted-foreground">
              propuestos de {sinConciliar.length} movimientos sin conciliar
            </span>
          </div>
          <Button disabled={!hayPlan || aplicar.isPending} onClick={() => aplicar.mutate()}>
            <Wand2 className="h-4 w-4 mr-2" />
            Aplicar la propuesta
          </Button>
        </CardContent>
      </Card>

      {datos.falta && (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Falta aplicar la migración <code>{datos.falta}</code>. Mientras, la conciliación mira lo
            más reciente de cada cosa, cobrado o no, como antes: con muchos tickets, una factura
            pendiente más antigua puede quedarse fuera. Con ella, mira solo lo pendiente.
          </span>
        </p>
      )}

      {recorte && (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          {recorte}
        </p>
      )}

      <Tabs defaultValue="pendientes">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="pendientes">Sin conciliar ({sinConciliar.length})</TabsTrigger>
          <TabsTrigger value="revisar">Por revisar ({cuantos.revisar})</TabsTrigger>
          <TabsTrigger value="conciliados">Conciliados ({cuantos.conciliados})</TabsTrigger>
          <TabsTrigger value="traspasos">Traspasos ({cuantos.traspasos})</TabsTrigger>
        </TabsList>

        <TabsContent value="pendientes">
          <Card>
            <CardContent className="p-0">
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Fecha</TableHead>
                    <TableHead className="w-32">Cuenta</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right w-28">Importe</TableHead>
                    <TableHead className="w-72">Propuesta</TableHead>
                    <TableHead aria-label="Acciones" className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sinConciliar.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No hay movimientos sin conciliar.
                      </TableCell>
                    </TableRow>
                  )}
                  {sinConciliar.map((m) => {
                    const p = propuestaDe.get(m.id);
                    const espejo = traspasoPropuesto.get(m.id);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap">{fechaCorta(m.fecha)}</TableCell>
                        <TableCell className="text-sm">{cuentaDe(m)}</TableCell>
                        <TableCell className="text-sm">{m.concepto || "—"}</TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${m.importe < 0 ? "text-destructive" : ""}`}
                        >
                          {eur(m.importe)}
                        </TableCell>
                        <TableCell>
                          {p ? (
                            <Propuesta enlace={p} docs={docs} />
                          ) : espejo ? (
                            <Badge variant="secondary">
                              Traspaso con {cuentaDe(movs.get(espejo)!)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Ninguna factura encaja
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setSugerir(m)}>
                            <Lightbulb className="h-4 w-4 mr-1" />
                            Sugerencias
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {sinConciliar.length > 0 && (
                  <TableFooter>
                    {totalSinConciliar.entradas > 0 && totalSinConciliar.salidas > 0 && (
                      <>
                        <TableRow>
                          <TableCell colSpan={3}>Abonos</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            {eur(totalSinConciliar.entradas)}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={3}>Cargos</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-destructive">
                            {eur(-totalSinConciliar.salidas)}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      </>
                    )}
                    <TableRow>
                      <TableCell colSpan={3} className="font-semibold">
                        Total · {totalSinConciliar.n}{" "}
                        {totalSinConciliar.n === 1 ? "movimiento" : "movimientos"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${totalSinConciliar.neto < 0 ? "text-destructive" : ""}`}
                      >
                        {eur(totalSinConciliar.neto)}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revisar">
          <HistorialEnlaces
            estado="revisar"
            cuentaDe={cuentaDe}
            vacio="No hay nada por revisar."
            acciones={(e) => (
              <>
                <Button
                  size="sm"
                  disabled={confirmar.isPending}
                  onClick={() => confirmar.mutate(e.grupo)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Confirmar
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="No es esto: deshacer"
                  disabled={deshacer.isPending}
                  onClick={() => deshacer.mutate(e.grupo)}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </>
            )}
          />
        </TabsContent>

        <TabsContent value="conciliados">
          <HistorialEnlaces
            estado="conciliada"
            cuentaDe={cuentaDe}
            vacio="Todavía no has conciliado nada."
            acciones={(e) => (
              <Button
                variant="ghost"
                size="icon"
                title="Deshacer"
                disabled={deshacer.isPending}
                onClick={() => deshacer.mutate(e.grupo)}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            )}
          />
        </TabsContent>

        <TabsContent value="traspasos">
          <HistorialTraspasos
            cuentaDe={cuentaDe}
            ocupado={desmarcar.isPending}
            alDesmarcar={(id) => desmarcar.mutate(id)}
          />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Verde: casan el importe (contra el líquido, ±1 céntimo), la fecha (de {DIAS_ANTES} días
        antes a {DIAS_DESPUES} después) y el banco nombra al proveedor o cliente, su NIF o el número
        de factura, sin que otra factura encaje igual. Ámbar: casan el importe y la fecha, o varias
        cantidades suman; quedan «por revisar» y no marcan nada como pagado hasta que las confirmas.
        Las facturas emitidas no se modifican: solo se enlazan.
      </p>

      <Dialog open={!!sugerir} onOpenChange={(o) => !o && setSugerir(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Facturas con el mismo importe</DialogTitle>
            <DialogDescription>
              {sugerir &&
                `${fechaCorta(sugerir.fecha)} · ${sugerir.concepto || "sin concepto"} · ${eur(sugerir.importe)}. `}
              Las más probables primero. No se guarda nada hasta que enlazas una.
            </DialogDescription>
          </DialogHeader>
          {sugerir && (
            <ListaSugerencias
              movimiento={sugerir}
              libres={libres}
              ocupado={enlazar.isPending}
              alEnlazar={(documento) => enlazar.mutate({ movimiento: sugerir.id, documento })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * El aviso cuando la conciliación no mira todo lo pendiente: el servidor lee
 * como mucho `limite` movimientos sin conciliar y `limite` documentos por
 * conciliar de cada clase, los más recientes. Solo sale si queda algo
 * pendiente fuera. Sin la migración que lee solo lo pendiente
 * (`soloPendiente` falso), la ventana cuenta también lo ya conciliado o
 * cobrado, y el aviso lo dice así.
 */
function avisoRecorte(
  r: Recortado | undefined,
  limite: number | undefined,
  soloPendiente: boolean,
): string | null {
  if (!r || !limite || (!r.movimientos && !r.documentos)) return null;
  const n = numeroJusto(limite, 0);
  const que = [
    r.movimientos &&
      (soloPendiente
        ? `los ${n} movimientos sin conciliar más recientes`
        : `los ${n} movimientos más recientes`),
    r.documentos &&
      (soloPendiente
        ? `las ${n} facturas por conciliar más recientes de cada clase (recibidas, de tienda y textil)`
        : `las ${n} facturas más recientes de cada clase (recibidas, de tienda y textil)`),
  ]
    .filter(Boolean)
    .join(" y ");
  return `Solo se miran ${que}. Lo anterior no sale como pendiente ni entra en la propuesta.`;
}

function etiquetaDoc(d: DocumentoConciliable | undefined): string {
  if (!d) return "Documento";
  return [d.clase, d.contraparte, d.referencia].filter(Boolean).join(" · ");
}

function Propuesta({ enlace, docs }: { enlace: Enlace; docs: Map<string, DocumentoConciliable> }) {
  const verde = enlace.estado === "conciliada";
  return (
    <div className="space-y-1">
      <Badge
        variant={verde ? "default" : "outline"}
        className={
          verde ? "bg-emerald-600 hover:bg-emerald-600" : "border-amber-500 text-amber-700"
        }
      >
        {ETIQUETA_MOTIVO[enlace.motivo]}
      </Badge>
      {enlace.documentos.map((d) => (
        <div key={claveDoc(d)} className="text-xs">
          {etiquetaDoc(docs.get(claveDoc(d)))}
        </div>
      ))}
      {enlace.movimientos.length > 1 && (
        <div className="text-xs text-muted-foreground">
          Junto con otros {enlace.movimientos.length - 1} movimiento(s)
        </div>
      )}
    </div>
  );
}

/**
 * Una página de una pestaña del historial: la pedida y, si el servidor dice
 * que ya no existe (se deshizo lo último de la última), la que manda.
 */
function usePaginaHistorial<T extends { pagina: number }>(
  pestana: string,
  leer: (pagina: number) => Promise<T>,
) {
  const qc = useQueryClient();
  const [pedida, setPedida] = useState(0);
  const consulta = useQuery({
    queryKey: [CLAVE_HISTORIAL, pestana, pedida],
    queryFn: () => leer(pedida),
    placeholderData: keepPreviousData,
  });
  const { data, isPlaceholderData } = consulta;
  useEffect(() => {
    if (data && !isPlaceholderData && data.pagina !== pedida) {
      qc.setQueryData([CLAVE_HISTORIAL, pestana, data.pagina], data);
      setPedida(data.pagina);
    }
  }, [data, isPlaceholderData, pedida, qc, pestana]);
  return { ...consulta, setPedida };
}

function HistorialEnlaces({
  estado,
  cuentaDe,
  vacio,
  acciones,
}: {
  estado: EnlaceGuardado["estado"];
  cuentaDe: (m: Movimiento) => string;
  vacio: string;
  acciones: (e: EnlaceGuardado) => React.ReactNode;
}) {
  const verFn = useServerFn(verEnlaces);
  const { data, error, isPending, isFetching, setPedida } = usePaginaHistorial(estado, (pagina) =>
    verFn({ data: { estado, pagina } }),
  );
  return (
    <TablaEnlaces
      enlaces={data?.enlaces ?? []}
      cuentaDe={cuentaDe}
      vacio={error ? `No se pudo leer: ${error.message}` : isPending ? "Cargando…" : vacio}
      acciones={acciones}
      parcial={!!data && data.total > data.porPagina}
      paginas={
        data && (
          <Paginas
            pagina={data.pagina}
            porPagina={data.porPagina}
            total={data.total}
            ocupado={isFetching}
            alCambiar={setPedida}
          />
        )
      }
    />
  );
}

function TablaEnlaces({
  enlaces,
  cuentaDe,
  vacio,
  acciones,
  parcial,
  paginas,
}: {
  enlaces: EnlaceGuardado[];
  cuentaDe: (m: Movimiento) => string;
  vacio: string;
  acciones: (e: EnlaceGuardado) => React.ReactNode;
  /** Si hay más páginas: el pie suma solo esta. */
  parcial: boolean;
  paginas: React.ReactNode;
}) {
  // Se suma el lado banco, sin repetir movimientos. La columna de facturas no
  // se suma: va en valor absoluto y mezcla cobros con pagos.
  const total = useMemo(
    () =>
      totalesEnlaces(
        enlaces.map((e) => ({
          movimientos: e.movimientos.map((m) => m.id),
          diferencia: e.diferencia,
        })),
        new Map(enlaces.flatMap((e) => e.movimientos.map((m) => [m.id, m] as const))),
      ),
    [enlaces],
  );
  return (
    <Card>
      <CardContent className="p-0">
        <Table movil="tarjetas">
          <TableHeader>
            <TableRow>
              <TableHead>Banco</TableHead>
              <TableHead>Factura(s)</TableHead>
              <TableHead className="w-48">Por qué</TableHead>
              <TableHead aria-label="Acciones" className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {enlaces.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {vacio}
                </TableCell>
              </TableRow>
            )}
            {enlaces.map((e) => (
              <TableRow key={e.grupo}>
                <TableCell className="text-sm">
                  {e.movimientos.map((m) => (
                    <div key={m.id}>
                      {`${fechaCorta(m.fecha)} · ${cuentaDe(m)} · ${m.concepto || "—"} · ${eur(m.importe)}`}
                    </div>
                  ))}
                </TableCell>
                <TableCell className="text-sm">
                  {e.documentos.map((d) => (
                    <div key={claveDoc(d)}>
                      {etiquetaDoc(d)} · {eur(Math.abs(d.esperado))}
                    </div>
                  ))}
                </TableCell>
                <TableCell>
                  <div className="text-xs">
                    {ETIQUETA_MOTIVO[e.motivo as keyof typeof ETIQUETA_MOTIVO] ?? e.motivo}
                  </div>
                  {e.diferencia !== 0 && (
                    <div className="text-xs text-amber-600">Difiere {eur(e.diferencia)}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1">{acciones(e)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {enlaces.length > 0 && (
            <TableFooter>
              {/*
                La columna Banco es texto y el importe va al final de cada línea:
                el pie sigue la misma forma, «etiqueta · importe».
              */}
              {total.entradas > 0 && total.salidas > 0 && (
                <>
                  <TableRow>
                    <TableCell className="text-sm">
                      Abonos · <span className="font-bold tabular-nums">{eur(total.entradas)}</span>
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">
                      Cargos ·{" "}
                      <span className="font-bold tabular-nums text-destructive">
                        {eur(-total.salidas)}
                      </span>
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </>
              )}
              <TableRow>
                <TableCell className="text-sm">
                  <span className="font-semibold">
                    {parcial ? "Total de la página" : "Total"} · {total.enlaces}{" "}
                    {total.enlaces === 1 ? "enlace" : "enlaces"} · {total.movimientos}{" "}
                    {total.movimientos === 1 ? "movimiento" : "movimientos"}
                  </span>{" "}
                  ·{" "}
                  <span
                    className={`font-bold tabular-nums ${total.neto < 0 ? "text-destructive" : ""}`}
                  >
                    {eur(total.neto)}
                  </span>
                </TableCell>
                <TableCell />
                <TableCell>
                  {total.diferencia !== 0 && (
                    <div className="text-xs text-amber-600">Difiere {eur(total.diferencia)}</div>
                  )}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
        {paginas}
      </CardContent>
    </Card>
  );
}

function HistorialTraspasos({
  cuentaDe,
  ocupado,
  alDesmarcar,
}: {
  cuentaDe: (m: Movimiento) => string;
  ocupado: boolean;
  alDesmarcar: (movimientoId: string) => void;
}) {
  const verFn = useServerFn(verTraspasos);
  const { data, error, isPending, isFetching, setPedida } = usePaginaHistorial(
    "traspasos",
    (pagina) => verFn({ data: { pagina } }),
  );
  const traspasos = data?.traspasos ?? [];
  const parcial = !!data && data.total > data.porPagina;
  // Cada traspaso se lista desde el lado que sale, así que cada pareja cuenta
  // una vez: lo movido entre cuentas propias son las salidas.
  const total = totalesConSigno(
    traspasos.map((t) => t.sale),
    (m) => m.importe,
  );
  return (
    <Card>
      <CardContent className="p-0">
        <Table movil="tarjetas">
          <TableHeader>
            <TableRow>
              <TableHead>Sale de</TableHead>
              <TableHead>Entra en</TableHead>
              <TableHead className="text-right w-28">Importe</TableHead>
              <TableHead aria-label="Acciones" className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {traspasos.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {error
                    ? `No se pudo leer: ${error.message}`
                    : isPending
                      ? "Cargando…"
                      : "No hay traspasos entre cuentas propias."}
                </TableCell>
              </TableRow>
            )}
            {traspasos.map(({ sale, entra }) => (
              <TableRow key={sale.id}>
                <TableCell>
                  {cuentaDe(sale)} · {fechaCorta(sale.fecha)}
                </TableCell>
                <TableCell>
                  {entra ? `${cuentaDe(entra)} · ${fechaCorta(entra.fecha)}` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {eur(Math.abs(sale.importe))}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="No es un traspaso"
                    disabled={ocupado}
                    onClick={() => alDesmarcar(sale.id)}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {traspasos.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-semibold">
                  {parcial ? "Total de la página" : "Total"} · {traspasos.length}{" "}
                  {traspasos.length === 1 ? "traspaso" : "traspasos"}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {eur(total.salidas)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
        {data && (
          <Paginas
            pagina={data.pagina}
            porPagina={data.porPagina}
            total={data.total}
            ocupado={isFetching}
            alCambiar={setPedida}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** «101–200 de 340» y los botones para ir a los más recientes o a los anteriores. */
function Paginas({
  pagina,
  porPagina,
  total,
  ocupado,
  alCambiar,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  ocupado: boolean;
  alCambiar: (pagina: number) => void;
}) {
  if (total <= porPagina) return null;
  const t = tramoDePagina(pagina, porPagina, total);
  const hayAnteriores = t.ultima < total;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {numeroJusto(t.primera, 0)}–{numeroJusto(t.ultima, 0)} de {numeroJusto(total, 0)}, los más
        recientes primero
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={t.pagina === 0 || ocupado}
          onClick={() => alCambiar(t.pagina - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Más recientes
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hayAnteriores || ocupado}
          onClick={() => alCambiar(t.pagina + 1)}
        >
          Anteriores
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function ListaSugerencias({
  movimiento,
  libres,
  ocupado,
  alEnlazar,
}: {
  movimiento: Movimiento;
  libres: DocumentoConciliable[];
  ocupado: boolean;
  alEnlazar: (d: DocumentoConciliable) => void;
}) {
  const lista = useMemo(() => sugerencias(movimiento, libres), [movimiento, libres]);
  if (lista.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Ninguna factura pendiente tiene este importe. Si paga varias, o es un pago parcial, el motor
        lo busca al aplicar la propuesta.
      </p>
    );
  }
  return (
    <div className="max-h-[60vh] space-y-2 overflow-y-auto">
      {lista.map((s) => (
        <div
          key={claveDoc(s.documento)}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
        >
          <div className="min-w-0">
            <div className="font-medium">{etiquetaDoc(s.documento as DocumentoConciliable)}</div>
            <div className="text-xs text-muted-foreground">
              {fechaCorta(s.documento.fecha)} · {eur(Math.abs(s.documento.esperado))} ·{" "}
              {s.dias === 0
                ? "el mismo día"
                : s.dias > 0
                  ? `${s.dias} días después`
                  : `${-s.dias} días antes`}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {s.contraparte && (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {s.contraparte === "nif"
                    ? "Trae el NIF"
                    : s.contraparte === "referencia"
                      ? "Trae el número"
                      : "Nombra a la contraparte"}
                </Badge>
              )}
              {!s.enVentana && (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  Fuera de fechas
                </Badge>
              )}
            </div>
          </div>
          <Button
            size="sm"
            disabled={ocupado}
            onClick={() => alEnlazar(s.documento as DocumentoConciliable)}
          >
            <ArrowLeftRight className="h-4 w-4 mr-1" />
            Enlazar
          </Button>
        </div>
      ))}
    </div>
  );
}
