import { useMemo } from "react";
import { Building2, CalendarClock, Landmark, PiggyBank } from "lucide-react";
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
import { useFiscal } from "@/lib/gerencia";
import { DEFINICIONES } from "@/dominio/definiciones";
import { enRango } from "@/dominio/periodos";
import {
  facturadoSinPedido,
  gastosFijosPorGrupo,
  GRUPOS,
  resultadosPorGrupo,
  type ColumnaResultados,
} from "@/dominio/grupos";
import { impuestosPorTrimestre, trimestreDe, trimestresDelRango } from "@/dominio/impuestos";
import { comparacionCompras, comprasParaComparar } from "@/dominio/compras";
import { DESTINO_AJUSTES, type DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, Nota, VerDetalle } from "./comun";

export function Resultados({ d }: { d: DatosGerencia }) {
  // Los modelos son trimestrales: se leen los trimestres enteros que toca el periodo.
  const trimestres = useMemo(() => trimestresDelRango(d.rango), [d.rango]);
  const rangoTrimestres = useMemo(
    () => ({ desde: trimestres[0].desde, hasta: trimestres[trimestres.length - 1].hasta }),
    [trimestres],
  );
  const fiscal = useFiscal(rangoTrimestres);

  // Los gastos fijos del periodo, hasta hoy si está en curso: con
  // justificante van a A y sin él a B.
  const fijos = useMemo(
    () => gastosFijosPorGrupo(d.gastos, d.rango, d.hoy),
    [d.gastos, d.rango, d.hoy],
  );
  const cuentas = useMemo(
    () =>
      fiscal.data && d.documentados
        ? resultadosPorGrupo({
            ventas: d.ventasTodas,
            documentados: d.documentados,
            costeActual: d.costeMetro,
            facturadoSinPedido: facturadoSinPedido(
              fiscal.data.documentos.filter((x) => enRango(x.fecha, d.rango)),
            ),
            costesFijos: { a: fijos.a, b: fijos.b },
            compras: fijos.compras,
            amortizacion: fijos.amortizacion,
            tipoIs: d.ajustes.tipo_is,
          })
        : null,
    [
      fiscal.data,
      d.documentados,
      d.ventasTodas,
      d.costeMetro,
      d.rango,
      fijos.a,
      fijos.b,
      fijos.compras,
      fijos.amortizacion,
      d.ajustes.tipo_is,
    ],
  );
  // Tinta, film y mensajería: ya cuestan en cada pedido; aquí solo se comparan.
  const comparadas = useMemo(
    () => (fiscal.data?.compras ? comprasParaComparar(fiscal.data.compras, d.rango) : null),
    [fiscal.data, d.rango],
  );
  const impuestos = useMemo(
    () =>
      fiscal.data
        ? impuestosPorTrimestre({
            rango: d.rango,
            documentos: fiscal.data.documentos,
            compras: fiscal.data.compras ?? [],
            gastos: d.gastos,
            cuotaIsAnterior: d.ajustes.cuota_is_anterior,
          })
        : null,
    [fiscal.data, d.rango, d.gastos, d.ajustes.cuota_is_anterior],
  );

  if (d.filtro.tienda !== "todas" || d.filtro.canal !== "todos") {
    return (
      <Nota>
        La cuenta de resultados y los impuestos son de toda la empresa: se ven con «Todas las
        tiendas» y «Todos los canales».
      </Nota>
    );
  }
  if (fiscal.error) return <ErrorPestana que="las facturas" error={fiscal.error} />;
  if (!impuestos || !cuentas) return <CargandoPestana />;

  const actual = trimestreDe(d.hoy);
  const esteTrimestre = impuestos.find(
    (t) => t.trimestre.anio === actual.anio && t.trimestre.numero === actual.numero,
  );
  // La cifra de las tarjetas es la del grupo elegido arriba.
  const elegida = cuentas[d.grupo];
  const filas: [string, keyof ColumnaResultados, "suma" | "resta" | "total"][] = [
    ["Ingresos (sin IVA)", "ingresos", "suma"],
    ["Producción DTF", "produccion", "resta"],
    ["Envíos", "envios", "resta"],
    ["Coste de la ropa", "ropa", "resta"],
    ["Margen", "margen", "total"],
    ["Costes fijos", "costesFijos", "resta"],
    ...(cuentas.total.compras !== 0
      ? [["Otras compras", "compras", "resta"] as (typeof filas)[number]]
      : []),
    ...(cuentas.total.amortizacion !== 0
      ? [["Amortizaciones", "amortizacion", "resta"] as (typeof filas)[number]]
      : []),
    ["Beneficio antes de impuestos", "bai", "total"],
    [`Sociedades (${numero(d.ajustes.tipo_is, 0)} %)`, "sociedades", "resta"],
    ["Beneficio neto", "neto", "total"],
  ];
  const columnas = [
    { clave: "a", titulo: "A · Documentado" },
    { clave: "b", titulo: "B · Sin documento" },
    { clave: "total", titulo: "Total" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Beneficio neto"
          explicacion="g_resultado"
          valor={eur(elegida.neto)}
          color={elegida.neto < 0 ? "destructive" : "primary"}
          delta={null}
          icon={PiggyBank}
          pie={
            <span className="text-muted-foreground">
              {GRUPOS.find((g) => g.valor === d.grupo)?.corta} · antes de impuestos{" "}
              {eur(elegida.bai)}
              {fijos.hastaHoy ? " · hasta hoy" : ""}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Sociedades estimado"
          explicacion="g_sociedades"
          valor={eur(cuentas.a.sociedades)}
          delta={null}
          icon={Building2}
          pie={
            <span className="text-muted-foreground">
              Al {numero(d.ajustes.tipo_is, 0)} % del beneficio documentado (A)
            </span>
          }
        />
        <TarjetaKpi
          titulo="Costes fijos"
          explicacion="g_beneficio"
          valor={eur(fijos[d.grupo])}
          delta={null}
          icon={Landmark}
          pie={
            <span className="flex flex-wrap items-center gap-x-2">
              {d.grupo === "total" && fijos.b > 0 && (
                <span className="text-muted-foreground">
                  A {eur(fijos.a)} · B {eur(fijos.b)}
                </span>
              )}
              <VerDetalle destino={DESTINO_AJUSTES} texto="Ver gastos" />
            </span>
          }
        />
        <TarjetaKpi
          titulo="A Hacienda este trimestre"
          explicacion="g_impuestos_trimestre"
          valor={esteTrimestre ? eur(esteTrimestre.aPagar) : "—"}
          delta={null}
          icon={CalendarClock}
          pie={
            <span className="text-muted-foreground">
              {actual.numero}.º trimestre de {actual.anio}
            </span>
          }
        />
      </div>

      {!d.gastos.some((g) => (g.origen ?? "gasto") === "gasto") && (
        <Nota>
          Sin gastos apuntados, el beneficio no descuenta alquiler, sueldos ni cuotas.{" "}
          <VerDetalle destino={DESTINO_AJUSTES} texto="Apuntar gastos" />
        </Nota>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              Cuenta de resultados
              <Explicacion titulo="Cuenta de resultados" definicion={DEFINICIONES.g_resultado} />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Del periodo, sin IVA. A: con factura, ticket o justificante, lo que cuenta para
              Hacienda. B: sin documento. Sociedades sale solo de A.
            </p>
          </CardHeader>
          <CardContent>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto</TableHead>
                  {columnas.map((c) => (
                    <TableHead
                      key={c.clave}
                      className={`text-right ${d.grupo === c.clave ? "text-foreground" : ""}`}
                    >
                      {c.titulo}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map(([etiqueta, campo, clase]) => (
                  <TableRow key={campo} className={clase === "total" ? "font-semibold" : ""}>
                    <TableCell className={clase === "total" ? "" : "text-muted-foreground"}>
                      {clase === "resta" ? "− " : ""}
                      {etiqueta}
                    </TableCell>
                    {columnas.map((c) => {
                      const valor = cuentas[c.clave][campo];
                      return (
                        <TableCell
                          key={c.clave}
                          className={`text-right tabular-nums ${
                            clase === "total" && valor < 0 ? "text-status-cancelado" : ""
                          }`}
                        >
                          {eur(valor)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {comparadas && (comparadas.consumibles > 0 || comparadas.envios > 0) && (
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
                pedidos. Si lo comprado sale siempre por encima, sube el coste por metro.
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
                  {comparacionCompras(comparadas, cuentas.total).map((f) => (
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
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              Impuestos por trimestre
              <Explicacion
                titulo="Impuestos por trimestre"
                definicion={DEFINICIONES.g_impuestos_trimestre}
              />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Orientativo, con lo que hay en el CRM. Los presenta la gestoría.
            </p>
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
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${l.importe < 0 ? "text-status-completado" : ""}`}
                      >
                        {l.importe < 0 ? `${eur(-l.importe)} a compensar` : eur(l.importe)}
                      </TableCell>
                      <TableCell>Hasta el {fechaCorta(l.plazo)}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
