import { useMemo } from "react";
import { Clock, HandCoins, Hourglass, Wallet } from "lucide-react";
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
import { eur, numero } from "@/lib/format";
import { variacion } from "@/dominio/kpis";
import { desglosePorMetodo, totalizar } from "@/dominio/facturacion";
import { totalesCaja } from "@/dominio/caja";
import { DEFINICIONES } from "@/dominio/definiciones";
import { antiguedadPendientes, diasMediosCobro, resumenBanco } from "@/dominio/gerencia";
import {
  destinoCaja,
  destinoCobros,
  destinoPendientes,
  DESTINO_CONCILIACION,
  type DatosGerencia,
} from "./destinos";
import { VerDetalle } from "./comun";

export function Tesoreria({ d }: { d: DatosGerencia }) {
  const frente = d.comparacion?.etiqueta;
  const t = totalizar(d.cobros);
  const tPrev = totalizar(d.cobrosPrevios);
  const dias = diasMediosCobro(d.cobros);
  const diasPrev = diasMediosCobro(d.cobrosPrevios);
  const pendienteHoy = d.pendientes.reduce((s, x) => s + Number(x.pendiente ?? 0), 0);
  const tramos = useMemo(() => antiguedadPendientes(d.pendientes, d.hoy), [d.pendientes, d.hoy]);
  const metodos = useMemo(() => desglosePorMetodo(d.cobros), [d.cobros]);
  const caja = useMemo(() => (d.caja ? totalesCaja(d.caja) : null), [d.caja]);
  const banco = useMemo(() => (d.banco ? resumenBanco(d.banco) : null), [d.banco]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Cobrado"
          explicacion="g_cobrado"
          valor={d.cobrosDisponibles ? eur(t.cobrado) : "—"}
          frente={frente}
          delta={d.cobrosDisponibles ? variacion(t.cobrado, tPrev.cobrado) : null}
          icon={Wallet}
          pie={<VerDetalle destino={destinoCobros(d.filtro, d.seleccion)} texto="Ver cobros" />}
        />
        <TarjetaKpi
          titulo="Pendiente de cobro"
          explicacion="g_pendiente"
          valor={d.pendientesDisponibles ? eur(pendienteHoy) : "—"}
          delta={null}
          icon={Clock}
          pie={<VerDetalle destino={destinoPendientes(d.filtro)} texto="Ver pendientes" />}
        />
        <TarjetaKpi
          titulo="Días medios de cobro"
          explicacion="g_dias_cobro"
          valor={dias === null ? "—" : `${numero(dias, 1)} días`}
          frente={frente}
          delta={dias === null || diasPrev === null ? null : variacion(dias, diasPrev)}
          deltaInverso
          icon={Hourglass}
        />
        <TarjetaKpi
          titulo="Propinas"
          explicacion="propinas"
          valor={eur(t.propina)}
          frente={frente}
          delta={variacion(t.propina, tPrev.propina)}
          icon={HandCoins}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lo que se debe, por antigüedad</CardTitle>
            <p className="text-xs text-muted-foreground">
              A día de hoy, por los días desde el pedido.{" "}
              <VerDetalle destino={destinoPendientes(d.filtro)} texto="Ver pendientes" />
            </p>
          </CardHeader>
          <CardContent>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Antigüedad</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tramos.map((tr) => (
                  <TableRow key={tr.clave}>
                    <TableCell
                      className={
                        tr.clave === "60+" && tr.pedidos > 0
                          ? "font-medium text-status-cancelado"
                          : "font-medium"
                      }
                    >
                      {tr.etiqueta}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tr.pedidos}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(tr.pendiente)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Por método de cobro</CardTitle>
            <p className="text-xs text-muted-foreground">Cobros del periodo, por fecha de cobro.</p>
          </CardHeader>
          <CardContent>
            {metodos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin cobros con estos filtros.</p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Cobros</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metodos.map((m) => (
                    <TableRow key={m.metodo}>
                      <TableCell className="font-medium">{m.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.cobros}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(m.cobrado)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.cobrado > 0 ? `${numero((m.cobrado / t.cobrado) * 100, 1)} %` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BloqueSaldo
          titulo="Caja"
          clave="g_caja"
          filas={
            caja
              ? [
                  ["Ingresos", eur(caja.ingresos)],
                  ["Gastos", eur(caja.gastos)],
                  ["Saldo del periodo", eur(caja.saldo)],
                ]
              : null
          }
          pie={<VerDetalle destino={destinoCaja(d.seleccion)} texto="Ver caja" />}
        />
        <BloqueSaldo
          titulo="Banco"
          clave="g_banco"
          filas={
            banco
              ? [
                  ["Entradas", eur(banco.entradas)],
                  ["Salidas", eur(banco.salidas)],
                  ["Neto del periodo", eur(banco.neto)],
                  ["Entradas casadas con factura", eur(banco.conciliadas)],
                  [
                    `Entradas sin casar (${banco.movimientosSinConciliar})`,
                    eur(banco.sinConciliar),
                  ],
                ]
              : null
          }
          pie={<VerDetalle destino={DESTINO_CONCILIACION} texto="Ver conciliación" />}
        />
      </div>
    </div>
  );
}

function BloqueSaldo({
  titulo,
  clave,
  filas,
  pie,
}: {
  titulo: string;
  clave: "g_caja" | "g_banco";
  filas: [string, string][] | null;
  pie: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          {titulo}
          <Explicacion titulo={titulo} definicion={DEFINICIONES[clave]} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {filas === null ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : (
          filas.map(([etiqueta, valor], i) => (
            <div
              key={etiqueta}
              className={`flex justify-between gap-4 ${i === 2 ? "border-t pt-1.5 font-semibold" : ""}`}
            >
              <span className={i === 2 ? "" : "text-muted-foreground"}>{etiqueta}</span>
              <span className="tabular-nums">{valor}</span>
            </div>
          ))
        )}
        <div className="pt-2 text-xs">{pie}</div>
      </CardContent>
    </Card>
  );
}
