import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { FormularioSmtp } from "@/components/FormularioSmtp";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/panel/configuracion-correo")({
  head: () => ({ meta: [{ title: "Servidor de correo · DTF Culture" }] }),
  component: CorreoPage,
});

function CorreoPage() {
  const { isAdmin } = useAuth();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Servidor de correo</h1>
        <p className="text-sm text-muted-foreground">
          Por aquí salen los avisos a los clientes. Cada tienda pone su remitente en sus ajustes; el
          servidor es este salvo que una tienda tenga el suyo.
        </p>
      </div>

      {isAdmin ? (
        <FormularioSmtp tiendaId={null} />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Solo un administrador puede configurar el correo.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
