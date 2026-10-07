import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Euro,
  Gauge,
  Percent,
  Receipt,
  Ruler,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import { eur, metros } from "@/lib/format";
import { agruparPorRangos, variacion } from "@/dominio/kpis";
import { totalizar } from "@/dominio/facturacion";
import { tramosGrafica } from "@/dominio/periodos";
import {
  antiguedadPendientes,
  avisosGerencia,
  cifrasGerencia,
  cobradoPorTramos,
  resumenBanco,
  webSinPagar,
} from "@/dominio/gerencia";
import {
  destinoAviso,
  destinoCobros,
  destinoPedidos,
  destinoPendientes,
  textoAviso,
  VerDetalle,
  type DatosGerencia,
} from "./comun";

export function Resumen({ d }: { d: DatosGerencia }) {
  const frente = d.comparacion?.etiqueta;
  const c = useMemo(() => cifrasGerencia(d.ventas, d.costeMetro), [d.ventas, d.costeMetro]);
  const p = useMemo(
    () => cifrasGerencia(d.ventasPrevias, d.costeMetro),
    [d.ventasPrevias, d.costeMetro],
  );
  const cobrado = totalizar(d.cobros).cobrado;
  const cobradoPrev = totalizar(d.cobrosPrevios).cobrado;
  const pendienteHoy = d.pendientes.reduce((s, x) => s + Number(x.pendiente ?? 0), 0);
  const sinCostes = d.costeMetro === 0 && c.coste === 0;

  const avisos = useMemo(
    () =>
      avisosGerencia({
        tramos: antiguedadPendientes(d.pendientes, d.hoy),
        variacionVendido: frente ? variacion(c.total, p.total) : null,
        webSinPagar: webSinPagar(d.ventas),
        banco: d.banco ? resumenBanco(d.banco) : null,
      }),
    [d.pendientes, d.hoy, frente, c.total, p.total, d.ventas, d.banco],
  );

  const grafica = useMemo(() => {
    const { por, tramos } = tramosGrafica(d.rango);
    const vendido = agruparPorRangos(d.ventas, tramos);
    const cobradoT = cobradoPorTramos(d.cobros, tramos);
    return {
      por,
      datos: tramos.map((t, i) => ({
        tramo: t.etiqueta,
        Vendido: vendido[i].total,
        Cobrado: cobradoT[i],
      })),
    };
  }, [d.rango, d.ventas, d.cobros]);

  const pedidos = destinoPedidos(d.filtro, d.seleccion);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Vendido"
          explicacion="g_vendido"
          valor={eur(c.total)}
          frente={frente}
          delta={variacion(c.total, p.total)}
          icon={Euro}
          pie={<VerDetalle destino={pedidos} texto="Ver pedidos" />}
        />
        <TarjetaKpi
          titulo="Cobrado"
          explicacion="g_cobrado"
          valor={d.cobrosDisponibles ? eur(cobrado) : "—"}
          frente={frente}
          delta={d.cobrosDisponibles ? variacion(cobrado, cobradoPrev) : null}
          icon={Wallet}
          pie={<VerDetalle destino={destinoCobros(d.filtro, d.seleccion)} texto="Ver cobros" />}
        />
        <TarjetaKpi
          titulo="Pendiente de cobro"
          explicacion="g_pendiente"
          valor={d.pendientesDisponibles ? eur(pendienteHoy) : "—"}
          delta={null}
          icon={Clock}
          pie={
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="text-muted-foreground">
                Hoy · {d.pendientes.length} {d.pendientes.length === 1 ? "pedido" : "pedidos"}
              </span>
              <VerDetalle destino={destinoPendientes(d.filtro)} texto="Ver" />
            </span>
          }
        />
        <TarjetaKpi
          titulo={sinCostes ? "Margen" : "Margen estimado"}
          explicacion="g_margen"
          valor={sinCostes ? "—" : eur(c.margen)}
          frente={frente}
          delta={sinCostes ? null : variacion(c.margen, p.margen)}
          icon={Percent}
        />
        <TarjetaKpi
          titulo="Pedidos"
          explicacion="g_pedidos"
          valor={String(c.pedidos)}
          frente={frente}
          delta={variacion(c.pedidos, p.pedidos)}
          icon={Receipt}
          pie={<VerDetalle destino={pedidos} texto="Ver pedidos" />}
        />
        <TarjetaKpi
          titulo="Ticket medio"
          explicacion="g_ticket"
          valor={eur(c.ticket)}
          frente={frente}
          delta={variacion(c.ticket, p.ticket)}
          icon={ShoppingCart}
        />
        <TarjetaKpi
          titulo="Metros vendidos"
          explicacion="g_metros"
          valor={metros(c.metros)}
          frente={frente}
          delta={variacion(c.metros, p.metros)}
          icon={Ruler}
        />
        <TarjetaKpi
          titulo="€ por metro"
          explicacion="g_euro_metro"
          valor={c.metros > 0 ? eur(c.euroMetro) : "—"}
          frente={frente}
          delta={c.metros > 0 ? variacion(c.euroMetro, p.euroMetro) : null}
          icon={Gauge}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Avisos</CardTitle>
        </CardHeader>
        <CardContent>
          {avisos.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-status-completado" />
              Nada fuera de lo normal con estos filtros.
            </p>
          ) : (
            <ul className="space-y-2">
              {avisos.map((a) => (
                <li key={a.tipo} className="flex items-start gap-2 text-sm">
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      a.nivel === "alto" ? "text-status-cancelado" : "text-status-pendiente"
                    }`}
                  />
                  <span className="flex-1">
                    {textoAviso(a, frente)} <VerDetalle destino={destinoAviso(a, d)} texto="Ver" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {grafica.por === "dia" ? "Vendido y cobrado por día" : "Vendido y cobrado por mes"}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={grafica.datos}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="tramo" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                formatter={(v: number) => eur(v)}
                labelStyle={{ color: "var(--color-foreground)" }}
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Vendido" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Cobrado" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
