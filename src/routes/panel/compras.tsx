import { createFileRoute } from "@tanstack/react-router";
import { PaginaCompras } from "@/components/compras/PaginaCompras";

export const Route = createFileRoute("/panel/compras")({
  head: () => ({ meta: [{ title: "Facturas de compra · DTF Culture" }] }),
  component: () => <PaginaCompras modo="general" />,
});
