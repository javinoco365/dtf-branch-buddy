import { createFileRoute } from "@tanstack/react-router";
import { PantallaProductos } from "@/components/productos/PantallaProductos";

export const Route = createFileRoute("/panel/productos")({
  head: () => ({ meta: [{ title: "Productos generales · DTF Culture" }] }),
  component: () => <PantallaProductos />,
});
