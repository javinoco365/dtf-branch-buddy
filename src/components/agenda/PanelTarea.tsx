// El panel lateral de una tarea: crearla, verla y cambiarla. Es el mismo
// formulario en los dos casos; al ver una tarea, arriba van sus acciones
// (realizada, pasar a otra persona, cancelar) y abajo su historial.
//
// Las reglas son las de src/dominio/agenda.ts y la base las vuelve a
// comprobar. «Yo» es la persona de «¿Quién eres?»: la que firma cada cambio.
//
// Cambiar el estado o pasar la tarea lo hace la página (onCambiarEstado,
// onPasar): así su «Deshacer» no depende de este panel, que ya se habrá
// cerrado, y no cierra el panel de otra tarea que se haya abierto después.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Clock, Package, Search, Send, User } from "lucide-react";
import { toast } from "sonner";
import {
  diaDeTarea,
  esVencida,
  ETIQUETA_ESTADO,
  horaDeMadrid,
  LARGO_NOTAS,
  LARGO_TITULO,
  PRIORIDADES,
  validarTarea,
  type BorradorTarea,
  type CategoriaAgenda,
  type ErroresTarea,
  type EstadoTarea,
  type Tarea,
} from "@/dominio/agenda";
import {
  buscarEnlaceAgenda,
  crearTarea,
  editarTarea,
  historialTarea,
  marcarTareaVista,
  type LineaHistorial,
  type PersonaAgenda,
} from "@/lib/agenda.functions";
import { diaLargo, fechaLarga } from "@/lib/format";
import { avisarError } from "@/lib/errores";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import { Avatar, EtiquetaPrioridad, EtiquetaRealizada } from "./piezas";
import { CLASES_PRIORIDAD, iconoDeCategoria } from "./estilos";

export type QuePanel = { modo: "nueva"; dia?: string } | { modo: "ver"; id: string } | null;

type Datos = { tareas: Tarea[]; categorias: CategoriaAgenda[]; personas: PersonaAgenda[] };

/** Las acciones que hace la página. `alTerminar` se llama solo si salen bien. */
export type AccionesTarea = {
  onCambiarEstado: (t: Tarea, nuevo: EstadoTarea, alTerminar: () => void) => void;
  onPasar: (t: Tarea, para: string, alTerminar: () => void) => void;
  ocupado: boolean;
};

const SIN_HORA = { horaInicio: "09:00", horaFin: "10:00" };

function borradorNuevo(datos: Datos, yo: string | null, dia: string): BorradorTarea {
  const activas = datos.categorias.filter((c) => c.activa);
  const porDefecto = activas.find((c) => !c.enlace) ?? activas[0];
  return {
    titulo: "",
    notas: "",
    categoriaId: porDefecto?.id ?? "",
    prioridad: "normal",
    todoElDia: true,
    dia,
    ...SIN_HORA,
    deSocioId: yo ?? "",
    paraSocioId: yo ?? "",
    pedidoId: null,
    clienteId: null,
  };
}

function borradorDe(t: Tarea): BorradorTarea {
  return {
    titulo: t.titulo,
    notas: t.notas ?? "",
    categoriaId: t.categoriaId,
    prioridad: t.prioridad,
    todoElDia: t.todoElDia,
    dia: diaDeTarea(t),
    horaInicio: t.todoElDia ? SIN_HORA.horaInicio : horaDeMadrid(t.inicio),
    horaFin: t.todoElDia || !t.fin ? SIN_HORA.horaFin : horaDeMadrid(t.fin),
    deSocioId: t.deSocioId,
    paraSocioId: t.paraSocioId,
    pedidoId: t.pedidoId,
    clienteId: t.clienteId,
  };
}

/** Qué error se quita al tocar cada campo. */
const ERROR_DE_CAMPO: Partial<Record<keyof BorradorTarea, (keyof ErroresTarea)[]>> = {
  titulo: ["titulo"],
  paraSocioId: ["para"],
  deSocioId: ["de"],
  categoriaId: ["categoria", "enlace"],
  pedidoId: ["enlace"],
  clienteId: ["enlace"],
  dia: ["dia"],
  todoElDia: ["hora"],
  horaInicio: ["hora"],
  horaFin: ["hora"],
};

