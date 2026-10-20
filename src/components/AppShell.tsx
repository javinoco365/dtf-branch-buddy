import { type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { MARCA_DESCRIPCION, MARCA_NOMBRE } from "@/components/Marca";
import { BotonTema } from "@/components/BotonTema";
import { usePermisos } from "@/hooks/use-permisos";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card px-4 sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground hidden md:inline">
                {MARCA_NOMBRE} · {MARCA_DESCRIPCION}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
              <BotonTema />
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/auth" });
                }}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Salir
              </Button>
            </div>
          </header>
          <AvisoSoloLectura />
          <main className="flex-1 p-4 md:p-6 max-w-full overflow-x-hidden">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Para un visor (o un usuario sin nivel): que sepa por qué no puede cambiar nada. */
function AvisoSoloLectura() {
  const { escribir, nivel, cargando } = usePermisos();
  if (cargando || escribir) return null;
  return (
    <div className="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
      {nivel === "visor"
        ? "Tienes acceso de solo lectura: puedes ver todo, pero no crear, cambiar ni borrar."
        : "Tu usuario no tiene nivel de acceso o está desactivado: no puedes cambiar datos. Habla con un administrador."}
    </div>
  );
}
