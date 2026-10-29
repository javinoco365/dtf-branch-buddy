import { useEffect, useMemo, useState } from "react";
import { usePermisos } from "@/hooks/use-permisos";
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
  Receipt,
  RefreshCw,
  Search,
  Undo2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { eur, fechaCorta, numero, numeroJusto } from "@/lib/format";
import {
  anadirAlEnlace,
  aplicarPlan,
  buscarConciliables,
  confirmarEnlace,
  deshacerEnlace,
  desmarcarTraspaso,
  enlazarManual,
  reconciliar,
  verDesgloseRecibo,
  verEnlaces,
  verTraspasos,
  type Cuantos,
  type DocumentoConciliable,
  type DocumentoEncontrado,
  type EnlaceGuardado,
  type Recortado,
} from "@/lib/conciliacion.functions";
import {
  coincideImporte,
  DIAS_ANTES,
  DIAS_DESPUES,
  diasEntre,
  ETIQUETA_MOTIVO,
  sugerencias,
  type Enlace,
  type Movimiento,
  type Plan,
} from "@/dominio/motor-conciliacion";
import {
  filtrarMovimientos,
  pendienteDeEnlace,
  queda,
  resumenSeleccion,
  sentidoDe,
  SIN_FILTRO,
  totalesPorSentido,
  type FiltroMovimientos,
  type TotalSentido,
} from "@/dominio/conciliar-a-mano";
import { tramoDePagina } from "@/dominio/paginacion";
import { totalesConSigno } from "@/dominio/sumatorios";
import { totalesEnlaces } from "@/dominio/sumatorios-banco";
import { useCuentasBanco } from "./useCuentasBanco";
import { avisarError, mensajeDeError } from "@/lib/errores";

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

/** Lo que devolvió el último «Aplicar» o «Re-conciliar», para enseñarlo hasta cerrarlo. */
type Resultado = {
  titulo: string;
  verdes: number;
  ambares: number;
  traspasos: number;
  rehechos: number;
  errores: string[];
};

/**
 * Conciliación con el motor. Verde: importe, fecha y contraparte, sin duda de
 * qué va con qué. Ámbar: casa el importe y la fecha, o varias cantidades
 * suman; se guarda como «revisar» y no cambia nada hasta que se confirma.
 *
 * Cobros (lo que entra, contra facturas y tickets emitidos) y pagos (lo que
 * sale, contra facturas recibidas) se cuentan y se filtran por separado. A
 * mano se pueden marcar varios movimientos para una factura, o varias
 * facturas para un movimiento, y añadir un pago a una factura cobrada en
 * parte (src/dominio/conciliar-a-mano.ts).
 */