export function PanelTarea({
  que,
  datos,
  yo,
  hoy,
  puedeEscribir,
  acciones,
  onCerrar,
  devolverFoco,
}: {
  que: QuePanel;
  datos: Datos;
  yo: string | null;
  hoy: string;
  puedeEscribir: boolean;
  acciones: AccionesTarea;
  onCerrar: () => void;
  /** A dónde vuelve el foco al cerrar (lo que se pulsó para abrir). */
  devolverFoco: () => void;
}) {
  const tarea = que?.modo === "ver" ? (datos.tareas.find((t) => t.id === que.id) ?? null) : null;
  // Una clave por apertura: al abrir otra tarea, el formulario empieza de cero.
  const clave = que ? (que.modo === "ver" ? que.id : `nueva-${que.dia ?? ""}`) : "cerrado";
  // El formulario dice cómo cerrarse (preguntando si hay cambios). Lo usan la
  // X, Escape y el clic fuera, que llegan todos por onOpenChange.
  const pedirCierre = useRef<() => void>(onCerrar);
  return (
    <Sheet
      open={!!que && (que.modo === "nueva" || !!tarea)}
      onOpenChange={(o) => !o && pedirCierre.current()}
    >
      {que && (que.modo === "nueva" || tarea) && (
        <Formulario
          key={clave}
          tarea={tarea}
          diaInicial={que.modo === "nueva" ? (que.dia ?? hoy) : hoy}
          datos={datos}
          yo={yo}
          hoy={hoy}
          puedeEscribir={puedeEscribir}
          acciones={acciones}
          onCerrar={onCerrar}
          devolverFoco={devolverFoco}
          registrarCierre={(f) => {
            pedirCierre.current = f;
          }}
        />
      )}
    </Sheet>
  );
}

