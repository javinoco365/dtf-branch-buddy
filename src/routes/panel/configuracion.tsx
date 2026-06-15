import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Settings as SettingsIcon, Building2 } from "lucide-react";

export const Route = createFileRoute("/panel/configuracion")({
  head: () => ({ meta: [{ title: "Configuración general · CRM DTF" }] }),
  component: ConfiguracionPage,
});

function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración general</h1>
        <p className="text-muted-foreground">Ajustes globales del sistema</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ConfigCard to="/panel/usuarios" icon={Users} title="Usuarios"
          desc="Invita y gestiona los usuarios del sistema." />
        <ConfigCard to="/panel/tiendas" icon={Building2} title="Gestión de tiendas"
          desc="Alta y edición de webs WooCommerce y sus credenciales." />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="h-4 w-4" /> Próximamente
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Parámetros fiscales globales, series por defecto y preferencias del CRM.
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigCard({ to, icon: Icon, title, desc }: { to: string; icon: any; title: string; desc: string }) {
  return (
    <Link to={to as any} className="block">
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-5 flex items-start gap-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground">{desc}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
