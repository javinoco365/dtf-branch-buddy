import { createFileRoute } from "@tanstack/react-router";
import { PaginaCompras } from "@/components/compras/PaginaCompras";

export const Route = createFileRoute("/panel/textil/compras")({
  head: () => ({ meta: [{ title: "Compras · DTF Culture" }] }),
  component: () => <PaginaCompras modo="textil" />,
});
