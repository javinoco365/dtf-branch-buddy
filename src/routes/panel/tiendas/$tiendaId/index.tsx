import { createFileRoute } from "@tanstack/react-router";
import { tabla } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { eur, metros, numero } from "@/lib/format";
import { usePedidosPeriodo } from "@/lib/periodo";
import { calcularKpis, costeVariable, variacion } from "@/dominio/kpis";
import { compararCon, rangoDe } from "@/dominio/periodos";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { ShoppingCart, Euro, Ruler, FileText, Receipt, Package, Percent } from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/")({
  component: Dashboard,
});

function Dashboard() {
  const { tiendaId } = Route.useParams();
  const { data: tiendas } = useTiendasMenu();
  const nombreTienda = tiendas?.find((t) => t.id === tiendaId)?.nombre;
  const { data } = useQuery({
    queryKey: ["tienda-dashboard", tiendaId],
    queryFn: async () => {
      const [pedidos, facturas, empresa] = await Promise.all([
        supabase
          .from("pedidos")
          .select("total, metros_total, fecha_pedido, estado")
          .eq("tienda_id", tiendaId),
        supabase.from("facturas").select("total, estado").eq("tienda_id", tiendaId),
        tabla(supabase, "empresas")
          .select("coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro")
          .eq("activa", true)
          .order("created_at")
          .limit(1)
          .maybeSingle(),
      ]);
      return { pedidos: pedidos.data ?? [], facturas: facturas.data ?? [], empresa: empresa.data };
    },
  });
  const pedidos = data?.pedidos ?? [];
  const facturas = data?.facturas ?? [];
  const eg = data?.empresa;
  const costeMetro =
    Number(eg?.coste_consumibles_metro ?? 0) +
    Number(eg?.coste_packaging_metro ?? 0) +
    Number(eg?.coste_electricidad_metro ?? 0);
  const fact = facturas
    .filter((f) => f.estado !== "anulada" && f.estado !== "borrador")
    .reduce((s, f) => s + Number(f.total), 0);
  const mts = pedidos.reduce((s, p) => s + Number(p.metros_total ?? 0), 0);

  // El mes en curso con las mismas cuentas que el dashboard (devoluciones
  // restadas, coste congelado por pedido) y comparado con el mismo trozo del
  // mes anterior: el día 5, contra del 1 al 5 del mes pasado.
  const hoy = useMemo(() => new Date(), []);
  const mes = useMemo(() => rangoDe({ tipo: "mes", ref: hoy })!, [hoy]);
  const comparacion = useMemo(
    () => compararCon({ tipo: "mes", ref: hoy }, "anterior", hoy)!,
    [hoy],
  );
  const consultaMes = usePedidosPeriodo({ ...mes, tiendaId });
  const consultaAnt = usePedidosPeriodo({ ...comparacion.previo, tiendaId });
  const pedidosMes = useMemo(() => consultaMes.data ?? [], [consultaMes.data]);
  const k = useMemo(() => calcularKpis(pedidosMes), [pedidosMes]);
  const kAnt = useMemo(() => calcularKpis(consultaAnt.data ?? []), [consultaAnt.data]);

  const delta = variacion(k.total, kAnt.total);
  // El envío no entra: la bruta ya va sin él, y lo que se cobra al cliente es
  // lo que se paga a la agencia.
  const costeMes = costeVariable(pedidosMes, costeMetro);
  const margenMes = k.bruta - costeMes.produccion;
  const margenPct = k.bruta > 0 ? (margenMes / k.bruta) * 100 : null;
  const sinCostes = costeMetro === 0 && costeMes.produccion === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Resumen{nombreTienda ? ` · ${nombreTienda}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          El mes en curso, frente al mismo trozo del mes anterior, y los totales de la tienda.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Este mes</h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          <TarjetaKpi
            titulo="Vendido"
            explicacion="vendido"
            valor={eur(k.total)}
            frente={comparacion.etiqueta}
            delta={delta}
            icon={Euro}
          />
          <TarjetaKpi
            titulo="Pedidos"
            explicacion="pedidos"
            valor={String(k.pedidos)}
            delta={null}
            icon={Receipt}
            pie={<span className="text-muted-foreground">Ticket medio {eur(k.ticket)}</span>}
          />
          <TarjetaKpi
            titulo="Metros"
            explicacion="metros"
            valor={metros(k.metros)}
            delta={null}
            icon={Package}
          />
          <TarjetaKpi
            titulo="Margen estimado"
            explicacion="margen"
            valor={sinCostes ? "—" : eur(margenMes)}
            delta={null}
            icon={Percent}
            color={!sinCostes && margenMes < 0 ? "destructive" : "primary"}
            pie={
              <span className="text-muted-foreground">
                {sinCostes
                  ? "Configura los costes en Ajustes › Datos de la empresa"
                  : `Bruta ${eur(k.bruta)} − producción ${eur(costeMes.produccion)}${
                      margenPct !== null ? ` · ${numero(margenPct, 1)} % de la bruta` : ""
                    }`}
              </span>
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Desde el principio</h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          <TarjetaKpi
            titulo="Pedidos"
            valor={String(pedidos.length)}
            delta={null}
            icon={ShoppingCart}
          />
          <TarjetaKpi titulo="Metros" valor={metros(mts)} delta={null} icon={Ruler} />
          <TarjetaKpi titulo="Facturado" valor={eur(fact)} delta={null} icon={Euro} />
          <TarjetaKpi
            titulo="Facturas"
            valor={String(facturas.length)}
            delta={null}
            icon={FileText}
          />
        </div>
      </section>
    </div>
  );
}
