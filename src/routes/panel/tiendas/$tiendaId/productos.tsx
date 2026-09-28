import { createFileRoute } from "@tanstack/react-router";
import { PantallaProductos } from "@/components/productos/PantallaProductos";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/productos")({
  component: ProductosTienda,
});

function ProductosTienda() {
  const { tiendaId } = Route.useParams();
  return <PantallaProductos tiendaId={tiendaId} />;
}
