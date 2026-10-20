import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Marca, MARCA_NOMBRE } from "@/components/Marca";

// A esta página llevan los enlaces que genera un administrador en Ajustes >
// Usuarios (invitación o «poner contraseña»). Supabase deja la sesión en la
// dirección; aquí se elige la contraseña y se entra.
export const Route = createFileRoute("/clave")({
  ssr: false,
  head: () => ({ meta: [{ title: "Elige tu contraseña · DTF Culture" }] }),
  component: ElegirClave,
});

function ElegirClave() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<"comprobando" | "listo" | "sin_enlace">("comprobando");
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    // supabase-js lee la sesión del enlace al cargar; puede llegar un poco
    // después que el primer render.
    let hecho = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s && !hecho) {
        hecho = true;
        setEstado("listo");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        hecho = true;
        setEstado("listo");
      }
    });
    const espera = setTimeout(() => {
      if (!hecho) setEstado("sin_enlace");
    }, 4000);
    return () => {
      clearTimeout(espera);
      sub.subscription.unsubscribe();
    };
  }, []);

  const problema =
    clave.length < 8
      ? "Al menos 8 caracteres"
      : clave !== repetida
        ? "Las dos contraseñas no coinciden"
        : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (problema) return;
    setGuardando(true);
    const { error } = await supabase.auth.updateUser({ password: clave });
    setGuardando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contraseña guardada");
    navigate({ to: "/panel" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex justify-center">
            <Marca tamano="lg" soloIcono />
          </div>
          <CardTitle className="text-2xl">{MARCA_NOMBRE}</CardTitle>
          <CardDescription>Elige tu contraseña</CardDescription>
        </CardHeader>
        <CardContent>
          {estado === "comprobando" ? (
            <p className="text-sm text-muted-foreground text-center">Comprobando el enlace…</p>
          ) : estado === "sin_enlace" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                El enlace ha caducado o ya se ha usado. Pide otro a un administrador.
              </p>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => navigate({ to: "/auth" })}
              >
                Ir al acceso
              </Button>
            </div>
          ) : (
            <form onSubmit={guardar} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="clave">Contraseña nueva</Label>
                <Input
                  id="clave"
                  type="password"
                  autoComplete="new-password"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clave2">Repítela</Label>
                <Input
                  id="clave2"
                  type="password"
                  autoComplete="new-password"
                  value={repetida}
                  onChange={(e) => setRepetida(e.target.value)}
                />
              </div>
              {clave && problema && <p className="text-xs text-muted-foreground">{problema}</p>}
              <Button type="submit" className="w-full" disabled={!!problema || guardando}>
                {guardando ? "Guardando…" : "Guardar y entrar"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
