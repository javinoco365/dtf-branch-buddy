import { useMemo } from "react";
import { CalendarClock, FileWarning, Landmark, Receipt, ShoppingBag } from "lucide-react";
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
import { useFiscal, usePrimeraVenta } from "@/lib/gerencia";
import { mensajeDeError } from "@/lib/errores";
import { variacion } from "@/dominio/kpis";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import {
  DEFINICIONES,
  definicionImpuestosTrimestre,
  TEXTO_SIN_PRIMERA_VENTA,
} from "@/dominio/definiciones";
import { resultadosPorGrupo } from "@/dominio/grupos";
import {
  impuestosPorTrimestre,
  inicioCompensacion,
  inicioHistorial303,
  trimestreDe,
  trimestresDelRango,
} from "@/dominio/impuestos";
import { comparacionCompras, comprasParaComparar } from "@/dominio/compras";
import { totalComparacion, totalImpuestos } from "@/dominio/sumatorios-gerencia-b";
import { ivaSoportado, resultadoIva, resumenIva } from "@/dominio/fiscal";
import { totalTiposIva } from "@/dominio/sumatorios-gerencia-a";
import type { DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, Nota, NotaGrupo } from "./comun";

/** Las facturas son de una tienda o del textil; el canal no se les aplica. */
function deLaTienda<T extends { tienda_id: string }>(lista: readonly T[], tienda: string) {
  return tienda === "todas" ? lista : lista.filter((x) => x.tienda_id === tienda);
}

