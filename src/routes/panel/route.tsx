import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/panel")({
  ssr: false,
  // `getSession()` lee la sesión guardada en el navegador (y renueva el token
  // si ha caducado) sin preguntar a Supabase en cada clic: `getUser()` hacía un
  // viaje a /auth/v1/user por cada navegación y cada cambio de filtro antes de
  // empezar a pintar. Un usuario revocado con el token aún vigente (≤ 1 h)
  // vería el marco, pero no datos: cada server function valida el token y
  // PostgREST aplica la RLS.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
    return { user: data.session.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
