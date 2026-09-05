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
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/panel" });
    });
    checkAdmin().then((r) => setNeedsBootstrap(!r.existe));
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
            {needsBootstrap === null
              ? "Cargando…"
              : needsBootstrap
                ? "Crea la cuenta del administrador inicial"
                : "Acceso restringido por invitación"}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            <Button type="submit" className="w-full" disabled={loading || needsBootstrap === null}>
              {loading
                ? "Procesando…"
                : needsBootstrap
                  ? "Crear administrador y entrar"
                  : "Iniciar sesión"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
