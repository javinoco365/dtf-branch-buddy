import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, KeyRound, Store, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-context";
import { usePermisos } from "@/hooks/use-permisos";
import { fechaCorta } from "@/lib/format";
import {
  DESCRIPCION_NIVEL,
  ETIQUETA_NIVEL,
  impedimentoAlta,
  impedimentoCambioUsuario,
  NIVELES,
  ordenarUsuarios,
  type Nivel,
} from "@/dominio/permisos";
import {
  cambiarActivoUsuario,
  cambiarNivelUsuario,
  cambiarTiendasUsuario,
  crearUsuario,
  enlaceContrasena,
  listarUsuarios,
  type UsuarioListado,
} from "@/lib/usuarios.functions";
import { avisarError, mensajeDeError } from "@/lib/errores";

export const Route = createFileRoute("/panel/usuarios")({
  head: () => ({ meta: [{ title: "Usuarios · DTF Culture" }] }),
  component: Usuarios,
});

type Tienda = { id: string; nombre: string };
type Enlace = { email: string; enlace: string };

const VARIANTE_NIVEL: Record<Nivel, "default" | "secondary" | "outline"> = {
  admin: "default",
  editor: "secondary",
  visor: "outline",
};

function Usuarios() {
  const { user } = useAuth();
  const { gestionarUsuarios, cargando } = usePermisos();
  const listar = useServerFn(listarUsuarios);
  const [alta, setAlta] = useState(false);
  const [tiendasDe, setTiendasDe] = useState<UsuarioListado | null>(null);
  const [desactivar, setDesactivar] = useState<UsuarioListado | null>(null);
  const [enlace, setEnlace] = useState<Enlace | null>(null);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => listar(),
    enabled: gestionarUsuarios,
  });
  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas", "usuarios"],
    queryFn: async () =>
      ((await supabase.from("tiendas").select("id, nombre").order("nombre")).data ??
        []) as Tienda[],
    enabled: gestionarUsuarios,
  });

  if (cargando) return null;
  if (!gestionarUsuarios)
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Solo un administrador gestiona los usuarios.
        </CardContent>
      </Card>
    );

  const lista = ordenarUsuarios(usuarios.data ?? []);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            to="/panel/configuracion"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Ajustes
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios y permisos</h1>
          <p className="text-sm text-muted-foreground">
            Quién entra en el CRM y qué puede hacer. Desactivar no borra: lo que hizo cada uno se
            conserva en la auditoría.
          </p>
        </div>
        <Button onClick={() => setAlta(true)}>
          <UserPlus className="h-4 w-4" /> Nuevo usuario
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {NIVELES.map((n) => (
          <Card key={n}>
            <CardContent className="p-4 space-y-1">
              <Badge variant={VARIANTE_NIVEL[n]}>{ETIQUETA_NIVEL[n]}</Badge>
              <p className="text-sm text-muted-foreground">{DESCRIPCION_NIVEL[n]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuarios</CardTitle>
          <CardDescription>
            Con un nivel activo se ve todo (todas las tiendas y la empresa), salvo las credenciales
            de WooCommerce, el correo saliente y esta gestión de usuarios. El nivel decide qué se
            puede cambiar. El acceso a tiendas solo cuenta para quien todavía no tiene nivel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usuarios.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : usuarios.error ? (
            <p className="text-sm text-destructive">{mensajeDeError(usuarios.error)}</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay usuarios.</p>
          ) : (
            <ListaUsuarios
              usuarios={lista}
              yo={user?.id ?? ""}
              tiendas={tiendas}
              onTiendas={setTiendasDe}
              onDesactivar={setDesactivar}
              onEnlace={setEnlace}
            />
          )}
        </CardContent>
      </Card>

      <AltaUsuario
        abierto={alta}
        onCerrar={() => setAlta(false)}
        tiendas={tiendas}
        onEnlace={setEnlace}
      />
      <TiendasUsuario usuario={tiendasDe} tiendas={tiendas} onCerrar={() => setTiendasDe(null)} />
      <ConfirmarDesactivar usuario={desactivar} onCerrar={() => setDesactivar(null)} />
      <EnlaceDialog enlace={enlace} onCerrar={() => setEnlace(null)} />
    </div>
  );
}

function ListaUsuarios({
  usuarios,
  yo,
  tiendas,
  onTiendas,
  onDesactivar,
  onEnlace,
}: {
  usuarios: UsuarioListado[];
  yo: string;
  tiendas: Tienda[];
  onTiendas: (u: UsuarioListado) => void;
  onDesactivar: (u: UsuarioListado) => void;
  onEnlace: (e: Enlace) => void;
}) {
  const qc = useQueryClient();
  const cambiarNivel = useServerFn(cambiarNivelUsuario);
  const cambiarActivo = useServerFn(cambiarActivoUsuario);
  const pedirEnlace = useServerFn(enlaceContrasena);

  const nivel = useMutation({
    mutationFn: (v: { user_id: string; nivel: Nivel }) => cambiarNivel({ data: v }),
    onSuccess: (r) => {
      if (r.aviso) toast.warning(`Nivel cambiado. ${r.aviso}`, { duration: 10000 });
      else toast.success("Nivel cambiado");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) => avisarError(e),
  });
  const reactivar = useMutation({
    mutationFn: (user_id: string) => cambiarActivo({ data: { user_id, activo: true } }),
    onSuccess: () => {
      toast.success("Usuario reactivado");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) => avisarError(e),
  });
  const enlace = useMutation({
    mutationFn: (email: string) =>
      pedirEnlace({ data: { email, origen: window.location.origin } }).then((r) => ({
        email,
        enlace: r.enlace,
      })),
    onSuccess: onEnlace,
    onError: (e: Error) => avisarError(e),
  });

  const impedimento = (u: UsuarioListado, cambio: { nivel?: Nivel; activo?: boolean }) =>
    impedimentoCambioUsuario(usuarios, yo, u.id, cambio);

  const nombreTienda = useMemo(() => new Map(tiendas.map((t) => [t.id, t.nombre])), [tiendas]);
  const textoTiendas = (u: UsuarioListado) =>
    u.nivel === "admin"
      ? "Todas (administrador)"
      : u.nivel && u.activo
        ? "Todas (por su nivel)"
        : u.tienda_ids.length === 0
          ? "Ninguna"
          : u.tienda_ids.length === tiendas.length && tiendas.length > 1
            ? "Todas"
            : u.tienda_ids.map((id) => nombreTienda.get(id) ?? "—").join(", ");

  const selectorNivel = (u: UsuarioListado) => (
    <Select
      value={u.nivel ?? undefined}
      onValueChange={(v) => nivel.mutate({ user_id: u.id, nivel: v as Nivel })}
      disabled={nivel.isPending || !u.activo}
    >
      <SelectTrigger className="w-[160px]" aria-label={`Nivel de ${u.nombre}`}>
        <SelectValue placeholder="Sin nivel" />
      </SelectTrigger>
      <SelectContent>
        {NIVELES.map((n) => (
          <SelectItem key={n} value={n} disabled={n !== u.nivel && !!impedimento(u, { nivel: n })}>
            {ETIQUETA_NIVEL[n]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const interruptorActivo = (u: UsuarioListado) => {
    const motivo = impedimento(u, { activo: !u.activo });
    return (
      <Switch
        checked={u.activo}
        disabled={!!motivo || reactivar.isPending}
        title={motivo ?? (u.activo ? "Desactivar" : "Reactivar")}
        aria-label={u.activo ? `Desactivar a ${u.nombre}` : `Reactivar a ${u.nombre}`}
        onCheckedChange={(v) => (v ? reactivar.mutate(u.id) : onDesactivar(u))}
      />
    );
  };

  const botones = (u: UsuarioListado) => (
    <div className="flex gap-1 justify-end">
      {u.nivel !== "admin" && (
        <Button variant="ghost" size="sm" onClick={() => onTiendas(u)} title="Acceso a tiendas">
          <Store className="h-4 w-4" />
          <span className="sr-only">Acceso a tiendas</span>
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => enlace.mutate(u.email)}
        disabled={enlace.isPending || !u.activo}
        title="Enlace para poner contraseña"
      >
        <KeyRound className="h-4 w-4" />
        <span className="sr-only">Enlace para poner contraseña</span>
      </Button>
    </div>
  );

  const etiquetas = (u: UsuarioListado) => (
    <>
      {u.id === yo && <Badge variant="outline">Tú</Badge>}
      {!u.activo && <Badge variant="destructive">Desactivado</Badge>}
      {u.pendiente && <Badge variant="outline">Invitación pendiente</Badge>}
      {u.activo && !u.nivel && <Badge variant="destructive">Sin nivel</Badge>}
    </>
  );

  return (
    <>
      {/* Ordenador */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Nivel</TableHead>
              <TableHead>Tiendas</TableHead>
              <TableHead>Último acceso</TableHead>
              <TableHead>Activo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((u) => (
              <TableRow key={u.id} className={u.activo ? undefined : "opacity-60"}>
                <TableCell>
                  <div className="font-medium flex flex-wrap items-center gap-2">
                    {u.nombre} {etiquetas(u)}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>{selectorNivel(u)}</TableCell>
                <TableCell className="text-sm max-w-[240px] truncate" title={textoTiendas(u)}>
                  {textoTiendas(u)}
                </TableCell>
                <TableCell className="text-sm">
                  {u.ultimo_acceso ? fechaCorta(u.ultimo_acceso) : "Nunca"}
                </TableCell>
                <TableCell>{interruptorActivo(u)}</TableCell>
                <TableCell>{botones(u)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Móvil */}
      <div className="md:hidden space-y-3">
        {usuarios.map((u) => (
          <div
            key={u.id}
            className={`rounded-lg border p-3 space-y-3 ${u.activo ? "" : "opacity-60"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium flex flex-wrap items-center gap-2">
                  {u.nombre} {etiquetas(u)}
                </div>
                <div className="text-xs text-muted-foreground break-all">{u.email}</div>
              </div>
              {interruptorActivo(u)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {selectorNivel(u)}
              {botones(u)}
            </div>
            <div className="text-xs text-muted-foreground">
              Tiendas: {textoTiendas(u)} · Último acceso:{" "}
              {u.ultimo_acceso ? fechaCorta(u.ultimo_acceso) : "nunca"}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SelectorTiendas({
  tiendas,
  seleccion,
  onCambio,
}: {
  tiendas: Tienda[];
  seleccion: string[];
  onCambio: (ids: string[]) => void;
}) {
  if (tiendas.length === 0)
    return <p className="text-sm text-muted-foreground">No hay tiendas dadas de alta.</p>;
  return (
    <div className="space-y-1">
      {tiendas.map((t) => (
        <label key={t.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={seleccion.includes(t.id)}
            onCheckedChange={(c) =>
              onCambio(c ? [...seleccion, t.id] : seleccion.filter((x) => x !== t.id))
            }
          />
          {t.nombre}
        </label>
      ))}
    </div>
  );
}

function AltaUsuario({
  abierto,
  onCerrar,
  tiendas,
  onEnlace,
}: {
  abierto: boolean;
  onCerrar: () => void;
  tiendas: Tienda[];
  onEnlace: (e: Enlace) => void;
}) {
  const qc = useQueryClient();
  const crear = useServerFn(crearUsuario);
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [nivel, setNivel] = useState<Nivel>("editor");
  const [modo, setModo] = useState<"contrasena" | "enlace">("contrasena");
  const [password, setPassword] = useState("");
  // Por defecto, todas: editor y visor «ven todo».
  const [seleccion, setSeleccion] = useState<string[] | null>(null);
  const tiendasElegidas = seleccion ?? tiendas.map((t) => t.id);

  const limpiar = () => {
    setEmail("");
    setNombre("");
    setNivel("editor");
    setModo("contrasena");
    setPassword("");
    setSeleccion(null);
  };

  const problema = impedimentoAlta({ email, nombre, password, modo });
  const m = useMutation({
    mutationFn: () =>
      crear({
        data: {
          email,
          nombre,
          nivel,
          modo,
          password: modo === "contrasena" ? password : "",
          tienda_ids: nivel === "admin" ? [] : tiendasElegidas,
          origen: window.location.origin,
        },
      }),
    onSuccess: (r) => {
      toast.success("Usuario creado");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      if (r.enlace) onEnlace({ email, enlace: r.enlace });
      limpiar();
      onCerrar();
    },
    onError: (e: Error) => avisarError(e),
  });

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>
            Entra con su correo. Elige qué puede hacer; se puede cambiar después.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="alta-nombre">Nombre</Label>
              <Input id="alta-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="alta-email">Correo</Label>
              <Input
                id="alta-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Nivel</Label>
            <RadioGroup value={nivel} onValueChange={(v) => setNivel(v as Nivel)}>
              {NIVELES.map((n) => (
                <label key={n} className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value={n} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{ETIQUETA_NIVEL[n]}</span>
                    <span className="block text-muted-foreground">{DESCRIPCION_NIVEL[n]}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Acceso</Label>
            <RadioGroup value={modo} onValueChange={(v) => setModo(v as typeof modo)}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="contrasena" /> Le pongo una contraseña inicial
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="enlace" /> Genero un enlace para que la elija él
              </label>
            </RadioGroup>
            {modo === "contrasena" ? (
              <Input
                type="password"
                placeholder="Al menos 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Al crearlo verás el enlace para copiarlo y mandárselo. Caduca en unas horas.
              </p>
            )}
          </div>

          {nivel !== "admin" && (
            <div className="space-y-2">
              <Label>Tiendas que ve</Label>
              <SelectorTiendas
                tiendas={tiendas}
                seleccion={tiendasElegidas}
                onCambio={setSeleccion}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            onClick={() => m.mutate()}
            disabled={!!problema || m.isPending}
            title={problema ?? undefined}
          >
            {m.isPending ? "Creando…" : "Crear usuario"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TiendasUsuario({
  usuario,
  tiendas,
  onCerrar,
}: {
  usuario: UsuarioListado | null;
  tiendas: Tienda[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const guardar = useServerFn(cambiarTiendasUsuario);
  const [seleccion, setSeleccion] = useState<string[] | null>(null);
  const actual = seleccion ?? usuario?.tienda_ids ?? [];
  const cerrar = () => {
    setSeleccion(null);
    onCerrar();
  };
  const m = useMutation({
    mutationFn: () => guardar({ data: { user_id: usuario!.id, tienda_ids: actual } }),
    onSuccess: () => {
      toast.success("Acceso a tiendas guardado");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      cerrar();
    },
    onError: (e: Error) => avisarError(e),
  });
  return (
    <Dialog open={!!usuario} onOpenChange={(o) => !o && cerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tiendas de {usuario?.nombre}</DialogTitle>
          <DialogDescription>Solo ve los datos de las tiendas marcadas.</DialogDescription>
        </DialogHeader>
        <SelectorTiendas tiendas={tiendas} seleccion={actual} onCambio={setSeleccion} />
        <DialogFooter>
          <Button variant="outline" onClick={cerrar}>
            Cancelar
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmarDesactivar({
  usuario,
  onCerrar,
}: {
  usuario: UsuarioListado | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const cambiar = useServerFn(cambiarActivoUsuario);
  const m = useMutation({
    mutationFn: () => cambiar({ data: { user_id: usuario!.id, activo: false } }),
    onSuccess: () => {
      toast.success("Usuario desactivado");
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      onCerrar();
    },
    onError: (e: Error) => avisarError(e),
  });
  return (
    <AlertDialog open={!!usuario} onOpenChange={(o) => !o && onCerrar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desactivar a {usuario?.nombre}?</AlertDialogTitle>
          <AlertDialogDescription>
            Deja de poder entrar, ver y cambiar nada desde ya. No se borra: lo que hizo sigue en la
            auditoría con su nombre, y se puede reactivar cuando quieras.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              m.mutate();
            }}
            disabled={m.isPending}
          >
            Desactivar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EnlaceDialog({ enlace, onCerrar }: { enlace: Enlace | null; onCerrar: () => void }) {
  return (
    <Dialog open={!!enlace} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enlace para {enlace?.email}</DialogTitle>
          <DialogDescription>
            Mándaselo. Al abrirlo elige su contraseña y entra. Sirve una sola vez y caduca en unas
            horas.
          </DialogDescription>
        </DialogHeader>
        <Input readOnly value={enlace?.enlace ?? ""} onFocus={(e) => e.currentTarget.select()} />
        <DialogFooter>
          <Button
            onClick={() => {
              if (!enlace) return;
              navigator.clipboard
                .writeText(enlace.enlace)
                .then(() => toast.success("Enlace copiado"))
                .catch(() => toast.error("No se ha podido copiar: selecciónalo y cópialo a mano"));
            }}
          >
            <Copy className="h-4 w-4" /> Copiar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
