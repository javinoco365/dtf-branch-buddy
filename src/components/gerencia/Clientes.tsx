import { useMemo } from "react";
import { Repeat, UserPlus, Users, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { eur, fechaCorta, numero } from "@/lib/format";
import { useHistorialClientes } from "@/lib/gerencia";
import { variacion } from "@/dominio/kpis";
import { DEFINICIONES } from "@/dominio/definiciones";
import { aplicarAjustesVentas, etiquetaCanal, filtrarVentas } from "@/dominio/gerencia";
import { clientesDormidos, DIAS_DORMIDO, PARTE_PARETO, resumenClientes } from "@/dominio/clientela";
import { destinoCliente, type DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, NotaGrupo, VerDetalle } from "./comun";

/** Cuántas filas enseña cada lista. */
const FILAS = 15;

export function Clientes({ d }: { d: DatosGerencia }) {
  const historial = useHistorialClientes();
  const ventas = useMemo(
    () => aplicarAjustesVentas(filtrarVentas(historial.data ?? [], d.filtro), d.ajustes),
    [historial.data, d.filtro, d.ajustes],
  );
  const r = useMemo(() => resumenClientes(ventas, d.rango), [ventas, d.rango]);
  const p = useMemo(
    () => (d.comparacion ? resumenClientes(ventas, d.comparacion.previo) : null),
    [ventas, d.comparacion],
  );
  const dormidos = useMemo(() => clientesDormidos(ventas, d.hoy), [ventas, d.hoy]);

  if (historial.error) return <ErrorPestana que="los pedidos" error={historial.error} />;
  if (!historial.data) return <CargandoPestana />;

  const frente = d.comparacion?.etiqueta;
  const delta = (a: number, b: number | undefined) => (b === undefined ? null : variacion(a, b));

  return (
    <div className="space-y-4">
      <NotaGrupo
        grupo={d.grupo}
        texto="Clientes no se separa en A y B: enseña todos los pedidos."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Clientes activos"
          explicacion="g_clientes_activos"
          valor={String(r.activos)}
          frente={frente}
          delta={delta(r.activos, p?.activos)}
          icon={Users}
          pie={
            r.sinCliente.pedidos > 0 ? (
              <span className="text-muted-foreground">
                Más {r.sinCliente.pedidos} {r.sinCliente.pedidos === 1 ? "pedido" : "pedidos"} sin
                cliente ({eur(r.sinCliente.vendido)})
              </span>
            ) : undefined
          }
        />
        <TarjetaKpi
          titulo="Nuevos"
          explicacion="g_clientes_nuevos"
          valor={String(r.nuevos)}
          frente={frente}
          delta={delta(r.nuevos, p?.nuevos)}
          icon={UserPlus}
          pie={<span className="text-muted-foreground">Compraron {eur(r.vendidoNuevos)}</span>}
        />
        <TarjetaKpi
          titulo="Recurrentes"
          explicacion="g_clientes_recurrentes"
          valor={String(r.recurrentes)}
          frente={frente}
          delta={delta(r.recurrentes, p?.recurrentes)}
          icon={Repeat}
          pie={<span className="text-muted-foreground">Compraron {eur(r.vendidoRecurrentes)}</span>}
        />
        <TarjetaKpi
          titulo={`El ${PARTE_PARETO} % de las ventas`}
          explicacion="g_pareto"
          valor={
            r.pareto
              ? `${r.pareto.clientes} ${r.pareto.clientes === 1 ? "cliente" : "clientes"}`
              : "—"
          }
          delta={null}
          icon={Target}
          pie={
            r.pareto ? (
              <span className="text-muted-foreground">
                El {numero(r.pareto.porcentajeClientes, 1)} % de los clientes activos
              </span>
            ) : undefined
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quién más compra</CardTitle>
          <p className="text-xs text-muted-foreground">
            Lo vendido en el periodo a cada cliente, con IVA y sin devoluciones.
            {r.ranking.length > FILAS && ` Los ${FILAS} primeros de ${r.ranking.length}.`}
          </p>
        </CardHeader>
        <CardContent>
          {r.ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pedidos de clientes en el periodo.</p>
          ) : (
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.ranking.slice(0, FILAS).map((c) => (
                  <TableRow key={c.clave}>
                    <TableCell className="font-medium">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <VerDetalle destino={destinoCliente(c)} texto={c.nombre} />
                        {c.nuevo && <Badge variant="secondary">Nuevo</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{etiquetaCanal(c.canal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.pedidos}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(c.vendido)}</TableCell>
                    <TableCell className="text-right tabular-nums">{numero(c.peso, 1)} %</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {numero(c.acumulado, 1)} %
                    </TableCell>
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
            Llevan más de {DIAS_DORMIDO} días sin pedir
            <Explicacion titulo="Clientes dormidos" definicion={DEFINICIONES.g_dormidos} />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            A día de hoy, de más a menos comprado en toda su historia.
            {dormidos.length > FILAS && ` Los ${FILAS} primeros de ${dormidos.length}.`}
          </p>
        </CardHeader>
        <CardContent>
          {dormidos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ningún cliente lleva más de {DIAS_DORMIDO} días sin pedir.
            </p>
          ) : (
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Último pedido</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Comprado en total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dormidos.slice(0, FILAS).map((c) => (
                  <TableRow key={c.clave}>
                    <TableCell className="font-medium">
                      <VerDetalle destino={destinoCliente(c)} texto={c.nombre} />
                    </TableCell>
                    <TableCell>{fechaCorta(c.ultima)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.dias}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.pedidos}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(c.vendido)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
