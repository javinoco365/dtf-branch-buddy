import { createFileRoute } from "@tanstack/react-router";
import { PantallaClientes } from "@/components/clientes/PantallaClientes";

export const Route = createFileRoute("/panel/clientes")({
  head: () => ({ meta: [{ title: "Clientes · DTF Culture" }] }),
  component: () => <PantallaClientes contexto={{ tipo: "general" }} />,
});
