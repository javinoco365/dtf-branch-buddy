import { useMemo } from "react";
import { Factory, Hourglass, Timer, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import { Explicacion } from "@/components/Explicacion";
import { eur, metros, numero } from "@/lib/format";
import { useEnvios, useTaller } from "@/lib/gerencia";
import { variacion } from "@/dominio/kpis";
import { DEFINICIONES } from "@/dominio/definiciones";
import { aplicarAjustesVentas, filtrarVentas } from "@/dominio/gerencia";
import { pedidosPorEstado, tiemposEnvio, trabajoAbierto } from "@/dominio/produccion";
import { destinoPedidosEstado, type DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, Nota, VerDetalle } from "./comun";

export function Produccion({ d }: { d: DatosGerencia }) {
  const taller = useTaller();
  const envios = useEnvios(d.rango);
  const enviosPrevios = useEnvios(d.comparacion?.previo ?? d.rango);

  const abierto = useMemo(
    () =>
      trabajoAbierto(
        aplicarAjustesVentas(filtrarVentas(taller.data ?? [], d.filtro), d.ajustes),
        d.hoy,
      ),
    [taller.data, d.filtro, d.ajustes, d.hoy],
  );
  const tiempos = useMemo(
    () => tiemposEnvio(filtrarVentas(envios.data ?? [], d.filtro)),
    [envios.data, d.filtro],
  );
  const tiemposPrevios = useMemo(
    () =>
      d.comparacion && enviosPrevios.data
        ? tiemposEnvio(filtrarVentas(enviosPrevios.data, d.filtro))
        : null,
    [d.comparacion, enviosPrevios.data, d.filtro],
  );
  const porEstado = useMemo(() => pedidosPorEstado(d.ventas), [d.ventas]);

  if (taller.error) return <ErrorPestana que="los pedidos abiertos" error={taller.error} />;
  if (envios.error) return <ErrorPestana que="los envíos" error={envios.error} />;
  if (!taller.data || !envios.data) return <CargandoPestana />;

  const frente = d.comparacion?.etiqueta;
  const enTaller = abierto.reduce((s, f) => s + f.pedidos, 0);
  const metrosTaller = abierto.reduce((s, f) => s + f.metros, 0);
  const masAntiguo = abierto.reduce(
    (m, f) => (f.pedidos > 0 && f.diasMaximo >= (m?.diasMaximo ?? -1) ? f : m),
    null as (typeof abierto)[number] | null,
  );
  const soloTextil = d.filtro.canal === "textil";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="En el taller"
          explicacion="g_taller"
          valor={String(enTaller)}
          delta={null}
          icon={Factory}
          pie={
            <span className="text-muted-foreground">
              Hoy · {metros(metrosTaller)} por hacer o por enviar
            </span>
          }
        />
        <TarjetaKpi
          titulo="El que más espera"
          explicacion="g_espera"
          valor={masAntiguo ? `${masAntiguo.diasMaximo} días` : "—"}
          delta={null}
          icon={Hourglass}
          pie={
            masAntiguo ? (
              <span className="text-muted-foreground">En «{masAntiguo.etiqueta}»</span>
            ) : undefined
          }
        />
        <TarjetaKpi
          titulo="Días hasta el envío"
          explicacion="g_dias_envio"
          valor={tiempos ? `${numero(tiempos.media, 1)} días` : "—"}
          frente={frente}
          delta={tiempos && tiemposPrevios ? variacion(tiempos.media, tiemposPrevios.media) : null}
          deltaInverso
          icon={Timer}
          pie={
            tiempos ? (
              <span className="text-muted-foreground">
                La mitad, en {numero(tiempos.mediana, 1)} días o menos
              </span>
            ) : undefined
          }
        />
        <TarjetaKpi
          titulo="Enviados"
          explicacion="g_enviados"
          valor={soloTextil ? "—" : String(tiempos?.envios ?? 0)}
          frente={frente}
          delta={
            tiempos && tiemposPrevios ? variacion(tiempos.envios, tiemposPrevios.envios) : null
          }
          icon={Truck}
        />
      </div>

      {soloTextil && (
        <Nota>
          El textil no guarda cuándo se envía cada pedido: los tiempos de envío son solo de las
          tiendas.
        </Nota>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            Ahora en el taller
            <Explicacion titulo="Ahora en el taller" definicion={DEFINICIONES.g_taller} />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            A día de hoy, sea cual sea la fecha del pedido.
          </p>
        </CardHeader>
        <CardContent>
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Metros</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="text-right">Días de media</TableHead>
                <TableHead className="text-right">El más antiguo</TableHead>
                {/* Sin texto: en el móvil, el enlace va sin etiqueta delante. */}
                <TableHead aria-label="Ver pedidos" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {abierto.map((f) => (
                <TableRow key={f.estado}>
                  <TableCell className="font-medium">{f.etiqueta}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.pedidos}</TableCell>
                  <TableCell className="text-right tabular-nums">{metros(f.metros)}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(f.importe)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.pedidos ? `${numero(f.diasMedios, 1)} días` : "—"}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      f.diasMaximo > 7 ? "font-medium text-status-cancelado" : ""
                    }`}
                  >
                    {f.pedidos ? `${f.diasMaximo} días` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {f.pedidos > 0 && (
                      <VerDetalle destino={destinoPedidosEstado(d.filtro, f.estado)} texto="Ver" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pedidos del periodo, por estado</CardTitle>
            <p className="text-xs text-muted-foreground">
              Los pedidos con fecha en el periodo y el estado en que están hoy.
            </p>
          </CardHeader>
          <CardContent>
            {porEstado.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin pedidos en el periodo.</p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Pedidos</TableHead>
                    <TableHead className="text-right">Metros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porEstado.map((f) => (
                    <TableRow key={f.estado}>
                      <TableCell className="font-medium">{f.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.pedidos}</TableCell>
                      <TableCell className="text-right tabular-nums">{metros(f.metros)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              Cuánto se tarda en enviar
              <Explicacion
                titulo="Cuánto se tarda en enviar"
                definicion={DEFINICIONES.g_dias_envio}
              />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Pedidos de tienda enviados en el periodo, por días desde el pedido.
            </p>
          </CardHeader>
          <CardContent>
            {!tiempos ? (
              <p className="text-sm text-muted-foreground">
                Ningún pedido con seguimiento en el periodo.
              </p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tiempo</TableHead>
                    <TableHead className="text-right">Envíos</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiempos.tramos.map((t) => (
                    <TableRow key={t.clave}>
                      <TableCell className="font-medium">{t.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.envios}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numero((t.envios / tiempos.envios) * 100, 1)} %
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
