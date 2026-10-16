import { useCallback, useMemo, useState } from "react";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Download,
  Eye,
  FileText,
  RefreshCw,
  RotateCcw,
  Save,
  Store,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EstadoVacio } from "@/components/EstadoVacio";
import { useAuth } from "@/lib/auth-context";
import { descargarBlob } from "@/lib/csv";
import { cn } from "@/lib/utils";
import {
  guardarPlantillaPresupuesto,
  listarPlantillasPresupuesto,
} from "@/lib/plantillas-presupuesto.functions";
import {
  PLANTILLA_POR_DEFECTO,
  ambitoDeClave,
  normalizarPlantilla,
  resolverIdentidad,
} from "@/dominio/plantilla-presupuesto";
import {
  EditorContexto,
  SECCION_DE,
  firmaBorrador,
  valoresDeVista,
  type Borrador,
  type Cambio,
  type ContextoEditor,
  type Seleccion,
} from "@/components/plantillas/editor";
import { DisenadorCabecera } from "@/components/plantillas/DisenadorCabecera";
import { SeccionesPlantilla } from "@/components/plantillas/SeccionesPlantilla";
import { VistaPreviaPdf } from "@/components/plantillas/VistaPreviaPdf";
import { useVistaPrevia } from "@/components/plantillas/use-vista-previa";
import { useConsultaMedia } from "@/components/plantillas/use-consulta-media";

/**
 * Ajustes generales → PDF de presupuestos.
 *
 * Una plantilla por tienda y otra para el textil personalizado: qué sale en
 * el PDF de un presupuesto, dónde y con qué textos. Se guarda en
 * `plantillas_presupuesto` y el PDF la usa solo cada vez que se genera; sin
 * plantilla guardada sale la de por defecto, que es el diseño de siempre.
 *
 * A la izquierda se edita (el diseñador de la cabecera y todos los campos); a
 * la derecha, el PDF de verdad con el último presupuesto del ámbito.
 */
export const Route = createFileRoute("/panel/configuracion-pdf")({
  head: () => ({ meta: [{ title: "PDF de presupuestos · Ajustes · DTF Culture" }] }),
  validateSearch: (s: Record<string, unknown>): { ambito?: string } =>
    typeof s.ambito === "string" && s.ambito ? { ambito: s.ambito } : {},
  component: ConfiguracionPdfPage,
});

const CLAVE_LISTA = ["plantillas-presupuesto"] as const;
const MIGRACION = "20261026100000_plantillas_presupuesto.sql";
/** Desde este ancho, el editor y la vista previa van lado a lado. */
const ANCHO_DOS_COLUMNAS = "(min-width: 1280px)";

/** Los cambios sin guardar, atados al ámbito y a la versión guardada de la que salen. */
type Edicion = { clave: string; origen: string; borrador: Borrador };

const nombreFichero = (etiqueta: string) =>
  etiqueta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "plantilla";

function ConfiguracionPdfPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const { ambito: claveUrl } = Route.useSearch();
  const listar = useServerFn(listarPlantillasPresupuesto);
  const guardarFn = useServerFn(guardarPlantillaPresupuesto);
  const dosColumnas = useConsultaMedia(ANCHO_DOS_COLUMNAS);

  const lista = useQuery({
    queryKey: CLAVE_LISTA,
    queryFn: () => listar(),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const ambitos = useMemo(() => lista.data?.ambitos ?? [], [lista.data]);
  const disponible = lista.data?.disponible ?? false;
  const clave =
    claveUrl && ambitos.some((a) => a.clave === claveUrl) ? claveUrl : (ambitos[0]?.clave ?? null);
  const actual = ambitos.find((a) => a.clave === clave) ?? null;
  const tipo = clave ? (ambitoDeClave(clave)?.ambito ?? "tienda") : "tienda";

  // Lo guardado del ámbito elegido y su huella.
  const origen = useMemo<Borrador | null>(
    () =>
      actual
        ? { plantilla: normalizarPlantilla(actual.plantilla), logo_url: actual.logo_url }
        : null,
    [actual],
  );
  const firmaOrigen = useMemo(() => (origen ? firmaBorrador(origen) : null), [origen]);

  // Lo que se edita. Si cambia el ámbito, o llega otra versión guardada (al
  // guardar), se parte otra vez de lo guardado.
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const vigente = (e: Edicion | null) =>
    e && e.clave === clave && e.origen === firmaOrigen ? e.borrador : null;
  const borrador = vigente(edicion) ?? origen;
  const firmaActual = useMemo(() => (borrador ? firmaBorrador(borrador) : null), [borrador]);
  const sucio = !!borrador && firmaActual !== firmaOrigen;
  const esPorDefecto =
    !!borrador &&
    firmaActual === firmaBorrador({ plantilla: PLANTILLA_POR_DEFECTO, logo_url: null });

  const editar = (f: (b: Borrador) => Borrador) =>
    setEdicion((e) => {
      const de = vigente(e) ?? origen;
      return de && clave && firmaOrigen ? { clave, origen: firmaOrigen, borrador: f(de) } : e;
    });
  const cambiar = (c: Cambio) => editar((b) => ({ ...b, plantilla: c(b.plantilla) }));
  const fijarLogoPropio = (logo_url: string | null) => editar((b) => ({ ...b, logo_url }));

  // La vista previa: el PDF de verdad con la plantilla del borrador.
  const previa = useVistaPrevia({ clave, borrador });
  // La identidad de base: la que manda el servidor con la vista previa; si no
  // ha llegado, la de la lista.
  const base = previa.vista.data?.base ??
    actual?.base ?? { nombre: null, logo_url: null, color: null };
  const identidad = borrador
    ? resolverIdentidad(borrador.plantilla, borrador.logo_url, base)
    : null;
  // Los valores de las variables, con el presupuesto de la vista previa.
  const datosVista = previa.vista.data?.datos;
  const nombreComercial = identidad?.nombre_comercial ?? "";
  const valores = useMemo(
    () => valoresDeVista(datosVista, nombreComercial),
    [datosVista, nombreComercial],
  );

  const puedeGuardar = disponible && isAdmin;

  const guardar = useMutation({
    mutationFn: async () => {
      if (!clave || !borrador || !actual) throw new Error("No hay plantilla que guardar");
      const enviado = {
        clave,
        etiqueta: actual.etiqueta,
        // La versión guardada de la que salía lo que se guarda.
        origen: firmaOrigen,
        plantilla: normalizarPlantilla(borrador.plantilla),
        logo_url: borrador.logo_url?.trim() || null,
      };
      await guardarFn({
        data: { clave: enviado.clave, config: enviado.plantilla, logo_url: enviado.logo_url },
      });
      return enviado;
    },
    onSuccess: async (enviado) => {
      // Lo guardado pasa a ser el punto de partida en el acto; luego se
      // vuelve a leer del servidor, que es quien manda.
      qc.setQueryData<typeof lista.data>(CLAVE_LISTA, (d) =>
        d
          ? {
              ...d,
              ambitos: d.ambitos.map((a) =>
                a.clave === enviado.clave
                  ? {
                      ...a,
                      plantilla: enviado.plantilla,
                      logo_url: enviado.logo_url,
                      guardada: true,
                    }
                  : a,
              ),
            }
          : d,
      );
      // Lo cambiado mientras se guardaba no se pierde: sigue como cambios sin
      // guardar, ahora sobre lo recién guardado. Si no se ha tocado nada, ya no
      // hay cambios.
      const firmaGuardada = firmaBorrador({
        plantilla: enviado.plantilla,
        logo_url: enviado.logo_url,
      });
      setEdicion((e) =>
        e?.clave !== enviado.clave
          ? e
          : e.origen === enviado.origen && firmaBorrador(e.borrador) !== firmaGuardada
            ? { ...e, origen: firmaGuardada }
            : null,
      );
      toast.success(
        `Plantilla guardada. Los PDF de presupuestos de ${enviado.etiqueta} saldrán así.`,
      );
      await qc.invalidateQueries({ queryKey: CLAVE_LISTA });
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido guardar la plantilla"),
  });

  const descartar = () => setEdicion(null);
  const restablecer = () => {
    editar(() => ({ plantilla: structuredClone(PLANTILLA_POR_DEFECTO), logo_url: null }));
    toast.info("Puesta la plantilla por defecto. Pulsa «Guardar» para quedarte con ella.");
  };
  const descargar = () => {
    if (!previa.pdf || !actual) return;
    descargarBlob(
      `vista-previa-presupuesto-${nombreFichero(actual.etiqueta)}.pdf`,
      previa.pdf.blob,
    );
  };

  // Avisar antes de perder cambios: al cambiar de ámbito, al irse a otra
  // pantalla y al cerrar o recargar la pestaña.
  const bloqueo = useBlocker({
    shouldBlockFn: useCallback(
      ({
        current,
        next,
      }: {
        current: { pathname: string };
        next: { pathname: string; search: unknown };
      }) =>
        !(
          next.pathname === current.pathname &&
          (next.search as { ambito?: string } | undefined)?.ambito === clave
        ),
      [clave],
    ),
    enableBeforeUnload: true,
    disabled: !sucio,
    withResolver: true,
  });

  const cambiarAmbito = (nueva: string) => {
    if (nueva === clave) return;
    void navigate({ search: { ambito: nueva }, replace: true });
  };

  // Lo elegido en el diseñador y las secciones abiertas del formulario.
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [abiertas, setAbiertas] = useState<string[]>([]);
  const [verPrevia, setVerPrevia] = useState(false);
  const seccionesCabecera = Object.values(SECCION_DE);

  const elegir = (s: Seleccion | null) => {
    setSeleccion(s);
    if (!s) return;
    // Al elegir algo en el diseñador, se abren sus campos (y se cierran los de
    // los otros elementos de la cabecera; lo demás se queda como estaba).
    setAbiertas((a) => [...a.filter((x) => !seccionesCabecera.includes(x)), SECCION_DE[s]]);
  };
  const irASeccion = (seccion: string) => {
    setAbiertas((a) => (a.includes(seccion) ? a : [...a, seccion]));
    setTimeout(() => {
      document
        .getElementById(`seccion-${seccion}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  const contexto: ContextoEditor | null =
    borrador && identidad && clave
      ? {
          plantilla: borrador.plantilla,
          cambiar,
          logoPropio: borrador.logo_url,
          fijarLogoPropio,
          clave,
          ambito: tipo,
          base,
          identidad,
          valores,
          puedeGuardar,
        }
      : null;

  const panelPrevia = (llenar: boolean) => (
    <VistaPreviaPdf
      numero={previa.vista.data?.numero}
      hayDatos={!!previa.vista.data}
      cargando={previa.vista.isLoading}
      error={previa.vista.error}
      onReintentar={() => void previa.vista.refetch()}
      pdf={previa.pdf}
      generando={previa.generando}
      errorPdf={previa.errorPdf}
      logoFallido={previa.logoFallido}
      llenar={llenar}
    />
  );

  const tiendas = ambitos.filter((a) => ambitoDeClave(a.clave)?.ambito === "tienda");
  const textil = ambitos.filter((a) => ambitoDeClave(a.clave)?.ambito === "textil");

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        // En el ordenador ancho, la página ocupa la pantalla: el formulario se
        // desplaza por dentro y la vista previa se queda a la vista.
        "xl:h-[calc(100dvh-6.5rem)]",
        sucio && !dosColumnas && "pb-20",
      )}
    >
      <div className="space-y-1">
        <Link
          to="/panel/configuracion"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Ajustes
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <FileText className="h-6 w-6 text-primary" /> PDF de presupuestos
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          La plantilla con la que sale el PDF de cada presupuesto: se usa sola cada vez que se crea
          o se descarga uno. Hay una por tienda y otra para el textil personalizado; sin plantilla
          guardada, sale la de por defecto.
        </p>
      </div>

      {lista.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : lista.isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">No se han podido cargar las plantillas</p>
              <p className="break-words text-sm text-muted-foreground">
                {lista.error?.message || "Error desconocido"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void lista.refetch()}>
              <RefreshCw /> Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : ambitos.length === 0 ? (
        <EstadoVacio
          icono={Store}
          titulo="No hay tiendas"
          descripcion="Cuando haya alguna tienda o el textil personalizado, aquí podrás diseñar su PDF de presupuestos."
        />
      ) : (
        <>
          {/* La barra: de quién es la plantilla, cómo está y qué hacer con ella. */}
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-1">
              <Select value={clave ?? undefined} onValueChange={cambiarAmbito}>
                <SelectTrigger className="w-full sm:w-72" aria-label="Plantilla de">
                  <SelectValue placeholder="Elige una tienda" />
                </SelectTrigger>
                <SelectContent>
                  {tiendas.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground">Tiendas</SelectLabel>
                      {tiendas.map((a) => (
                        <SelectItem key={a.clave} value={a.clave}>
                          {a.etiqueta}
                          {a.guardada && (
                            <span className="ml-2 text-xs text-muted-foreground">· propia</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {textil.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-muted-foreground">Textil</SelectLabel>
                      {textil.map((a) => (
                        <SelectItem key={a.clave} value={a.clave}>
                          {a.etiqueta}
                          {a.guardada && (
                            <span className="ml-2 text-xs text-muted-foreground">· propia</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {actual && (
                <Badge
                  variant={actual.guardada ? "secondary" : "outline"}
                  className="whitespace-nowrap font-normal"
                >
                  {actual.guardada ? "Plantilla guardada" : "Por defecto"}
                </Badge>
              )}
              {sucio && (
                <Badge className="whitespace-nowrap border-transparent bg-amber-100 font-normal text-amber-900 shadow-none hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-200">
                  Cambios sin guardar
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:shrink-0 lg:flex-nowrap lg:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={descargar}
                disabled={!previa.pdf || !!previa.vista.error}
                title={previa.pdf ? "Descarga el PDF tal como se ve en la vista previa" : undefined}
              >
                <Download /> Descargar vista previa
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={restablecer}
                disabled={!borrador || esPorDefecto}
                title="Vuelve al diseño de siempre. Hay que guardar para quedarse con él."
              >
                <RotateCcw /> Restablecer por defecto
              </Button>
              <Button variant="ghost" size="sm" onClick={descartar} disabled={!sucio}>
                <Undo2 /> Descartar cambios
              </Button>
              <Button
                size="sm"
                onClick={() => guardar.mutate()}
                disabled={!sucio || !puedeGuardar || guardar.isPending}
              >
                <Save /> {guardar.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>

          {!disponible && (
            <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
              <CardHeader className="p-4 pb-1">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600" /> Falta la migración de las
                  plantillas
                </CardTitle>
                <CardDescription className="text-xs">
                  Para guardar plantillas hay que aplicar la migración{" "}
                  <code className="rounded bg-muted px-1 font-mono">{MIGRACION}</code>. Mientras
                  tanto, los PDF salen con la plantilla por defecto; aquí puedes probar cambios en
                  la vista previa, pero no guardarlos.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {disponible && !isAdmin && (
            <p className="text-xs text-muted-foreground">
              Solo un administrador puede guardar la plantilla o subir un logo.
            </p>
          )}

          {contexto && (
            <EditorContexto.Provider value={contexto}>
              {!dosColumnas && (
                <Collapsible
                  open={verPrevia}
                  onOpenChange={setVerPrevia}
                  className="rounded-lg border bg-card"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
                    >
                      <span className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-muted-foreground" /> Vista previa del PDF
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          verPrevia && "rotate-180",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-3">
                    {panelPrevia(false)}
                  </CollapsibleContent>
                </Collapsible>
              )}

              <div className="grid min-w-0 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(400px,0.85fr)] xl:grid-rows-[minmax(0,1fr)]">
                <div className="min-w-0 space-y-4 xl:min-h-0 xl:overflow-y-auto xl:pb-6 xl:pr-3">
                  <Card>
                    <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
                      <CardTitle className="text-base">Diseño de la cabecera</CardTitle>
                      <CardDescription>
                        La parte de arriba del PDF a escala. Arrastra cada elemento a su sitio; sus
                        campos se abren abajo.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-3 pt-2 sm:p-5 sm:pt-2">
                      <DisenadorCabecera
                        seleccion={seleccion}
                        onSeleccion={elegir}
                        onMasOpciones={irASeccion}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="px-4 py-3 sm:px-5">
                      <SeccionesPlantilla abiertas={abiertas} onAbiertas={setAbiertas} />
                    </CardContent>
                  </Card>
                </div>

                {dosColumnas && (
                  <Card className="flex min-h-0 flex-col p-3">{panelPrevia(true)}</Card>
                )}
              </div>
            </EditorContexto.Provider>
          )}

          {/* En pantallas estrechas la barra de arriba se queda atrás al bajar:
              guardar y descartar, siempre a mano mientras haya cambios. */}
          {sucio && !dosColumnas && (
            <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md items-center gap-2 rounded-xl border bg-card/95 p-2 pl-3 shadow-lg backdrop-blur md:inset-x-auto md:right-6">
              <span className="min-w-0 flex-1 truncate text-sm">Cambios sin guardar</span>
              <Button variant="ghost" size="sm" onClick={descartar}>
                Descartar
              </Button>
              <Button
                size="sm"
                onClick={() => guardar.mutate()}
                disabled={!puedeGuardar || guardar.isPending}
              >
                <Save /> {guardar.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          )}
        </>
      )}

      <AlertDialog open={bloqueo.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>
              Si sigues, se pierden los cambios de la plantilla de{" "}
              {actual?.etiqueta ?? "este ámbito"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => bloqueo.reset?.()}>Seguir editando</AlertDialogCancel>
            {puedeGuardar && (
              <Button
                variant="outline"
                disabled={guardar.isPending}
                onClick={async () => {
                  try {
                    await guardar.mutateAsync();
                    bloqueo.proceed?.();
                  } catch {
                    bloqueo.reset?.();
                  }
                }}
              >
                Guardar y seguir
              </Button>
            )}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                bloqueo.proceed?.();
                // Descartados de verdad: si se vuelve a este ámbito, sale lo guardado.
                setEdicion(null);
              }}
            >
              Descartar y seguir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
