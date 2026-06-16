import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/panel/configuracion")({
  head: () => ({ meta: [{ title: "Configuración general · CRM DTF" }] }),
  component: ConfiguracionPage,
});

function ConfiguracionPage() {
  const { isAdmin } = useAuth();
  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ajustes generales</h1>
        <p className="text-sm text-muted-foreground">
          Configura los parámetros globales que afectan al funcionamiento del CRM.
        </p>
      </div>

      <Section title="Configuración" desc="Parámetros globales del sistema">
        {isAdmin && (
          <ConfigCard
            to="/panel/configuracion-empresa"
            icon={Building2}
            title="Datos de la empresa"
            desc="Razón social, CIF, dirección, contacto fiscal y costes de producción por metro."
            badge="Admin"
          />
        )}
        {isAdmin && (
          <ConfigCard
            to="/panel/usuarios"
            icon={Users}
            title="Usuarios y permisos"
            desc="Invita usuarios, asigna roles y vincúlalos a las tiendas a las que deben acceder."
            badge="Admin"
          />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function ConfigCard({
  to,
  icon: Icon,
  title,
  desc,
  badge,
}: {
  to: string;
  icon: any;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <Link to={to as any} className="block">
      <Card className="hover:border-primary/60 transition-colors h-full">
        <CardContent className="p-5 flex items-start gap-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="font-semibold">{title}</div>
              {badge && <Badge variant="secondary" className="text-[10px] py-0">{badge}</Badge>}
            </div>
            <div className="text-sm text-muted-foreground">{desc}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

