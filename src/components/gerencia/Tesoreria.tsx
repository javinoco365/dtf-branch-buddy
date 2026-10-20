import { useMemo } from "react";
import { Clock, HandCoins, Hourglass, Truck, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TarjetaKpi } from "@/components/TarjetaKpi";
import { Explicacion } from "@/components/Explicacion";
import { eur, fechaCorta, numero } from "@/lib/format";
import { usePagosProveedores, useProformasPendientes } from "@/lib/gerencia";
import { anticiposProveedores, pagosPendientesProveedores } from "@/dominio/pagos-proveedores";
import { variacion } from "@/dominio/kpis";
import { desglosePorMetodo, totalizar } from "@/dominio/facturacion";
import { totalesCaja } from "@/dominio/caja";
import { DEFINICIONES } from "@/dominio/definiciones";
import { antiguedadPendientes, diasMediosCobro, resumenBanco } from "@/dominio/gerencia";
import { sumarCantidades, sumarImportes } from "@/dominio/sumatorios";
import {
  destinoCaja,
  destinoCobros,
  destinoPendientes,
  DESTINO_CONCILIACION,
  DESTINO_PROFORMAS_PENDIENTES,
  type DatosGerencia,
} from "./destinos";
import { NotaGrupo, VerDetalle } from "./comun";