export function MotorConciliacion({
  datos,
  alCambiar,
}: {
  datos: DatosConciliacion;
  alCambiar: () => void;
}) {
  const qc = useQueryClient();
  // El visor ve la conciliación (lo pendiente, lo propuesto y lo hecho), pero
  // no aplica, confirma, enlaza ni deshace nada.
  const { escribir } = usePermisos();
  const { data: banco } = useCuentasBanco();
  const [conciliar, setConciliar] = useState<Movimiento[] | null>(null);
  const [filtro, setFiltro] = useState<FiltroMovimientos>(SIN_FILTRO);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [reconciliarAbierto, setReconciliarAbierto] = useState(false);
  const [rehacerRevisar, setRehacerRevisar] = useState(true);
  const [pestana, setPestana] = useState("pendientes");

  const cuentas = useMemo(
    () =>
      ((banco?.cuentas ?? []) as any[]).map((c) => ({ id: String(c.id), alias: String(c.alias) })),
    [banco],
  );
  const alias = useMemo(
    () => new Map<string, string>(cuentas.map((c) => [c.id, c.alias])),
    [cuentas],
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
  const porSentido = useMemo(() => totalesPorSentido(sinConciliar), [sinConciliar]);
  const visibles = useMemo(() => filtrarMovimientos(sinConciliar, filtro), [sinConciliar, filtro]);
  const cuantos = datos.cuantos ?? { revisar: 0, conciliados: 0, traspasos: 0 };
  // Abonos y cargos por separado: un neto solo esconde cuánto entra y cuánto sale.
  const totalVisibles = totalesConSigno(visibles, (m) => m.importe);
  const { verdes, ambares, traspasos: tp } = datos.plan;
  const hayPlan = verdes.length + ambares.length + tp.length > 0;
  const recorte = avisoRecorte(datos.recortado, datos.limite, !datos.falta);
  const filtrado =
    filtro.sentido !== "todo" || filtro.cuenta !== null || filtro.texto.trim() !== "";

  // Lo marcado que sigue pendiente (lo enlazado desaparece de la lista).
  const elegidos = useMemo(
    () => [...marcados].map((id) => movs.get(id)).filter((m): m is Movimiento => !!m),
    [marcados, movs],
  );
  const seleccion = resumenSeleccion(elegidos, []);
  const errorMarcados =
    seleccion.error && !seleccion.error.startsWith("Marca la factura") ? seleccion.error : null;
  const todosVisiblesMarcados = visibles.length > 0 && visibles.every((m) => marcados.has(m.id));

  const alternarMarcado = (id: string, marcado: boolean) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (marcado) n.add(id);
      else n.delete(id);
      return n;
    });
  const alternarVisibles = (marcado: boolean) =>
    setMarcados((s) => {
      const n = new Set(s);
      for (const m of visibles) {
        if (marcado) n.add(m.id);
        else n.delete(m.id);
      }
      return n;
    });

  const refrescar = () => {
    alCambiar();
    qc.invalidateQueries({ queryKey: [CLAVE_HISTORIAL] });
    qc.invalidateQueries({ queryKey: ["compras"] });
    qc.invalidateQueries({ queryKey: ["facturas"] });
    qc.invalidateQueries({ queryKey: ["conciliar-buscar"] });
  };
  const aviso = (e: any, porDefecto: string) => avisarError(e, porDefecto);

  const alTerminar = (titulo: string) => (r: Omit<Resultado, "titulo">) => {
    const hecho = r.verdes + r.ambares + r.traspasos;
    if (hecho === 0 && r.errores.length === 0) {
      toast.info("No se ha encontrado nada nuevo que conciliar.");
      setResultado(null);
    } else {
      setResultado({ titulo, ...r });
    }
    refrescar();
  };

  const aplicarFn = useServerFn(aplicarPlan);
  const aplicar = useMutation({
    mutationFn: () => aplicarFn(),
    onSuccess: alTerminar("Propuesta aplicada"),
    onError: (e) => aviso(e, "No se pudo aplicar la propuesta"),
  });
  const reconciliarFn = useServerFn(reconciliar);
  const reconciliarM = useMutation({
    mutationFn: () => reconciliarFn({ data: { rehacer_revisar: rehacerRevisar } }),
    onSuccess: (r) => {
      setReconciliarAbierto(false);
      alTerminar("Re-conciliación hecha")(r);
    },
    onError: (e) => aviso(e, "No se pudo re-conciliar"),
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
  const anadirFn = useServerFn(anadirAlEnlace);
  // El error se queda en el diálogo, junto a lo marcado, además del aviso.
  const enlazar = useMutation({
    mutationFn: (v: { movimientos: string[]; documentos: DocumentoEncontrado[] }) => {
      const r = resumenSeleccion(
        v.movimientos.map((id) => movs.get(id)!).filter(Boolean),
        v.documentos,
      );
      if (r.error) throw new Error(r.error);
      return r.ampliaGrupo
        ? anadirFn({ data: { grupo: r.ampliaGrupo, movimientos: v.movimientos } })
        : enlazarFn({
            data: {
              movimientos: v.movimientos,
              documentos: v.documentos.map((d) => ({ tipo: d.tipo, id: d.id })),
            },
          });
    },
    onSuccess: (_r, v) => {
      toast.success(
        v.movimientos.length > 1
          ? `Enlazados los ${v.movimientos.length} movimientos`
          : "Enlazado y conciliado",
      );
      setConciliar(null);
      setMarcados((s) => {
        const n = new Set(s);
        for (const id of v.movimientos) n.delete(id);
        return n;
      });
      refrescar();
    },
    onError: (e) => aviso(e, "No se pudo enlazar"),
  });

  const abrirConciliar = (lista: Movimiento[]) => {
    enlazar.reset();
    setConciliar(lista);
  };

  // Las tarjetas se dan de alta sin IBAN: sus recibos se pueden desglosar.
  const esTarjeta = (cuentaId: string | null) =>
    !!cuentaId && (banco?.cuentas ?? []).some((c: any) => String(c.id) === cuentaId && !c.iban);

  const cuentaDe = (m: Movimiento) =>
    m.cuenta_id ? (alias.get(m.cuenta_id) ?? "—") : "Sin cuenta";

  const verSentido = (sentido: FiltroMovimientos["sentido"]) => {
    setFiltro((f) => ({ ...f, sentido: f.sentido === sentido ? "todo" : sentido }));
    setPestana("pendientes");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <CifraSentido
          titulo="Cobros por conciliar"
          detalle="Lo que entra, contra facturas y tickets emitidos"
          total={porSentido.cobro}
          activo={filtro.sentido === "cobro"}
          alPulsar={() => verSentido("cobro")}
        />
        <CifraSentido
          titulo="Pagos por conciliar"
          detalle="Lo que sale, contra facturas recibidas"
          total={porSentido.pago}
          activo={filtro.sentido === "pago"}
          alPulsar={() => verSentido("pago")}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Propuesta del motor:</span>
            <Badge className="bg-emerald-600 hover:bg-emerald-600">{verdes.length} verdes</Badge>
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              {ambares.length} a revisar
            </Badge>
            <Badge variant="secondary">{tp.length} traspasos</Badge>
          </div>
          {escribir && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={reconciliarM.isPending}
                  onClick={() => setReconciliarAbierto(true)}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${reconciliarM.isPending ? "animate-spin" : ""}`}
                  />
                  Re-conciliar
                </Button>
                <Button disabled={!hayPlan || aplicar.isPending} onClick={() => aplicar.mutate()}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Aplicar la propuesta
                </Button>
              </div>
              {!hayPlan && sinConciliar.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Nada que aplicar: concilia a mano con «Conciliar», o pulsa «Re-conciliar» tras
                  registrar facturas nuevas.
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {resultado && <TarjetaResultado resultado={resultado} alCerrar={() => setResultado(null)} />}

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

      <Tabs value={pestana} onValueChange={setPestana}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="pendientes">Sin conciliar ({sinConciliar.length})</TabsTrigger>
          <TabsTrigger value="revisar">Por revisar ({cuantos.revisar})</TabsTrigger>
          <TabsTrigger value="conciliados">Conciliados ({cuantos.conciliados})</TabsTrigger>
          <TabsTrigger value="traspasos">Traspasos ({cuantos.traspasos})</TabsTrigger>
        </TabsList>

        <TabsContent value="pendientes" className="space-y-3">
          <FiltrosMovimientos filtro={filtro} cuentas={cuentas} alCambiar={setFiltro} />

          {escribir && marcados.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/50 p-3 text-sm">
              <span>
                {elegidos.length} {elegidos.length === 1 ? "movimiento" : "movimientos"} marcados ·{" "}
                <span className="font-semibold tabular-nums">{eur(seleccion.sumaMovimientos)}</span>
                {errorMarcados && <span className="ml-2 text-destructive">{errorMarcados}</span>}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setMarcados(new Set())}>
                  Quitar marcas
                </Button>
                <Button
                  size="sm"
                  disabled={!!errorMarcados || elegidos.length === 0}
                  onClick={() => abrirConciliar(elegidos)}
                >
                  <Lightbulb className="h-4 w-4 mr-1" />
                  Conciliar {elegidos.length > 1 ? "juntos" : ""}
                </Button>
              </div>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    {escribir && (
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Marcar todos los que se ven"
                          checked={todosVisiblesMarcados}
                          onCheckedChange={(v) => alternarVisibles(v === true)}
                        />
                      </TableHead>
                    )}
                    <TableHead className="w-28">Fecha</TableHead>
                    <TableHead className="w-32">Cuenta</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right w-28">Importe</TableHead>
                    <TableHead className="w-72">Propuesta</TableHead>
                    <TableHead aria-label="Acciones" className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={escribir ? 7 : 6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {sinConciliar.length === 0
                          ? "No hay movimientos sin conciliar."
                          : "Ningún movimiento sin conciliar cumple el filtro."}
                      </TableCell>
                    </TableRow>
                  )}
                  {visibles.map((m) => {
                    const p = propuestaDe.get(m.id);
                    const espejo = traspasoPropuesto.get(m.id);
                    return (
                      <TableRow key={m.id} data-state={marcados.has(m.id) ? "selected" : undefined}>
                        {escribir && (
                          <TableCell>
                            <Checkbox
                              aria-label={`Marcar ${m.concepto || "movimiento"}`}
                              checked={marcados.has(m.id)}
                              onCheckedChange={(v) => alternarMarcado(m.id, v === true)}
                            />
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap">{fechaCorta(m.fecha)}</TableCell>
                        <TableCell className="text-sm">{cuentaDe(m)}</TableCell>
                        <TableCell className="text-sm">
                          <div>{m.concepto || "—"}</div>
                          <EtiquetaSentido importe={m.importe} />
                        </TableCell>
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
                          {escribir && (
                            <Button variant="outline" size="sm" onClick={() => abrirConciliar([m])}>
                              <Lightbulb className="h-4 w-4 mr-1" />
                              Conciliar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {visibles.length > 0 && (
                  <TableFooter>
                    {totalVisibles.entradas > 0 && totalVisibles.salidas > 0 && (
                      <>
                        <TableRow>
                          <TableCell colSpan={escribir ? 4 : 3}>Cobros</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            {eur(totalVisibles.entradas)}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={escribir ? 4 : 3}>Pagos</TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-destructive">
                            {eur(-totalVisibles.salidas)}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      </>
                    )}
                    <TableRow>
                      <TableCell colSpan={escribir ? 4 : 3} className="font-semibold">
                        {filtrado ? "Total filtrado" : "Total"} · {totalVisibles.n}{" "}
                        {totalVisibles.n === 1 ? "movimiento" : "movimientos"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${totalVisibles.neto < 0 ? "text-destructive" : ""}`}
                      >
                        {eur(totalVisibles.neto)}
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
            acciones={(e) =>
              escribir && (
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
              )
            }
          />
        </TabsContent>

        <TabsContent value="conciliados">
          <HistorialEnlaces
            estado="conciliada"
            cuentaDe={cuentaDe}
            vacio="Todavía no has conciliado nada."
            acciones={(e) =>
              escribir && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Deshacer"
                  disabled={deshacer.isPending}
                  onClick={() => deshacer.mutate(e.grupo)}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              )
            }
          />
        </TabsContent>

        <TabsContent value="traspasos">
          <HistorialTraspasos
            cuentaDe={cuentaDe}
            esTarjeta={esTarjeta}
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

      <Dialog open={!!conciliar} onOpenChange={(o) => !o && setConciliar(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {conciliar && conciliar.length > 1
                ? `Conciliar ${conciliar.length} movimientos juntos`
                : "Conciliar el movimiento"}
            </DialogTitle>
            <DialogDescription>
              {conciliar?.length === 1 &&
                `${fechaCorta(conciliar[0].fecha)} · ${conciliar[0].concepto || "sin concepto"} · ${eur(conciliar[0].importe)}. `}
              No se guarda nada hasta que enlazas.
            </DialogDescription>
          </DialogHeader>
          {conciliar && (
            <div className="space-y-4">
              {conciliar.length > 1 && (
                <ul className="divide-y rounded-md border text-sm">
                  {conciliar.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 p-2">
                      <span className="min-w-0 truncate">
                        {fechaCorta(m.fecha)} · {m.concepto || "—"}
                      </span>
                      <span className="tabular-nums">{eur(m.importe)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between p-2 font-semibold">
                    <span>Suma</span>
                    <span className="tabular-nums">
                      {eur(resumenSeleccion(conciliar, []).sumaMovimientos)}
                    </span>
                  </li>
                </ul>
              )}
              {conciliar.length === 1 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Con el mismo importe</h3>
                  <ListaSugerencias
                    movimiento={conciliar[0]}
                    libres={libres}
                    ocupado={enlazar.isPending}
                    alEnlazar={(documento) =>
                      enlazar.mutate({ movimientos: [conciliar[0].id], documentos: [documento] })
                    }
                  />
                </div>
              )}
              <BuscarDocumentos
                key={conciliar.map((m) => m.id).join(",")}
                movimientos={conciliar}
                ocupado={enlazar.isPending}
                alEnlazar={(documentos) =>
                  enlazar.mutate({ movimientos: conciliar.map((m) => m.id), documentos })
                }
              />
              {enlazar.error && (
                <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {mensajeDeError(enlazar.error)}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={reconciliarAbierto} onOpenChange={setReconciliarAbierto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Re-conciliar</DialogTitle>
            <DialogDescription>
              Vuelve a leer los movimientos y las facturas de ahora (también las registradas o
              emitidas después de subir el extracto) y vuelve a intentar casarlos. Lo ya conciliado
              y los traspasos no se tocan.
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={rehacerRevisar}
              onCheckedChange={(v) => setRehacerRevisar(v === true)}
            />
            <span>
              Volver a calcular también{" "}
              {cuantos.revisar === 1
                ? "la propuesta «por revisar»"
                : `las ${cuantos.revisar} propuestas «por revisar»`}
              . Todavía no han marcado nada como pagado: se deshacen y entran otra vez en el
              cálculo.
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReconciliarAbierto(false)}>
              Cancelar
            </Button>
            <Button disabled={reconciliarM.isPending} onClick={() => reconciliarM.mutate()}>
              <RefreshCw
                className={`h-4 w-4 mr-2 ${reconciliarM.isPending ? "animate-spin" : ""}`}
              />
              Re-conciliar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Cuántos cobros o pagos quedan y cuánto suman; al pulsar, filtra la lista por ellos. */
function CifraSentido({
  titulo,
  detalle,
  total,
  activo,
  alPulsar,
}: {
  titulo: string;
  detalle: string;
  total: TotalSentido;
  activo: boolean;
  alPulsar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={alPulsar}
      aria-pressed={activo}
      className={`rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 ${activo ? "border-primary ring-1 ring-primary" : ""}`}
    >
      <div className="text-sm text-muted-foreground">{titulo}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`text-2xl font-semibold tabular-nums ${total.total < 0 ? "text-destructive" : ""}`}
        >
          {eur(total.total)}
        </span>
        <span className="text-sm text-muted-foreground">
          {total.n} {total.n === 1 ? "movimiento" : "movimientos"}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {activo ? "Filtrando la lista · pulsa otra vez para quitarlo" : detalle}
      </div>
    </button>
  );
}

function EtiquetaSentido({ importe }: { importe: number }) {
  return sentidoDe(importe) === "cobro" ? (
    <span className="text-xs text-status-completado">Cobro</span>
  ) : (
    <span className="text-xs text-destructive">Pago</span>
  );
}

/** Cobros o pagos, cuenta y concepto o importe. */
function FiltrosMovimientos({
  filtro,
  cuentas,
  alCambiar,
}: {
  filtro: FiltroMovimientos;
  cuentas: { id: string; alias: string }[];
  alCambiar: (f: FiltroMovimientos) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filtro.sentido}
        onValueChange={(v) =>
          v && alCambiar({ ...filtro, sentido: v as FiltroMovimientos["sentido"] })
        }
      >
        <ToggleGroupItem value="todo">Todo</ToggleGroupItem>
        <ToggleGroupItem value="cobro">Cobros</ToggleGroupItem>
        <ToggleGroupItem value="pago">Pagos</ToggleGroupItem>
      </ToggleGroup>
      {cuentas.length > 1 && (
        <Select
          value={filtro.cuenta ?? "todas"}
          onValueChange={(v) => alCambiar({ ...filtro, cuenta: v === "todas" ? null : v })}
        >
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las cuentas</SelectItem>
            {cuentas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.alias}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-9 pl-8"
          placeholder="Concepto o importe"
          value={filtro.texto}
          onChange={(e) => alCambiar({ ...filtro, texto: e.target.value })}
        />
      </div>
      {(filtro.sentido !== "todo" || filtro.cuenta || filtro.texto) && (
        <Button variant="ghost" size="sm" onClick={() => alCambiar(SIN_FILTRO)}>
          Quitar filtros
        </Button>
      )}
    </div>
  );
}

/** Lo que hizo el último «Aplicar» o «Re-conciliar», con cada error a la vista. */
function TarjetaResultado({ resultado, alCerrar }: { resultado: Resultado; alCerrar: () => void }) {
  const r = resultado;
  return (
    <Card className={r.errores.length > 0 ? "border-amber-500" : ""}>
      <CardContent className="space-y-2 py-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p>
            <span className="font-semibold">{r.titulo}:</span> {r.verdes} conciliados, {r.ambares}{" "}
            por revisar, {r.traspasos} traspasos
            {r.rehechos > 0 && `, ${r.rehechos} propuestas recalculadas`}.
          </p>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Cerrar" onClick={alCerrar}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {r.errores.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              {r.errores.length}{" "}
              {r.errores.length === 1 ? "no se pudo hacer" : "no se pudieron hacer"}:
            </p>
            <ul className="list-disc space-y-0.5 pl-6 text-muted-foreground">
              {r.errores.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
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
  const [sentido, setSentido] = useState<FiltroMovimientos["sentido"]>("todo");
  const parcial = !!data && data.total > data.porPagina;
  const enlaces = (data?.enlaces ?? []).filter(
    (e) => sentido === "todo" || sentidoDe(e.movimientos[0]?.importe ?? 0) === sentido,
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={sentido}
          onValueChange={(v) => v && setSentido(v as FiltroMovimientos["sentido"])}
        >
          <ToggleGroupItem value="todo">Todo</ToggleGroupItem>
          <ToggleGroupItem value="cobro">Cobros</ToggleGroupItem>
          <ToggleGroupItem value="pago">Pagos</ToggleGroupItem>
        </ToggleGroup>
        {parcial && sentido !== "todo" && (
          <span className="text-xs text-muted-foreground">Filtra la página que se ve.</span>
        )}
      </div>
      <TablaEnlaces
        enlaces={enlaces}
        cuentaDe={cuentaDe}
        vacio={
          error
            ? `No se pudo leer: ${mensajeDeError(error)}`
            : isPending
              ? "Cargando…"
              : sentido !== "todo" && (data?.enlaces.length ?? 0) > 0
                ? `No hay ${sentido === "cobro" ? "cobros" : "pagos"} aquí.`
                : vacio
        }
        acciones={acciones}
        parcial={parcial}
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
    </div>
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
                  <EtiquetaSentido importe={e.movimientos[0]?.importe ?? 0} />
                  <div className="text-xs">
                    {ETIQUETA_MOTIVO[e.motivo as keyof typeof ETIQUETA_MOTIVO] ?? e.motivo}
                  </div>
                  {e.diferencia !== 0 && <Diferencia enlace={e} />}
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

/**
 * La diferencia de un enlace: si es una sola factura y el banco se quedó
 * corto, lo que falta por cobrar o pagar (se completa buscándola en
 * «Conciliar» con el siguiente pago); si no, cuánto difiere.
 */
function Diferencia({ enlace }: { enlace: EnlaceGuardado }) {
  const falta =
    enlace.documentos.length === 1
      ? pendienteDeEnlace(enlace.documentos[0].esperado, enlace.diferencia)
      : null;
  return falta !== null ? (
    <div className="text-xs text-status-pendiente">
      Falta {sentidoDe(falta) === "cobro" ? "cobrar" : "pagar"} {eur(Math.abs(falta))}
    </div>
  ) : (
    <div className="text-xs text-amber-600">Difiere {eur(enlace.diferencia)}</div>
  );
}

function HistorialTraspasos({
  cuentaDe,
  esTarjeta,
  ocupado,
  alDesmarcar,
}: {
  cuentaDe: (m: Movimiento) => string;
  esTarjeta: (cuentaId: string | null) => boolean;
  ocupado: boolean;
  alDesmarcar: (movimientoId: string) => void;
}) {
  const { escribir } = usePermisos();
  const verFn = useServerFn(verTraspasos);
  const { data, error, isPending, isFetching, setPedida } = usePaginaHistorial(
    "traspasos",
    (pagina) => verFn({ data: { pagina } }),
  );
  const traspasos = data?.traspasos ?? [];
  const parcial = !!data && data.total > data.porPagina;
  const [desglose, setDesglose] = useState<Movimiento | null>(null);
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
              <TableHead aria-label="Acciones" className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {traspasos.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {error
                    ? `No se pudo leer: ${mensajeDeError(error)}`
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
                <TableCell className="whitespace-nowrap text-right">
                  {entra && esTarjeta(entra.cuenta_id) && (
                    <Button variant="ghost" size="sm" onClick={() => setDesglose(entra)}>
                      <Receipt className="h-4 w-4 mr-1" />
                      Ver compras
                    </Button>
                  )}
                  {escribir && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="No es un traspaso"
                      disabled={ocupado}
                      onClick={() => alDesmarcar(sale.id)}
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  )}
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
        <DesgloseRecibo recibo={desglose} alCerrar={() => setDesglose(null)} />
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

/**
 * Buscar a mano en todos los documentos (no solo los cargados): por nombre,
 * NIF, número o importe, varias palabras a la vez y sin acentos. Empieza
 * buscando el importe de lo que se concilia, lo más probable primero. Se
 * pueden marcar varias facturas para un movimiento (una remesa de TPV, un
 * pago de varias) o una factura para varios movimientos; una factura cobrada
 * en parte sale con lo que le falta, y enlazarla le añade este pago. Abajo
 * dice cuánto suma lo marcado, cuánto falta y, si no se puede, por qué.
 */
function BuscarDocumentos({
  movimientos,
  ocupado,
  alEnlazar,
}: {
  movimientos: Movimiento[];
  ocupado: boolean;
  alEnlazar: (documentos: DocumentoEncontrado[]) => void;
}) {
  const buscarFn = useServerFn(buscarConciliables);
  const suma = resumenSeleccion(movimientos, []).sumaMovimientos;
  const inicial = numero(Math.abs(suma), 2);
  const [texto, setTexto] = useState(inicial);
  const [buscado, setBuscado] = useState(inicial);
  const [elegidos, setElegidos] = useState<Map<string, DocumentoEncontrado>>(new Map());
  // Con varios movimientos, una sola factura: la base no enlaza varios con varios.
  const unaSola = movimientos.length > 1;

  // Espera a que se deje de escribir para no buscar con cada letra.
  useEffect(() => {
    const t = setTimeout(() => setBuscado(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const signo = suma < 0 ? "cargo" : "abono";
  const ultima = movimientos.reduce(
    (f, m) => (m.fecha > f ? m.fecha : f),
    movimientos[0]?.fecha ?? "",
  );
  const objetivo = { importe: suma, fecha: ultima };
  const {
    data: encontrados = [],
    isFetching,
    error,
  } = useQuery({
    queryKey: ["conciliar-buscar", signo, buscado, objetivo.importe, objetivo.fecha],
    enabled: buscado.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => buscarFn({ data: { texto: buscado, signo, objetivo } }),
  });

  const lista = buscado ? encontrados : [];
  const marcados = [...elegidos.values()];
  const resumen = resumenSeleccion(movimientos, marcados);

  const alternar = (d: DocumentoEncontrado, marcado: boolean) =>
    setElegidos((m) => {
      const n = unaSola ? new Map<string, DocumentoEncontrado>() : new Map(m);
      if (marcado) n.set(claveDoc(d), d);
      else n.delete(claveDoc(d));
      return n;
    });

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Buscar {signo === "cargo" ? "facturas recibidas" : "facturas y tickets emitidos"}
      </h3>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Nombre, NIF, número (T2026/0057) o importe (15,72)"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Varias palabras: tienen que estar todas. Un importe encuentra lo que está a 1 € o menos; lo
        que casa al céntimo y la fecha más cercana van primero.
        {unaSola && " Con varios movimientos se elige una sola factura."}
      </p>
      {error && <p className="text-sm text-destructive">{mensajeDeError(error)}</p>}
      {buscado && !isFetching && lista.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          Nada sin conciliar coincide. Prueba con otra palabra del nombre, el NIF o el número.
        </p>
      )}
      {lista.length > 0 && (
        <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-md border text-sm">
          {lista.map((d) => {
            const clave = claveDoc(d);
            const exacto = coincideImporte(suma, queda(d));
            const dias = diasEntre(d.fecha, ultima);
            return (
              <li key={clave}>
                <label className="flex cursor-pointer items-center gap-3 p-2.5">
                  <Checkbox
                    checked={elegidos.has(clave)}
                    onCheckedChange={(v) => alternar(d, v === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{etiquetaDoc(d)}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {fechaCorta(d.fecha)}
                      <span>
                        {dias === 0
                          ? "el mismo día"
                          : dias > 0
                            ? `${dias} días antes del banco`
                            : `${-dias} días después del banco`}
                      </span>
                      {exacto && <span className="text-status-completado">mismo importe</span>}
                      {d.parcial && (
                        <span className="text-status-pendiente">
                          cobrada en parte: ya {eur(Math.abs(d.parcial.pagado))}, falta{" "}
                          {eur(Math.abs(d.parcial.pendiente))}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tabular-nums">{eur(Math.abs(d.esperado))}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {elegidos.size > 0 && (
        <div className="space-y-1 rounded-md bg-muted/50 p-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {elegidos.size} {elegidos.size === 1 ? "documento" : "documentos"} ·{" "}
              {eur(Math.abs(resumen.sumaDocumentos))}
              {!resumen.error &&
                (resumen.diferencia === 0 ? (
                  <span className="ml-2 text-status-completado">cuadra con el banco</span>
                ) : (
                  <span className="ml-2 text-status-pendiente">
                    diferencia {eur(resumen.diferencia)}
                    {Math.abs(resumen.sumaMovimientos) < Math.abs(resumen.sumaDocumentos)
                      ? " (cobro parcial: quedará pendiente lo que falta)"
                      : " (comisión, redondeo o falta algo)"}
                  </span>
                ))}
            </span>
            <Button
              size="sm"
              disabled={ocupado || !!resumen.error}
              onClick={() => alEnlazar(marcados)}
            >
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              {resumen.ampliaGrupo
                ? "Añadir este pago"
                : `Enlazar ${elegidos.size > 1 ? `los ${elegidos.size}` : ""}`}
            </Button>
          </div>
          {resumen.error && <p className="text-destructive">{resumen.error}</p>}
        </div>
      )}
    </div>
  );
}

/** Qué compras de la tarjeta paga un recibo (src/dominio/recibos-tarjeta.ts). */
function DesgloseRecibo({ recibo, alCerrar }: { recibo: Movimiento | null; alCerrar: () => void }) {
  const verFn = useServerFn(verDesgloseRecibo);
  const { data, error, isPending } = useQuery({
    queryKey: ["recibo-tarjeta", recibo?.id],
    enabled: !!recibo,
    queryFn: () => verFn({ data: { movimiento_id: recibo!.id } }),
  });
  return (
    <Dialog open={!!recibo} onOpenChange={(o) => !o && alCerrar()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compras de este recibo</DialogTitle>
          <DialogDescription>
            {recibo && `${fechaCorta(recibo.fecha)} · ${eur(recibo.importe)}. `}
            Las compras pendientes más antiguas de la tarjeta, por orden, hasta llegar al importe
            del recibo.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{mensajeDeError(error)}</p>
        ) : isPending || !data ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="space-y-2 text-sm">
            {!data.cuadra && (
              <p className="flex gap-2 text-status-pendiente">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                No cuadra: las compras pendientes de antes del recibo se quedan a{" "}
                {eur(data.diferencia)} de su importe. ¿Falta subir parte del extracto de la tarjeta?
              </p>
            )}
            <ul className="divide-y rounded-md border">
              {data.compras.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 p-2.5">
                  <span className="min-w-0">
                    <span className="block truncate">{c.concepto || "—"}</span>
                    <span className="text-xs text-muted-foreground">{fechaCorta(c.fecha)}</span>
                  </span>
                  <span className="tabular-nums">{eur(c.importe)}</span>
                </li>
              ))}
            </ul>
            <p className="text-right font-semibold tabular-nums">
              {data.compras.length} {data.compras.length === 1 ? "compra" : "compras"} ·{" "}
              {eur(data.compras.reduce((s, c) => s + c.importe, 0))}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