export function Fiscal({ d }: { d: DatosGerencia }) {
  const fiscal = useFiscal(d.rango);
  const previo = useFiscal(d.comparacion?.previo ?? d.rango);

  // Las compras son de la empresa; con el textil elegido, solo las de textil.
  const soloTextil = d.filtro.tienda === TIENDA_TEXTIL.id;
  const conCompras = d.filtro.tienda === "todas" || soloTextil;

  // Para casar canjes vale cualquier documento leído, del periodo o de fuera
  // y de cualquier tienda: solo se miran, cuentan los de la tienda elegida.
  const iva = useMemo(
    () =>
      resumenIva(
        deLaTienda(fiscal.data?.documentos ?? [], d.filtro.tienda),
        fiscal.data ? [...fiscal.data.documentos, ...fiscal.data.referencias] : [],
      ),
    [fiscal.data, d.filtro.tienda],
  );
  const totalIva = useMemo(() => totalTiposIva(iva.porTipoIva), [iva]);
  const ivaPrevio = useMemo(
    () =>
      d.comparacion && previo.data
        ? resumenIva(deLaTienda(previo.data.documentos, d.filtro.tienda), [
            ...previo.data.documentos,
            ...previo.data.referencias,
          ])
        : null,
    [d.comparacion, previo.data, d.filtro.tienda],
  );
  const soportado = useMemo(
    () =>
      fiscal.data?.compras && conCompras
        ? ivaSoportado(
            soloTextil
              ? fiscal.data.compras.filter((c) => (c.categoria ?? "textil") === "textil")
              : fiscal.data.compras,
          )
        : null,
    [fiscal.data, conCompras, soloTextil],
  );
  // Lo mismo que el botón de la esquina: los pedidos del periodo sin documento.
  const sinFactura = d.pendiente;

  if (fiscal.error) return <ErrorPestana que="las facturas" error={fiscal.error} />;
  if (!fiscal.data) return <CargandoPestana />;

  const frente = d.comparacion?.etiqueta;
  const conCanjes = iva.canjes.canjes + iva.canjes.anulados > 0;
  const resultado = resultadoIva(iva.repercutido.iva, soportado?.iva ?? 0);
  const huecos = fiscal.data.huecos;

  return (
    <div className="space-y-4">
      <NotaGrupo
        grupo={d.grupo}
        texto="Fiscal es siempre lo documentado (A): las facturas y tickets emitidos."
      />
      {d.filtro.canal !== "todos" && (
        <Nota>
          Las facturas no se separan por canal: aquí salen todas las de{" "}
          {d.filtro.tienda === "todas" ? "la empresa" : "la tienda elegida"}.
        </Nota>
      )}

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <TarjetaKpi
          titulo="IVA repercutido"
          explicacion="g_iva_repercutido"
          valor={eur(iva.repercutido.iva)}
          frente={frente}
          delta={ivaPrevio ? variacion(iva.repercutido.iva, ivaPrevio.repercutido.iva) : null}
          icon={Receipt}
          pie={
            <span className="text-muted-foreground">
              Sobre {eur(iva.repercutido.base)} de base · {iva.repercutido.documentos}{" "}
              {iva.repercutido.documentos === 1 ? "documento" : "documentos"}
            </span>
          }
        />
        <TarjetaKpi
          titulo="IVA soportado"
          explicacion="g_iva_soportado"
          valor={soportado ? eur(soportado.iva) : "—"}
          delta={null}
          icon={ShoppingBag}
          pie={
            <span className="text-muted-foreground">
              {soportado
                ? `${soportado.documentos} ${soportado.documentos === 1 ? "factura de compra registrada" : "facturas de compra registradas"}${soloTextil ? " del textil" : ""}`
                : "Sin compras en el CRM para esta tienda"}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Resultado orientativo"
          explicacion="g_iva_resultado"
          valor={eur(Math.abs(resultado))}
          delta={null}
          icon={Landmark}
          pie={
            <span className="text-muted-foreground">
              {resultado >= 0 ? "A ingresar" : "A compensar"}, con lo que sabe el CRM
            </span>
          }
        />
        <TarjetaKpi
          titulo="Vendido sin factura"
          explicacion="g_sin_factura"
          valor={sinFactura ? String(sinFactura.pedidos) : "—"}
          delta={null}
          icon={FileWarning}
          color={sinFactura && sinFactura.pedidos > 0 ? "destructive" : "primary"}
          pie={
            sinFactura ? (
              <span className="text-muted-foreground">
                {sinFactura.pedidos === 1 ? "Pedido" : "Pedidos"} del periodo por{" "}
                {eur(sinFactura.vendido)}
              </span>
            ) : (
              <span className="text-muted-foreground">Cargando…</span>
            )
          }
        />
      </div>

      {iva.borradores > 0 && (
        <Nota>
          {iva.borradores} {iva.borradores === 1 ? "borrador" : "borradores"} con fecha en el
          periodo sin emitir: no cuentan hasta que se emitan.
        </Nota>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Por tipo de documento</CardTitle>
            <p className="text-xs text-muted-foreground">
              Emitidos en el periodo. Las rectificativas restan.
            </p>
          </CardHeader>
          <CardContent>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead className="text-right">Emitidos</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {iva.porTipoDocumento.map((t) => (
                  <TableRow key={t.tipo}>
                    <TableCell className="font-medium">{t.etiqueta}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.cuenta.documentos}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(t.cuenta.base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(t.cuenta.iva)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(t.cuenta.total)}</TableCell>
                  </TableRow>
                ))}
                {/* No es un documento: lo del ticket que la factura del canje
                    sustituye (resta) o que vuelve al anularse esa factura (suma). */}
                {conCanjes && (
                  <TableRow>
                    <TableCell className="font-medium">
                      Canjes de ticket por factura
                      <span className="block text-xs font-normal text-muted-foreground">
                        {[
                          iva.canjes.canjes > 0 &&
                            "Resta el ticket, que ya contó el día que se emitió",
                          iva.canjes.anulados > 0 &&
                            `${iva.canjes.anulados} ${iva.canjes.anulados === 1 ? "canje anulado" : "canjes anulados"}: vuelve a contar el ticket`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(iva.canjes.base)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{eur(iva.canjes.iva)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(iva.canjes.total)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {/* El IVA repercutido de la tarjeta de arriba: las filas de
                  encima, con las rectificativas y los canjes ya con su signo,
                  sin los borradores. */}
              <TableFooter>
                <TableRow>
                  <TableCell>
                    Total
                    {iva.borradores > 0 &&
                      ` · sin ${iva.borradores} ${iva.borradores === 1 ? "borrador" : "borradores"}`}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {numero(iva.repercutido.documentos, 0)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(iva.repercutido.base)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(iva.repercutido.iva)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(iva.repercutido.total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Por tipo de IVA</CardTitle>
            <p className="text-xs text-muted-foreground">
              El desglose que quedó guardado en cada documento al emitirlo.
            </p>
          </CardHeader>
          <CardContent>
            {iva.porTipoIva.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin documentos emitidos.</p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Cuota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {iva.porTipoIva.map((t) => (
                    <TableRow key={t.tipo}>
                      <TableCell className="font-medium">
                        {t.tipo === 0 ? "Sin desglose" : `${numero(t.tipo, 0)}\u00A0%`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{eur(t.base)}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(t.cuota)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totalIva.base)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totalIva.cuota)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            Numeración de facturas
            <Explicacion titulo="Numeración de facturas" definicion={DEFINICIONES.g_huecos} />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Todas las series y años, sin depender del periodo.
          </p>
        </CardHeader>
        <CardContent>
          {huecos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin huecos: la numeración está completa.
            </p>
          ) : (
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Serie</TableHead>
                  <TableHead>Año</TableHead>
                  <TableHead className="text-right">Número sin factura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {huecos.map((h) => (
                  <TableRow key={`${h.serie}-${h.ejercicio}-${h.numero_ausente}`}>
                    <TableCell className="font-medium">{h.serie || "Ordinaria"}</TableCell>
                    <TableCell>{h.ejercicio}</TableCell>
                    <TableCell className="text-right tabular-nums text-status-cancelado">
                      {h.numero_ausente}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ImpuestosYCompras d={d} />
    </div>
  );
}

/**
 * Los impuestos por trimestre y las compras frente a lo estimado (antes en
 * la pestaña Resultados, que ahora es la pantalla Cuenta de resultados). Son
 * de toda la empresa: con un filtro, solo se dice.
 */
function ImpuestosYCompras({ d }: { d: DatosGerencia }) {
  // Los modelos son trimestrales: se leen los trimestres enteros que toca el
  // periodo, y los cuatro años de antes para compensar los 303 negativos.
  const trimestres = useMemo(() => trimestresDelRango(d.rango), [d.rango]);
  const rangoLectura = useMemo(
    () => ({
      desde: inicioCompensacion(trimestres[0]),
      hasta: trimestres[trimestres.length - 1].hasta,
    }),
    [trimestres],
  );
  const fiscal = useFiscal(rangoLectura);
  // Solo se compensa desde la primera venta documentada del CRM. Si no se
  // puede leer, se ve igual: el 303 sale sin compensar y se dice.
  const primeraVenta = usePrimeraVenta();
  const sinPrimeraVenta = primeraVenta.data === undefined && primeraVenta.isError;

  // Lo que los pedidos cuentan de tinta, envíos y subcontrata: los costes
  // variables del periodo (resultadosPorGrupo, columna total).
  const estimado = useMemo(
    () =>
      resultadosPorGrupo({
        ventas: d.ventasTodas,
        documentados: new Set(),
        costeActual: d.costeMetro,
        facturadoSinPedido: 0,
        costesFijos: { a: 0, b: 0 },
        tipoIs: 0,
      }).total,
    [d.ventasTodas, d.costeMetro],
  );
  // Tinta, film, mensajería y la subcontrata del DTF UV: ya cuestan en cada
  // pedido; aquí solo se comparan.
  const comparadas = useMemo(
    () => (fiscal.data?.compras ? comprasParaComparar(fiscal.data.compras, d.rango) : null),
    [fiscal.data, d.rango],
  );
  const impuestos = useMemo(
    () =>
      fiscal.data && (primeraVenta.data !== undefined || sinPrimeraVenta)
        ? impuestosPorTrimestre({
            rango: d.rango,
            documentos: fiscal.data.documentos,
            referencias: fiscal.data.referencias,
            compras: fiscal.data.compras ?? [],
            gastos: d.gastos,
            cuotaIsAnterior: d.ajustes.cuota_is_anterior,
            datosDesde: rangoLectura.desde,
            primeraVenta: primeraVenta.data ?? null,
            compensar: !sinPrimeraVenta,
          })
        : null,
    [
      fiscal.data,
      primeraVenta.data,
      sinPrimeraVenta,
      d.rango,
      d.gastos,
      d.ajustes.cuota_is_anterior,
      rangoLectura.desde,
    ],
  );
  // El ⓘ dice desde qué trimestre se compensa.
  const definicionImpuestos = useMemo(
    () =>
      sinPrimeraVenta
        ? definicionImpuestosTrimestre("desconocido")
        : primeraVenta.data !== undefined
          ? definicionImpuestosTrimestre(
              inicioHistorial303({
                rango: d.rango,
                datosDesde: rangoLectura.desde,
                primeraVenta: primeraVenta.data,
              }),
            )
          : DEFINICIONES.g_impuestos_trimestre,
    [sinPrimeraVenta, primeraVenta.data, d.rango, rangoLectura.desde],
  );

  if (
    d.filtro.tienda !== "todas" ||
    d.filtro.canal !== "todos" ||
    (d.filtro.linea ?? "todo") !== "todo"
  ) {
    return (
      <Nota>
        Los impuestos por trimestre son de toda la empresa: se ven con «Todas las tiendas», «Todos
        los canales» y la línea «Todo».
      </Nota>
    );
  }
  if (fiscal.error) return <ErrorPestana que="las facturas" error={fiscal.error} />;
  if (!impuestos) return <CargandoPestana />;

  const actual = trimestreDe(d.hoy);
  const esteTrimestre = impuestos.find(
    (t) => t.trimestre.anio === actual.anio && t.trimestre.numero === actual.numero,
  );
  const filasCompras = comparadas ? comparacionCompras(comparadas, estimado) : [];
  const totalCompras = totalComparacion(filasCompras);
  const totalModelos = totalImpuestos(impuestos);
  const modelos = (n: number) => `${numero(n, 0)} ${n === 1 ? "modelo" : "modelos"}`;
  const ultimo = impuestos[impuestos.length - 1].trimestre;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <TarjetaKpi
          titulo="A Hacienda este trimestre"
          explicacion={definicionImpuestos}
          valor={esteTrimestre ? eur(esteTrimestre.aPagar) : "—"}
          delta={null}
          icon={CalendarClock}
          pie={
            <span className="text-muted-foreground">
              {actual.numero}.º trimestre de {actual.anio}
              {sinPrimeraVenta && " · 303 sin compensar"}
              {esteTrimestre &&
                esteTrimestre.compensacion.pendiente > 0 &&
                ` · quedan ${eur(esteTrimestre.compensacion.pendiente)} de IVA a compensar`}
            </span>
          }
        />
      </div>

      {comparadas &&
        (comparadas.consumibles > 0 || comparadas.envios > 0 || comparadas.subcontrataUv > 0) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base">
                Compras frente a lo estimado
                <Explicacion
                  titulo="Compras frente a lo estimado"
                  definicion={DEFINICIONES.g_compras_comparadas}
                />
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sin IVA. Lo facturado por tus proveedores frente a lo que Gerencia cuenta en los
                pedidos. Si lo comprado de tinta sale siempre por encima, sube el coste por metro;
                si lo es lo de la subcontrata, revisa lo que cobra por metro de DTF UV.
              </p>
            </CardHeader>
            <CardContent>
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Facturas de compra</TableHead>
                    <TableHead className="text-right">Estimado en pedidos</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filasCompras.map((f) => (
                    <TableRow key={f.concepto}>
                      <TableCell className="font-medium">{f.concepto}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(f.comprado)}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(f.estimado)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.diferencia > 0 ? "+" : ""}
                        {eur(f.diferencia)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totalCompras.comprado)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totalCompras.estimado)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {totalCompras.diferencia > 0 ? "+" : ""}
                      {eur(totalCompras.diferencia)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            Impuestos por trimestre
            <Explicacion titulo="Impuestos por trimestre" definicion={definicionImpuestos} />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Orientativo, con lo que hay en el CRM. Los presenta la gestoría.
          </p>
          {sinPrimeraVenta && (
            <p className="text-xs text-status-pendiente">
              {TEXTO_SIN_PRIMERA_VENTA}
              {primeraVenta.error ? ` (${mensajeDeError(primeraVenta.error)})` : ""}.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Trimestre</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Plazo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {impuestos.flatMap((t) =>
                t.lineas.map((l, i) => (
                  <TableRow key={`${t.trimestre.anio}-${t.trimestre.numero}-${l.modelo}-${i}`}>
                    <TableCell className="font-medium">
                      {t.trimestre.numero}.º {t.trimestre.anio}
                    </TableCell>
                    <TableCell>
                      {l.modelo}
                      <span className="block text-xs text-muted-foreground">{l.concepto}</span>
                      {l.modelo === "303" && t.sinVentas && (
                        <span className="block text-xs text-muted-foreground">
                          Sin ventas en el CRM todavía: no se calcula ni deja nada a compensar
                        </span>
                      )}
                      {l.modelo === "303" && t.compensacion.compensado > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          Resultado {eur(t.compensacion.resultado)} −{" "}
                          {eur(t.compensacion.compensado)} compensado de trimestres anteriores
                        </span>
                      )}
                      {l.modelo === "303" &&
                        t.compensacion.pendiente > 0 &&
                        t.compensacion.pendiente !== -l.importe && (
                          <span className="block text-xs text-muted-foreground">
                            Quedan {eur(t.compensacion.pendiente)} a compensar
                          </span>
                        )}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${l.importe < 0 ? "text-status-completado" : ""}`}
                    >
                      {l.modelo === "303" && t.sinVentas
                        ? "—"
                        : l.importe < 0
                          ? `${eur(-l.importe)} a compensar`
                          : eur(l.importe)}
                    </TableCell>
                    <TableCell>Hasta el {fechaCorta(l.plazo)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
            {/* Los 303 ya llegan compensados. */}
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-bold">
                  Total a ingresar · {modelos(totalModelos.modelosAIngresar)}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {eur(totalModelos.aIngresar)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
          {/* Lo que queda a compensar no es una fila: no resta de los otros
              modelos y puede venir de trimestres que no se ven. */}
          {totalModelos.aCompensar > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Al cerrar el {ultimo.numero}.º trimestre de {ultimo.anio} quedan{" "}
              <span className="font-medium tabular-nums text-status-completado">
                {eur(totalModelos.aCompensar)}
              </span>{" "}
              de IVA a compensar en los próximos 303
              {totalModelos.aCompensarDeAntes ? ", de trimestres anteriores incluidos" : ""}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