export function Tesoreria({ d }: { d: DatosGerencia }) {
  const frente = d.comparacion?.etiqueta;
  const t = totalizar(d.cobros);
  const tPrev = totalizar(d.cobrosPrevios);
  const dias = diasMediosCobro(d.cobros);
  const diasPrev = diasMediosCobro(d.cobrosPrevios);
  const pendienteHoy = d.pendientes.reduce((s, x) => s + Number(x.pendiente ?? 0), 0);
  const tramos = useMemo(() => antiguedadPendientes(d.pendientes, d.hoy), [d.pendientes, d.hoy]);
  // El pie suma los mismos pedidos que la tarjeta «Pendiente de cobro».
  const totalPendiente = useMemo(
    () => sumarImportes(d.pendientes, (x) => x.pendiente),
    [d.pendientes],
  );
  const metodos = useMemo(() => desglosePorMetodo(d.cobros), [d.cobros]);
  const caja = useMemo(() => (d.caja ? totalesCaja(d.caja) : null), [d.caja]);
  const banco = useMemo(() => (d.banco ? resumenBanco(d.banco) : null), [d.banco]);

  return (
    <div className="space-y-4">
      <NotaGrupo
        grupo={d.grupo}
        texto="La tesorería es el dinero que entra y sale: no se separa en A y B."
      />
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
              {/* Sin los pendientes leídos, la tarjeta dice «—»: el pie no se pinta. */}
              {d.pendientesDisponibles && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total pendiente</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {numero(d.pendientes.length, 0)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totalPendiente)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
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
                {/* La misma cifra que la tarjeta «Cobrado», sin propinas. */}
                {d.cobrosDisponibles && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-bold">Total</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {numero(t.cobros, 0)}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {eur(t.cobrado)}
                      </TableCell>
                      {/* El peso es una parte del total: no se suma. */}
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
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

      <PagosProveedores hoy={d.hoy} />
      <AnticiposProveedores hoy={d.hoy} />
    </div>
  );
}

const FILAS_PROVEEDORES = 10;

/** «5 facturas · 2 proformas», o solo las facturas si no hay proformas. */
function textoDocumentosPendientes(documentos: number, proformas: number): string {
  const facturas = documentos - proformas;
  const f = `${numero(facturas, 0)} ${facturas === 1 ? "factura" : "facturas"}`;
  if (proformas <= 0) return f;
  return `${f} · ${numero(proformas, 0)} ${proformas === 1 ? "proforma" : "proformas"}`;
}

/** Lo que se debe hoy a los proveedores: no depende del periodo ni de los filtros. */
function PagosProveedores({ hoy }: { hoy: Date }) {
  const consulta = usePagosProveedores();
  const pagos = useMemo(
    () => (consulta.data ? pagosPendientesProveedores(consulta.data, hoy) : null),
    [consulta.data, hoy],
  );
  const primeros = pagos ? pagos.porProveedor.slice(0, FILAS_PROVEEDORES) : [];
  const resto = pagos ? pagos.porProveedor.slice(FILAS_PROVEEDORES) : [];
  // La fila «Resto»: los que no caben en la lista, sumados.
  const resumenResto = {
    facturas: sumarCantidades(resto, (x) => x.facturas),
    importe: sumarImportes(resto, (x) => x.importe),
  };
  const verFacturas = (
    <VerDetalle destino={{ to: "/panel/compras", search: {} }} texto="Ver facturas de compra" />
  );
  // Con proformas sin pagar, las columnas cuentan documentos, no facturas.
  const columnaDocumentos = pagos && pagos.proformas > 0 ? "Documentos" : "Facturas";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Truck className="h-4 w-4 text-muted-foreground" />
          Pagos pendientes a proveedores
          <Explicacion
            titulo="Pagos pendientes a proveedores"
            definicion={DEFINICIONES.g_pagos_proveedores}
          />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A día de hoy, de todas las categorías. {verFacturas}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {consulta.error ? (
          <p className="text-sm text-destructive">
            No se han podido leer las facturas de compra: {consulta.error.message}
          </p>
        ) : consulta.data === undefined ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !pagos ? (
          <p className="text-sm text-muted-foreground">
            Falta aplicar la migración 20261014100000_compras_recibidas: sin ella no se sabe qué
            facturas de compra están pagadas.
          </p>
        ) : pagos.facturas === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay facturas de compra pendientes de pago.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-2xl font-semibold tabular-nums">{eur(pagos.total)}</span>
              <span className="text-sm text-muted-foreground">
                {textoDocumentosPendientes(pagos.facturas, pagos.proformas)}
              </span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">{columnaDocumentos}</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {primeros.map((p) => (
                    <TableRow key={p.clave}>
                      <TableCell className="font-medium">
                        {p.nombre}
                        {p.masAntigua && (
                          <span className="block text-xs text-muted-foreground">
                            La más antigua, del {fechaCorta(p.masAntigua)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.facturas}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(p.importe)}</TableCell>
                    </TableRow>
                  ))}
                  {resto.length > 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">
                        Resto · {numero(resto.length, 0)}{" "}
                        {resto.length === 1 ? "proveedor" : "proveedores"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numero(resumenResto.facturas, 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {eur(resumenResto.importe)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {numero(pagos.facturas, 0)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(pagos.total)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Antigüedad</TableHead>
                    <TableHead className="text-right">{columnaDocumentos}</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagos.tramos.map((t) => (
                    <TableRow key={t.clave}>
                      <TableCell
                        className={
                          t.clave === "90+" && t.facturas > 0
                            ? "font-medium text-status-cancelado"
                            : "font-medium"
                        }
                      >
                        {t.etiqueta}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.facturas}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(t.importe)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {numero(pagos.facturas, 0)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(pagos.total)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Lo pagado por adelantado a proveedores con proformas que aún no tienen
 * factura. No depende del periodo. Sin la migración de proformas, nada.
 */
function AnticiposProveedores({ hoy }: { hoy: Date }) {
  const consulta = useProformasPendientes();
  const anticipos = useMemo(
    () => (consulta.data ? anticiposProveedores(consulta.data, hoy) : null),
    [consulta.data, hoy],
  );
  // Sin la migración (null) o mientras se lee, no se enseña nada.
  if (!consulta.error && !anticipos) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <HandCoins className="h-4 w-4 text-muted-foreground" />
          Anticipos a proveedores
          <Explicacion
            titulo="Anticipos a proveedores"
            definicion={DEFINICIONES.g_anticipos_proveedores}
          />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Proformas pagadas que esperan su factura. No depende del periodo.{" "}
          <VerDetalle destino={DESTINO_PROFORMAS_PENDIENTES} texto="Ver proformas" />
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {consulta.error ? (
          <p className="text-sm text-destructive">
            No se han podido leer las proformas: {consulta.error.message}
          </p>
        ) : !anticipos || anticipos.proformas === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay anticipos: ninguna proforma pagada espera su factura.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-2xl font-semibold tabular-nums">{eur(anticipos.total)}</span>
              <span className="text-sm text-muted-foreground">
                {numero(anticipos.proformas, 0)}{" "}
                {anticipos.proformas === 1 ? "proforma" : "proformas"}
                {anticipos.masAntigua &&
                  ` · el pago más antiguo, del ${fechaCorta(anticipos.masAntigua)}`}
              </span>
            </div>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Proformas</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anticipos.porProveedor.map((p) => (
                  <TableRow key={p.clave}>
                    <TableCell className="font-medium">
                      {p.nombre}
                      {p.masAntigua && (
                        <span className="block text-xs text-muted-foreground">
                          {p.facturas === 1 ? "Pagada el" : "El pago más antiguo, del"}{" "}
                          {fechaCorta(p.masAntigua)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.facturas}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(p.importe)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {numero(anticipos.proformas, 0)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(anticipos.total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
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