function Formulario({
  tarea,
  diaInicial,
  datos,
  yo,
  hoy,
  puedeEscribir,
  acciones,
  onCerrar,
  devolverFoco,
  registrarCierre,
}: {
  tarea: Tarea | null;
  diaInicial: string;
  datos: Datos;
  yo: string | null;
  hoy: string;
  puedeEscribir: boolean;
  acciones: AccionesTarea;
  onCerrar: () => void;
  devolverFoco: () => void;
  registrarCierre: (f: () => void) => void;
}) {
  const inicial = useMemo(
    () => (tarea ? borradorDe(tarea) : borradorNuevo(datos, yo, diaInicial)),
    // Solo al abrir: los cambios de los datos no pisan lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [b, setB] = useState<BorradorTarea>(inicial);
  const [enlaceTexto, setEnlaceTexto] = useState<string | null>(tarea?.enlaceTexto ?? null);
  const [errores, setErrores] = useState<ErroresTarea>({});
  const [descartar, setDescartar] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [pasarA, setPasarA] = useState("");
  const tituloRef = useRef<HTMLInputElement>(null);

  const crear = useServerFn(crearTarea);
  const editar = useServerFn(editarTarea);
  const marcarVista = useServerFn(marcarTareaVista);

  const categoria = datos.categorias.find((c) => c.id === b.categoriaId) ?? null;
  const nombre = (id: string) => datos.personas.find((p) => p.id === id)?.nombre ?? "—";
  const personasActivas = datos.personas.filter(
    (p) => p.activo || p.id === b.paraSocioId || p.id === b.deSocioId,
  );
  const editable = puedeEscribir && (!tarea || (!!yo && tarea.estado !== "cancelada"));
  const cambiado = JSON.stringify(b) !== JSON.stringify(inicial);
  const set = (c: Partial<BorradorTarea>) => {
    setB((x) => ({ ...x, ...c }));
    const quitar = Object.keys(c).flatMap((k) => ERROR_DE_CAMPO[k as keyof BorradorTarea] ?? []);
    if (quitar.length) {
      setErrores((e) => {
        const n = { ...e };
        for (const k of quitar) delete n[k];
        return n;
      });
    }
  };

  function cerrar() {
    if (editable && cambiado) setDescartar(true);
    else onCerrar();
  }
  registrarCierre(cerrar);

  // Al abrir una tarea que me han mandado, deja de salir como nueva.
  const vista = useMutation({
    mutationFn: () => marcarVista({ data: { id: tarea!.id, socio: yo! } }),
  });
  useEffect(() => {
    if (tarea && yo && puedeEscribir && tarea.paraSocioId === yo && !tarea.vistaEn) vista.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Para sí misma: la base la da por vista al crearla y no le sale como nueva.
  const paraOtro = !!b.paraSocioId && b.paraSocioId !== b.deSocioId;

  const guardar = useMutation({
    mutationFn: async () => {
      if (tarea) {
        const borrador = {
          titulo: b.titulo,
          notas: b.notas,
          categoriaId: b.categoriaId,
          prioridad: b.prioridad,
          todoElDia: b.todoElDia,
          dia: b.dia,
          horaInicio: b.horaInicio,
          horaFin: b.horaFin,
          pedidoId: b.pedidoId,
          clienteId: b.clienteId,
        };
        await editar({ data: { id: tarea.id, socio: yo!, borrador } });
        return null;
      }
      return crear({ data: b });
    },
    onError: (e: Error) => avisarError(e, "No se ha podido guardar la tarea"),
  });

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const err = validarTarea(b, categoria);
    setErrores(err);
    const primero = Object.keys(err)[0];
    if (primero) {
      document.getElementById(`tarea-${primero}`)?.focus();
      return;
    }
    guardar.mutate(undefined, {
      onSuccess: () => {
        toast.success(
          tarea
            ? "Cambios guardados"
            : paraOtro
              ? `Tarea mandada a ${nombre(b.paraSocioId)}. Le saldrá como nueva.`
              : `Tarea creada en la Agenda de ${b.paraSocioId === yo ? "ti" : nombre(b.paraSocioId)}`,
        );
        onCerrar();
      },
    });
  }

  const ocupado = guardar.isPending || acciones.ocupado;
  const sinPersona = puedeEscribir && !yo && !!tarea;
  // Con cambios a medias, las acciones de arriba los perderían: primero guardar o descartar.
  const bloqueoAcciones = cambiado ? "Guarda o descarta los cambios primero" : undefined;
  const activasPara = datos.personas.filter((p) => p.activo);
  const categoriasVisibles = datos.categorias.filter((c) => c.activa || c.id === b.categoriaId);

  return (
    <SheetContent
      side="right"
      className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      onOpenAutoFocus={(e) => {
        if (!tarea) {
          e.preventDefault();
          tituloRef.current?.focus();
        }
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        devolverFoco();
      }}
    >
      <SheetHeader className="space-y-1.5 border-b px-5 pb-3 pt-5 text-left">
        <SheetTitle className="pr-6 text-lg leading-snug">
          {tarea ? tarea.titulo : "Nueva tarea"}
        </SheetTitle>
        <SheetDescription asChild>
          {tarea ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <EtiquetaPrioridad prioridad={tarea.prioridad} />
              <span>
                {diaLargo(diaDeTarea(tarea))} ·{" "}
                {tarea.todoElDia
                  ? "todo el día"
                  : `${horaDeMadrid(tarea.inicio)}–${tarea.fin ? horaDeMadrid(tarea.fin) : ""}`}
              </span>
              {tarea.estado === "hecha" ? (
                <EtiquetaRealizada />
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
                  {ETIQUETA_ESTADO[tarea.estado]}
                </span>
              )}
              {esVencida(tarea, hoy) && (
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Vencida
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm">Le saldrá en su Agenda a la persona a la que se la mandes.</p>
          )}
        </SheetDescription>
      </SheetHeader>

      <form
        id="form-tarea"
        onSubmit={enviar}
        noValidate
        className="flex-1 space-y-5 overflow-y-auto px-5 py-4"
      >
        {sinPersona && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Para cambiar tareas, tu cuenta tiene que tener una persona asignada. Pídeselo a un
            administrador en Ajustes › Usuarios.
          </p>
        )}

        {tarea && (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Avatar
                nombre={nombre(tarea.paraSocioId)}
                yo={tarea.paraSocioId === yo}
                className="h-8 w-8 text-xs"
              />
              <div className="min-w-0 flex-1 text-sm">
                <span className="block text-xs text-muted-foreground">Para</span>
                <b>
                  {nombre(tarea.paraSocioId)}
                  {tarea.paraSocioId === yo && " (tú)"}
                </b>
              </div>
              {editable && tarea.estado === "pendiente" && (
                <div className="flex gap-1.5">
                  <Select value={pasarA} onValueChange={setPasarA} disabled={!!bloqueoAcciones}>
                    <SelectTrigger className="h-9 w-[150px]" aria-label="Pasar a otra persona">
                      <SelectValue placeholder="Pasar a…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activasPara
                        .filter((p) => p.id !== tarea.paraSocioId)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nombre}
                            {p.id === yo && " (tú)"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={!pasarA || ocupado || !!bloqueoAcciones}
                    onClick={() => acciones.onPasar(tarea, pasarA, onCerrar)}
                  >
                    <Send className="h-4 w-4" /> Pasar
                  </Button>
                </div>
              )}
            </div>
            {editable && (
              <>
                <div className="flex flex-wrap gap-2">
                  {tarea.estado === "pendiente" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-status-completado/50 text-status-completado hover:text-status-completado"
                      disabled={ocupado || !!bloqueoAcciones}
                      onClick={() => acciones.onCambiarEstado(tarea, "hecha", onCerrar)}
                    >
                      <Check className="h-4 w-4" /> Marcar como realizada
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={ocupado || !!bloqueoAcciones}
                      onClick={() => acciones.onCambiarEstado(tarea, "pendiente", onCerrar)}
                    >
                      Volver a pendiente
                    </Button>
                  )}
                  {tarea.estado === "pendiente" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:text-destructive"
                      disabled={ocupado || !!bloqueoAcciones}
                      onClick={() => setCancelar(true)}
                    >
                      Cancelar tarea
                    </Button>
                  )}
                </div>
                {bloqueoAcciones && (
                  <p className="text-xs text-muted-foreground">{bloqueoAcciones}.</p>
                )}
              </>
            )}
          </div>
        )}

        <fieldset disabled={!editable} className="space-y-5 disabled:opacity-90">
          <div className="space-y-1.5">
            <Label htmlFor="tarea-titulo">Qué hay que hacer</Label>
            <Input
              id="tarea-titulo"
              ref={tituloRef}
              value={b.titulo}
              maxLength={LARGO_TITULO}
              onChange={(e) => set({ titulo: e.target.value })}
              placeholder="Por ejemplo, llamar al cliente por el retraso"
              aria-invalid={!!errores.titulo}
              aria-describedby={errores.titulo ? "err-titulo" : undefined}
            />
            {errores.titulo && <MensajeError id="err-titulo" texto={errores.titulo} />}
          </div>

          {!tarea && (
            <Opciones
              id="tarea-para"
              etiqueta="Para"
              error={errores.para}
              vacio="No hay personas activas. Se activan en Ajustes › Caja."
              opciones={activasPara.map((p) => ({
                id: p.id,
                contenido: (
                  <>
                    <Avatar
                      nombre={p.nombre}
                      yo={b.paraSocioId === p.id}
                      className="h-5 w-5 text-[9px]"
                    />
                    {p.id === yo ? "Para mí" : p.nombre}
                  </>
                ),
              }))}
              valor={b.paraSocioId}
              onCambio={(v) => set({ paraSocioId: v })}
            />
          )}

          <Opciones
            id="tarea-prioridad"
            etiqueta="Prioridad"
            opciones={PRIORIDADES.map((p) => ({
              id: p.id,
              contenido: (
                <>
                  <span
                    aria-hidden="true"
                    className={cn("h-2.5 w-2.5 rounded-[3px]", CLASES_PRIORIDAD[p.id].punto)}
                  />
                  {p.marca && <span aria-hidden="true">{p.marca}</span>}
                  {p.nombre}
                </>
              ),
              activo: cn(
                CLASES_PRIORIDAD[p.id].suave,
                CLASES_PRIORIDAD[p.id].texto,
                CLASES_PRIORIDAD[p.id].anillo,
              ),
            }))}
            valor={b.prioridad}
            onCambio={(v) => set({ prioridad: v as BorradorTarea["prioridad"] })}
          />

          <div className="space-y-2">
            <span className="text-sm font-medium">Cuándo</span>
            <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <div className="space-y-1">
                <Label htmlFor="tarea-dia" className="text-xs text-muted-foreground">
                  Día
                </Label>
                <Input
                  id="tarea-dia"
                  type="date"
                  value={b.dia}
                  onChange={(e) => set({ dia: e.target.value })}
                  aria-invalid={!!errores.dia}
                  aria-describedby={errores.dia ? "err-dia" : undefined}
                />
              </div>
              {!b.todoElDia && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="tarea-hora" className="text-xs text-muted-foreground">
                      Desde
                    </Label>
                    <Input
                      id="tarea-hora"
                      type="time"
                      step={900}
                      value={b.horaInicio}
                      onChange={(e) => set({ horaInicio: e.target.value })}
                      aria-invalid={!!errores.hora}
                      aria-describedby={errores.hora ? "err-hora" : undefined}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tarea-hora-fin" className="text-xs text-muted-foreground">
                      Hasta
                    </Label>
                    <Input
                      id="tarea-hora-fin"
                      type="time"
                      step={900}
                      value={b.horaFin}
                      onChange={(e) => set({ horaFin: e.target.value })}
                      aria-invalid={!!errores.hora}
                      aria-describedby={errores.hora ? "err-hora" : undefined}
                    />
                  </div>
                </>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={b.todoElDia} onCheckedChange={(v) => set({ todoElDia: v })} />
              Todo el día, sin hora
            </label>
            {!tarea && b.dia && b.dia < hoy && (
              <p className="text-xs text-status-pendiente">
                Ese día ya ha pasado. Si es correcto, la tarea saldrá como vencida.
              </p>
            )}
            {errores.dia && <MensajeError id="err-dia" texto={errores.dia} />}
            {errores.hora && <MensajeError id="err-hora" texto={errores.hora} />}
          </div>

          <Opciones
            id="tarea-categoria"
            etiqueta="Categoría"
            error={errores.categoria}
            vacio="No hay categorías activas. Se activan en Ajustes › Agenda."
            opciones={categoriasVisibles.map((c) => {
              const Icono = iconoDeCategoria(c);
              return {
                id: c.id,
                contenido: (
                  <>
                    <Icono className="h-4 w-4" aria-hidden="true" />
                    {c.nombre}
                  </>
                ),
              };
            })}
            valor={b.categoriaId}
            onCambio={(v) => {
              set({ categoriaId: v, pedidoId: null, clienteId: null });
              setEnlaceTexto(null);
            }}
          />

          {categoria?.enlace && (
            <BuscadorEnlace
              tipo={categoria.enlace}
              elegido={categoria.enlace === "pedido" ? b.pedidoId : b.clienteId}
              texto={enlaceTexto}
              error={errores.enlace}
              onElegir={(id, texto) => {
                set(categoria.enlace === "pedido" ? { pedidoId: id } : { clienteId: id });
                setEnlaceTexto(texto);
              }}
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tarea-notas">
              Notas <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="tarea-notas"
              value={b.notas}
              maxLength={LARGO_NOTAS}
              onChange={(e) => set({ notas: e.target.value })}
              placeholder="Detalles, medidas, a quién preguntar…"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tarea-de">Creada por</Label>
            {tarea ? (
              <p className="flex items-center gap-2 text-sm">
                <Avatar nombre={nombre(tarea.deSocioId)} yo={tarea.deSocioId === yo} />
                {nombre(tarea.deSocioId)}
                {tarea.deSocioId === yo && " (tú)"}
              </p>
            ) : (
              <>
                <Select value={b.deSocioId} onValueChange={(v) => set({ deSocioId: v })}>
                  <SelectTrigger
                    id="tarea-de"
                    className="max-w-[260px]"
                    aria-invalid={!!errores.de}
                    aria-describedby={errores.de ? "err-de" : undefined}
                  >
                    <SelectValue placeholder="Elige quién la crea" />
                  </SelectTrigger>
                  <SelectContent>
                    {personasActivas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre}
                        {p.id === yo && " (tú)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errores.de ? (
                  <MensajeError id="err-de" texto={errores.de} />
                ) : (
                  yo && (
                    <p className="text-xs text-muted-foreground">
                      Viene puesta con quien eres ahora.
                    </p>
                  )
                )}
              </>
            )}
          </div>
        </fieldset>

        {tarea && <Historial id={tarea.id} nombre={nombre} />}
      </form>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <Button type="button" variant="outline" onClick={cerrar}>
          {tarea ? "Cerrar" : "Descartar"}
        </Button>
        {editable && (
          <Button type="submit" form="form-tarea" disabled={ocupado || (!!tarea && !cambiado)}>
            {tarea
              ? "Guardar cambios"
              : paraOtro
                ? `Mandar a ${nombre(b.paraSocioId).split(" ")[0]}`
                : "Crear tarea"}
          </Button>
        )}
      </div>

      <AlertDialog open={descartar} onOpenChange={setDescartar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tarea ? "¿Salir sin guardar los cambios?" : "¿Descartar esta tarea?"}
            </AlertDialogTitle>
            <AlertDialogDescription>Lo que has escrito se perderá.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction onClick={onCerrar}>
              {tarea ? "Salir sin guardar" : "Descartar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {tarea && (
        <AlertDialog open={cancelar} onOpenChange={setCancelar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cancelar esta tarea?</AlertDialogTitle>
              <AlertDialogDescription>
                Desaparece del calendario y queda en la lista, en la pestaña «Canceladas». No se
                borra.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>No, dejarla</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => acciones.onCambiarEstado(tarea, "cancelada", onCerrar)}
              >
                Sí, cancelar tarea
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </SheetContent>
  );
}

function MensajeError({ id, texto }: { id: string; texto: string }) {
  return (
    <p id={id} role="alert" className="text-sm font-medium text-destructive">
      {texto}
    </p>
  );
}

/** Un grupo de botones de los que se elige uno (radio), con teclado. */
function Opciones({
  id,
  etiqueta,
  opciones,
  valor,
  onCambio,
  error,
  vacio,
}: {
  id: string;
  etiqueta: string;
  opciones: { id: string; contenido: React.ReactNode; activo?: string }[];
  valor: string;
  onCambio: (v: string) => void;
  error?: string;
  /** Qué decir si no hay ninguna opción. */
  vacio?: string;
}) {
  const idDe = (i: number) => (i === 0 ? id : `${id}-${opciones[i]!.id}`);
  const mover = (e: React.KeyboardEvent, i: number) => {
    const n =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!n) return;
    e.preventDefault();
    const j = (i + n + opciones.length) % opciones.length;
    onCambio(opciones[j]!.id);
    document.getElementById(idDe(j))?.focus();
  };
  return (
    <div className="space-y-1.5">
      <span id={`${id}-etiqueta`} className="text-sm font-medium">
        {etiqueta}
      </span>
      {opciones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={`${id}-etiqueta`}
          aria-invalid={!!error}
          aria-describedby={error ? `err-${id}` : undefined}
          className="flex flex-wrap gap-1.5"
        >
          {opciones.map((o, i) => {
            const elegido = o.id === valor;
            return (
              <button
                key={o.id}
                id={idDe(i)}
                type="button"
                role="radio"
                aria-checked={elegido}
                aria-describedby={error ? `err-${id}` : undefined}
                tabIndex={elegido || (!opciones.some((x) => x.id === valor) && i === 0) ? 0 : -1}
                onClick={() => onCambio(o.id)}
                onKeyDown={(e) => mover(e, i)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors md:min-h-9",
                  elegido
                    ? cn(
                        "font-semibold ring-1 ring-inset",
                        o.activo ?? "border-foreground bg-muted ring-foreground",
                      )
                    : "hover:bg-accent",
                )}
              >
                {o.contenido}
              </button>
            );
          })}
        </div>
      )}
      {error && <MensajeError id={`err-${id}`} texto={error} />}
    </div>
  );
}

