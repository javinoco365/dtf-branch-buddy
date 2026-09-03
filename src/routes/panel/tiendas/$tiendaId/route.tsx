import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/panel/tiendas/$tiendaId")({
  component: TiendaLayout,
});

/**
 * El marco de las pantallas de una tienda.
 *
 * Aquí había una cabecera con el nombre de la tienda y su URL. Sobraba: cada
 * pantalla ya lleva su propio título con el nombre —«Pedidos · DTF Culture»— y
 * el menú lateral dice en cuál estás, así que era la misma información dos
 * veces y la URL de la web no la mira nadie desde el CRM.
 */
function TiendaLayout() {
  return (
    <div className="space-y-4">
      <Outlet />
    </div>
  );
}
