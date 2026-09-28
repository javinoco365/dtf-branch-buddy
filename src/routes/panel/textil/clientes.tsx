import { createFileRoute } from "@tanstack/react-router";
import { PantallaClientes } from "@/components/clientes/PantallaClientes";

export const Route = createFileRoute("/panel/textil/clientes")({
  head: () => ({ meta: [{ title: "Clientes textil · DTF Culture" }] }),
  component: () => <PantallaClientes contexto={{ tipo: "textil" }} />,
});