/** Elegir un pedido o un cliente que existan. Lo elegido se ve y se puede cambiar. */
function BuscadorEnlace({
  tipo,
  elegido,
  texto,
  error,
  onElegir,
}: {
  tipo: "pedido" | "cliente";
  elegido: string | null;
  texto: string | null;
  error?: string;
  onElegir: (id: string | null, texto: string | null) => void;
}) {
  const buscar = useServerFn(buscarEnlaceAgenda);
  const [q, setQ] = useState("");
  const Icono = tipo === "pedido" ? Package : User;
  const resultados = useQuery({
    queryKey: ["agenda-enlace", tipo, q.trim()],
    queryFn: () => buscar({ data: { tipo, texto: q } }),
    enabled: !elegido,
    staleTime: 30_000,
  });
  const etiqueta = tipo === "pedido" ? "Qué pedido" : "Qué cliente";

  if (elegido) {
    return (
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{etiqueta}</span>
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
          <Icono className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {texto ?? "Elegido"}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onElegir(null, null)}>
            Cambiar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="tarea-enlace">{etiqueta}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="tarea-enlace"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tipo === "pedido" ? "Busca por número" : "Busca por nombre"}
          className="pl-8"
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={error ? "err-enlace" : undefined}
        />
      </div>
      <ul className="max-h-52 overflow-auto rounded-md border p-1" aria-label="Resultados">
        {resultados.isLoading ? (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">Buscando…</li>
        ) : (resultados.data ?? []).length === 0 ? (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">
            {q.trim() ? `Ningún ${tipo} coincide con «${q.trim()}».` : `No hay ${tipo}s.`}
          </li>
        ) : (
          resultados.data!.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onElegir(r.id, r.texto)}
                className="flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent md:min-h-0"
              >
                <Icono className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{r.texto}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      {error && <MensajeError id="err-enlace" texto={error} />}
    </div>
  );
}

