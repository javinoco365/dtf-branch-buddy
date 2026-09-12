import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { adminExiste, bootstrapPrimerAdmin } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Marca, MARCA_NOMBRE } from "@/components/Marca";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Acceso · DTF Culture" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(adminExiste);
  const bootstrap = useServerFn(bootstrapPrimerAdmin);
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  // Si la comprobación falla, no se sabe si hace falta el alta del primer
  // administrador o no: mostrar el formulario normal sería un acceso
  // bloqueado sin explicación, y mostrar el de alta ofrecería crear un
  // administrador de más sobre un sistema que puede que ya tenga los suyos.
  // Ninguna de las dos cosas es segura, así que se enseña el error y se deja
  // reintentar.
  const [errorComprobacion, setErrorComprobacion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  function comprobarAdmin() {
    setErrorComprobacion(null);
    setNeedsBootstrap(null);
    checkAdmin()
      .then((r) => setNeedsBootstrap(!r.existe))
      .catch((err: Error) => setErrorComprobacion(err.message || "No se pudo comprobar el acceso"));
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/panel" });
    });
    checkAdmin()
      .then((r) => setNeedsBootstrap(!r.existe))
      .catch((err: Error) => setErrorComprobacion(err.message || "No se pudo comprobar el acceso"));
  }, [navigate, checkAdmin]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (needsBootstrap) {
        await bootstrap({ data: { email, password, full_name: fullName } });
        toast.success("Administrador creado. Iniciando sesión…");
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Bienvenido");
      navigate({ to: "/panel" });
    } catch (err: any) {
      toast.error(err.message ?? "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex justify-center">
            <Marca tamano="lg" soloIcono />
          </div>
          <CardTitle className="text-2xl">{MARCA_NOMBRE}</CardTitle>
          <CardDescription>
            {errorComprobacion
              ? "No se ha podido comprobar el acceso"
              : needsBootstrap === null
                ? "Cargando…"
                : needsBootstrap
                  ? "Crea la cuenta del administrador inicial"
                  : "Acceso restringido por invitación"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorComprobacion ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{errorComprobacion}</p>
              <p className="text-sm text-muted-foreground">
                No se sabe si ya hay administradores dados de alta, así que no se enseña ni el
                acceso ni el alta del primero: lo uno o lo otro podría ser un error. Reintenta en un
                momento.
              </p>
              <Button type="button" className="w-full" onClick={comprobarAdmin}>
                Reintentar
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {needsBootstrap && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Nombre completo</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || needsBootstrap === null}
              >
                {loading
                  ? "Procesando…"
                  : needsBootstrap
                    ? "Crear administrador y entrar"
                    : "Iniciar sesión"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
