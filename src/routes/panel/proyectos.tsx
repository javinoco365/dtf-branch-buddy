import { createFileRoute } from "@tanstack/react-router";
import { ProyectosBoard } from "@/components/ProyectosBoard";

export const Route = createFileRoute("/panel/proyectos")({
  component: () => <ProyectosBoard showTienda />,
});