const TEXTO_ACCION: Record<LineaHistorial["accion"], string> = {
  creada: "la creó",
  editada: "la editó",
  pasada: "se la pasó",
  hecha: "la marcó como realizada",
  reabierta: "la volvió a dejar pendiente",
  cancelada: "la canceló",
};

function Historial({ id, nombre }: { id: string; nombre: (id: string) => string }) {
  const leer = useServerFn(historialTarea);
  const { data, isLoading } = useQuery({
    queryKey: ["agenda-historial", id],
    queryFn: () => leer({ data: { id } }),
  });
  return (
    <section className="space-y-2" aria-labelledby="historial-titulo">
      <h3 id="historial-titulo" className="text-sm font-medium">
        Historial
      </h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <ol className="space-y-2.5 border-l-2 pl-4">
          {(data ?? []).map((h) => (
            <li key={h.id} className="relative text-sm">
              <span
                aria-hidden="true"
                className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border"
              />
              <b className="font-medium">{h.socioId ? nombre(h.socioId) : "Alguien"}</b>{" "}
              {TEXTO_ACCION[h.accion]}
              {h.accion === "creada" && h.paraDespues && ` para ${nombre(h.paraDespues)}`}
              {h.accion === "pasada" && h.paraAntes && h.paraDespues && (
                <>
                  {" "}
                  de {nombre(h.paraAntes)} a {nombre(h.paraDespues)}
                </>
              )}
              <time className="block text-xs text-muted-foreground" dateTime={h.cuando}>
                {fechaLarga(h.cuando)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
