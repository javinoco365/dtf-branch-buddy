import { createFileRoute } from "@tanstack/react-router";
import { ProyectosBoard } from "@/components/ProyectosBoard";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/proyectos")({
  component: Page,
});

function Page() {
  const { tiendaId } = Route.useParams();
  return <ProyectosBoard tiendaId={tiendaId} />;
}