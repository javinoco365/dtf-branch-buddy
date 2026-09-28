import { createFileRoute } from "@tanstack/react-router";
import { PantallaClientes } from "@/components/clientes/PantallaClientes";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/clientes")({
  component: ClientesTienda,
});

function ClientesTienda() {
  const { tiendaId } = Route.useParams();
  return <PantallaClientes key={tiendaId} contexto={{ tipo: "tienda", tiendaId }} />;
}
