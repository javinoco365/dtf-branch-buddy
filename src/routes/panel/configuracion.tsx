import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Building2,
  Receipt,
  Wallet,
  ShoppingCart,
  CalendarClock,
  ShieldCheck,
  Truck,
  FileText,
  RefreshCw,
  LayoutDashboard,
} from "lucide-react";
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
          Punto único de control: tiendas, usuarios, facturación, sincronización y seguridad.
        </p>
      </div>

      <Section title="Sistema" desc="Gestión global del CRM">
        {isAdmin && (
          <ConfigCard
            to="/panel/tiendas"
            icon={Building2}
            title="Gestión de tiendas"
            desc="Alta de nuevas tiendas con asistente completo (datos fiscales, facturación y WooCommerce) y edición de las existentes."
            badge="Admin"
          />
        )}
        {isAdmin && (
          <ConfigCard
            to="/panel/usuarios"
            icon={Users}
            title="Usuarios y permisos"
            desc="Invita usuarios, asigna roles (admin / usuario) y vincúlalos a las tiendas a las que deben acceder."
            badge="Admin"
          />
        )}
        <ConfigCard
          to="/panel"
          icon={LayoutDashboard}
          title="Dashboard global"
          desc="Visión consolidada de pedidos, cobros y proyectos de todas las tiendas accesibles."
        />
      </Section>

      <Section title="Operativa diaria" desc="Vistas consolidadas de todas las tiendas">
        <ConfigCard
          to="/panel/pedidos"
          icon={ShoppingCart}
          title="Pedidos consolidados"
          desc="Listado unificado de pedidos importados desde WooCommerce y creados manualmente."
        />
        <ConfigCard
          to="/panel/cobros"
          icon={Wallet}
          title="Cobros pendientes"
          desc="Facturas emitidas pendientes de pago y deuda total por cliente."
        />
        <ConfigCard
          to="/panel/proyectos"
          icon={CalendarClock}
          title="Próximos proyectos"
          desc="Tablero de proyectos con fechas de entrega y estado."
        />
        <ConfigCard
          to="/panel/facturacion-global"
          icon={Receipt}
          title="Facturación consolidada"
          desc="Agregado de facturación de todas las tiendas accesibles, por periodo."
        />
      </Section>

      <Section title="Por tienda" desc="Configuración específica de cada web">
        <InfoCard
          icon={Building2}
          title="Ajustes por tienda"
          desc="Entra en una tienda desde la barra lateral y abre Ajustes para configurar WooCommerce, Mi empresa, Facturación y Seguimiento."
        />
        <InfoCard
          icon={RefreshCw}
          title="Sincronización WooCommerce"
          desc="Importa productos, clientes, pedidos y devoluciones desde la REST API. Las credenciales se cifran y solo se acceden desde el servidor."
        />
        <InfoCard
          icon={FileText}
          title="Facturas en PDF"
          desc="Generación de PDF en el servidor y subida al bucket privado `facturas` con URL firmada por tienda y factura."
        />
        <InfoCard
          icon={Truck}
          title="Seguimiento de envíos"
          desc="Tabla y UI preparadas como placeholder hasta definir transportistas."
          badge="Próximamente"
        />
      </Section>

      <Section title="Seguridad" desc="Recordatorios de protección de datos">
        <InfoCard
          icon={ShieldCheck}
          title="RLS estricta"
          desc="Todas las tablas filtran por tiendas del usuario mediante `is_tienda_member`. Los administradores ven todas las tiendas."
        />
        <InfoCard
          icon={ShieldCheck}
          title="Credenciales WooCommerce"
          desc="Almacenadas cifradas en el servidor. En la UI solo se muestran enmascaradas (ck_xxx…)."
        />
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

function InfoCard({
  icon: Icon,
  title,
  desc,
  badge,
}: {
  icon: any;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
          {badge && <Badge variant="outline" className="text-[10px] py-0">{badge}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>{desc}</CardDescription>
      </CardContent>
    </Card>
  );
}
