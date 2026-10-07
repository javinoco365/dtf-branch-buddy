import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Euro,
  Gauge,
  PiggyBank,
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
import { Progress } from "@/components/ui/progress";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import { Explicacion } from "@/components/Explicacion";
import { eur, metros } from "@/lib/format";
import { DEFINICIONES } from "@/dominio/definiciones";
import { agruparPorRangos, variacion } from "@/dominio/kpis";
import { totalizar } from "@/dominio/facturacion";
import { tramosGrafica } from "@/dominio/periodos";
import {
  antiguedadPendientes,
  avanceObjetivo,
  avisosGerencia,
  beneficioEstimado,
  cifrasGerencia,
  cobradoPorTramos,
  objetivoDelRango,
  parteTranscurrida,
  resumenBanco,
  type CifrasGerencia,
} from "@/dominio/gerencia";
import {
  DESTINO_AJUSTES,
  destinoAviso,
  destinoCobros,
  destinoPedidos,
  destinoPendientes,
  textoAviso,
  type DatosGerencia,
} from "./destinos";
import { Nota, VerDetalle } from "./comun";

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
        webSinPagar: { ...d.webSinPagar, cuentan: d.ajustes.web_sin_pagar_cuenta },
        banco: d.banco ? resumenBanco(d.banco) : null,
      }),
    [d.pendientes, d.hoy, frente, c.total, p.total, d.webSinPagar, d.ajustes, d.banco],
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

      {/* En B no hay costes fijos ni objetivos: son de la empresa documentada. */}
      {d.grupo !== "b" && <BeneficioYObjetivos d={d} c={c} p={p} sinCostes={sinCostes} />}

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

/**
 * Lo que se configura en Ajustes: el beneficio tras los gastos fijos y cómo
 * se va frente al objetivo. Son cifras de toda la empresa, así que con un
 * filtro de tienda o canal no se enseñan: compararían una parte con el todo.
 */
function BeneficioYObjetivos({
  d,
  c,
  p,
  sinCostes,
}: {
  d: DatosGerencia;
  c: CifrasGerencia;
  p: CifrasGerencia;
  sinCostes: boolean;
}) {
  const frente = d.comparacion?.etiqueta;
  const objetivo = objetivoDelRango(d.objetivos, d.rango);
  const hayGastos = d.gastosDelGrupo.length > 0;
  const hayObjetivo = objetivo.vendido !== null || objetivo.metros !== null;
  const sinFiltros = d.filtro.tienda === "todas" && d.filtro.canal === "todos";

  if (!hayGastos && !hayObjetivo) {
    return (
      <Nota>
        Pon los gastos fijos y los objetivos del mes en Ajustes y aquí verás el beneficio estimado y
        cómo vas frente al objetivo. <VerDetalle destino={DESTINO_AJUSTES} texto="Ir a Ajustes" />
      </Nota>
    );
  }
  if (!sinFiltros) {
    return (
      <Nota>
        El beneficio estimado y los objetivos son de toda la empresa: se ven con «Todas las tiendas»
        y «Todos los canales».
      </Nota>
    );
  }

  const transcurrido = parteTranscurrida(d.rango, d.hoy);
  const actual = beneficioEstimado(c.margen, d.gastosDelGrupo, d.rango, d.hoy);
  const previo = d.comparacion
    ? beneficioEstimado(p.margen, d.gastosDelGrupo, d.comparacion.previo)
    : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {hayGastos && (
        <TarjetaKpi
          titulo="Beneficio estimado"
          explicacion="g_beneficio"
          valor={sinCostes ? "—" : eur(actual.beneficio)}
          color={!sinCostes && actual.beneficio < 0 ? "destructive" : "primary"}
          frente={frente}
          delta={
            sinCostes || !previo || previo.beneficio <= 0
              ? null
              : variacion(actual.beneficio, previo.beneficio)
          }
          icon={PiggyBank}
          pie={
            <span className="text-muted-foreground">
              {sinCostes
                ? "Falta el coste por metro para calcular el margen."
                : `Margen ${eur(c.margen)} − gastos fijos ${eur(actual.gastos)}${actual.hastaHoy ? " hasta hoy" : ""}`}
            </span>
          }
        />
      )}
      {objetivo.vendido !== null && (
        <TarjetaObjetivo
          titulo="Objetivo de ventas"
          clave="g_objetivo_vendido"
          conseguido={c.total}
          objetivo={objetivo.vendido}
          transcurrido={transcurrido}
          formato={eur}
        />
      )}
      {objetivo.metros !== null && (
        <TarjetaObjetivo
          titulo="Objetivo de metros"
          clave="g_objetivo_metros"
          conseguido={c.metros}
          objetivo={objetivo.metros}
          transcurrido={transcurrido}
          formato={metros}
        />
      )}
    </div>
  );
}

function TarjetaObjetivo({
  titulo,
  clave,
  conseguido,
  objetivo,
  transcurrido,
  formato,
}: {
  titulo: string;
  clave: "g_objetivo_vendido" | "g_objetivo_metros";
  conseguido: number;
  objetivo: number;
  transcurrido: number;
  formato: (n: number) => string;
}) {
  const a = avanceObjetivo(conseguido, objetivo, transcurrido);
  if (!a) return null;
  const terminado = transcurrido >= 1;
  const delante = a.diferencia >= 0;
  const ritmo = terminado
    ? delante
      ? `Superado en ${formato(a.diferencia)}`
      : `Faltaron ${formato(-a.diferencia)}`
    : delante
      ? `A este ritmo, ${formato(a.diferencia)} por delante`
      : `A este ritmo, ${formato(-a.diferencia)} por detrás`;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span>{titulo}</span>
          <Explicacion titulo={titulo} definicion={DEFINICIONES[clave]} />
        </div>
        <div className="mt-3 text-3xl font-bold tracking-tight">
          {a.porcentaje.toLocaleString("es-ES")} %
        </div>
        <Progress value={Math.min(100, a.porcentaje)} className="mt-3" />
        <p className="mt-2 text-xs text-muted-foreground">
          {formato(conseguido)} de {formato(objetivo)}
        </p>
        <p
          className={`mt-1 text-xs font-medium ${
            delante ? "text-status-completado" : "text-status-pendiente"
          }`}
        >
          {ritmo}
        </p>
      </CardContent>
    </Card>
  );
}
