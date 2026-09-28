import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PantallaCobrosPendientes } from "@/components/cobros/PantallaCobrosPendientes";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/cobros")({
  component: CobrosTienda,
});

function CobrosTienda() {
  const { tiendaId } = Route.useParams();
  const { data: tienda } = useQuery({
    queryKey: ["tienda-nombre", tiendaId],
    queryFn: async () =>
      (await supabase.from("tiendas").select("nombre").eq("id", tiendaId).maybeSingle()).data,
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Cobros pendientes · {tienda?.nombre ?? "Tienda"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Lo que queda por cobrar de los pedidos de esta tienda, y sus facturas sin cobrar.
        </p>
      </div>
      <PantallaCobrosPendientes tiendaId={tiendaId} />
    </div>
  );
}
