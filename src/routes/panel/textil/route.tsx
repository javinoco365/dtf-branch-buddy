import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/panel/textil")({
  component: () => <Outlet />,
});