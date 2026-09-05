import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Boxes, FileSpreadsheet, FileText, ShoppingCart, Users, Settings } from "lucide-react";
import {
  listStock,
  listTextilPedidos,
  listPresupuestos,
  listTextilFacturas,
  listTextilClientes,
} from "@/lib/textil.functions";
import { eur as fmtEUR } from "@/lib/format";

export const Route = createFileRoute("/panel/textil/")({
  head: () => ({ meta: [{ title: "Textil Personalizado · DTF Culture" }] }),
  component: TextilHome,
});

function TextilHome() {
  const listStockFn = useServerFn(listStock);
  const listPedidosFn = useServerFn(listTextilPedidos);
  const listPresFn = useServerFn(listPresupuestos);
  const listFacFn = useServerFn(listTextilFacturas);
  const listCliFn = useServerFn(listTextilClientes);
  const stock = useQuery({ queryKey: ["textil-stock"], queryFn: () => listStockFn() });
  const pedidos = useQuery({ queryKey: ["textil-pedidos"], queryFn: () => listPedidosFn() });
  const pres = useQuery({ queryKey: ["textil-presupuestos"], queryFn: () => listPresFn() });
  const fac = useQuery({ queryKey: ["textil-facturas"], queryFn: () => listFacFn() });
  const cli = useQuery({ queryKey: ["textil-clientes"], queryFn: () => listCliFn() });

  const stockBajo = (stock.data ?? []).filter(
    (s: any) => Number(s.cantidad) <= Number(s.cantidad_minima),
  ).length;
  const facturadoMes = (fac.data ?? [])
    .filter((f: any) => new Date(f.fecha).getMonth() === new Date().getMonth())
    .reduce((s: number, f: any) => s + Number(f.total), 0);

  const cards = [
    {
      to: "/panel/textil/stock",
      label: "Stock",
      icon: Boxes,
      value: stock.data?.length ?? 0,
      hint: `${stockBajo} bajo mínimo`,
    },
    {
      to: "/panel/textil/pedidos",
      label: "Pedidos",
      icon: ShoppingCart,
      value: pedidos.data?.length ?? 0,
    },
    {
      to: "/panel/textil/presupuestos",
      label: "Presupuestos",
      icon: FileSpreadsheet,
      value: pres.data?.length ?? 0,
    },
    {
      to: "/panel/textil/facturas",
      label: "Facturas",
      icon: FileText,
      value: fac.data?.length ?? 0,
      hint: `${fmtEUR(facturadoMes)} este mes`,
    },
    { to: "/panel/textil/clientes", label: "Clientes", icon: Users, value: cli.data?.length ?? 0 },
    {
      to: "/panel/textil/ajustes",
      label: "Ajustes",
      icon: Settings,
      value: "",
      hint: "Marcas comerciales",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Textil Personalizado</h1>
        <p className="text-sm text-muted-foreground">
          Módulo independiente para tu línea de textil (fuera de las tiendas WooCommerce).
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.to} to={c.to as any} className="block">
            <Card className="hover:border-primary/60 transition-colors">
              <CardContent className="p-5 flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <c.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">{c.label}</div>
                  {c.value !== "" && <div className="text-2xl font-bold">{c.value}</div>}
                  {c.hint && <div className="text-xs text-muted-foreground">{c.hint}</div>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
