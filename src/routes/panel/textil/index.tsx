import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Boxes, FileSpreadsheet, FileText, ShoppingCart, Users, Settings } from "lucide-react";
import { resumenTextilInicio } from "@/lib/textil.functions";
import { eur as fmtEUR } from "@/lib/format";

export const Route = createFileRoute("/panel/textil/")({
  head: () => ({ meta: [{ title: "Textil Personalizado · DTF Culture" }] }),
  component: TextilHome,
});

function TextilHome() {
  // Recuentos y pocas columnas, no la historia entera con sus líneas (ver
  // resumenTextilInicio). Clave propia: no comparte caché con las listas.
  const resumenFn = useServerFn(resumenTextilInicio);
  const resumen = useQuery({ queryKey: ["textil-inicio"], queryFn: () => resumenFn() });
  const r = resumen.data;

  const stockBajo = (r?.stock ?? []).filter(
    (s) => Number(s.cantidad) <= Number(s.cantidad_minima),
  ).length;
  const facturadoMes = (r?.facturas ?? [])
    .filter((f) => new Date(f.fecha).getMonth() === new Date().getMonth())
    .reduce((s: number, f) => s + Number(f.total), 0);

  const cards = [
    {
      to: "/panel/textil/stock",
      label: "Stock",
      icon: Boxes,
      value: r?.stock.length ?? 0,
      hint: `${stockBajo} bajo mínimo`,
    },
    {
      to: "/panel/textil/pedidos",
      label: "Pedidos",
      icon: ShoppingCart,
      value: r?.pedidos ?? 0,
    },
    {
      to: "/panel/textil/presupuestos",
      label: "Presupuestos",
      icon: FileSpreadsheet,
      value: r?.presupuestos ?? 0,
    },
    {
      to: "/panel/textil/facturas",
      label: "Facturas",
      icon: FileText,
      value: r?.facturas.length ?? 0,
      hint: `${fmtEUR(facturadoMes)} este mes`,
    },
    { to: "/panel/textil/clientes", label: "Clientes", icon: Users, value: r?.clientes ?? 0 },
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
