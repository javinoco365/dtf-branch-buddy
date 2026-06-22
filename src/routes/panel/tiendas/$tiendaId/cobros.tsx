import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CobrosPendientes } from "@/components/CobrosPendientes";

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
          Facturas pendientes de cobro de esta tienda.
        </p>
      </div>
      <CobrosPendientes tiendaId={tiendaId} />
    </div>
  );
}
