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
import { beneficioEstimado, cifrasGerencia } from "@/dominio/gerencia";
import {
  cuentaResultados,
  impuestosPorTrimestre,
  trimestreDe,
  trimestresDelRango,
} from "@/dominio/impuestos";
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

  const c = useMemo(() => cifrasGerencia(d.ventas, d.costeMetro), [d.ventas, d.costeMetro]);
  const fijos = useMemo(
    () => beneficioEstimado(c.margen, d.gastos, d.rango, d.hoy),
    [c.margen, d.gastos, d.rango, d.hoy],
  );
  const cuenta = useMemo(
    () =>
      cuentaResultados({
        ingresos: c.bruta,
        costesVariables: c.coste,
        costesFijos: fijos.gastos,
        tipoIs: d.ajustes.tipo_is,
      }),
    [c.bruta, c.coste, fijos.gastos, d.ajustes.tipo_is],
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
  if (!impuestos) return <CargandoPestana />;

  const actual = trimestreDe(d.hoy);
  const esteTrimestre = impuestos.find(
    (t) => t.trimestre.anio === actual.anio && t.trimestre.numero === actual.numero,
  );
  const filas: [string, number, "suma" | "resta" | "total"][] = [
    ["Ingresos (sin IVA)", cuenta.ingresos, "suma"],
    ["Producción DTF", c.costeDtf, "resta"],
    ["Envíos", c.costeEnvios, "resta"],
    ["Coste de la ropa", c.costeTextil, "resta"],
    ["Margen", cuenta.margen, "total"],
    ["Costes fijos", cuenta.costesFijos, "resta"],
    ["Beneficio antes de impuestos", cuenta.bai, "total"],
    [`Sociedades (${numero(d.ajustes.tipo_is, 0)} %)`, cuenta.impuestoSociedades, "resta"],
    ["Beneficio neto", cuenta.beneficioNeto, "total"],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Beneficio neto"
          explicacion="g_resultado"
          valor={eur(cuenta.beneficioNeto)}
          color={cuenta.beneficioNeto < 0 ? "destructive" : "primary"}
          delta={null}
          icon={PiggyBank}
          pie={
            <span className="text-muted-foreground">
              Antes de impuestos {eur(cuenta.bai)}
              {fijos.hastaHoy ? " · hasta hoy" : ""}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Sociedades estimado"
          explicacion="g_sociedades"
          valor={eur(cuenta.impuestoSociedades)}
          delta={null}
          icon={Building2}
          pie={
            <span className="text-muted-foreground">
              Al {numero(d.ajustes.tipo_is, 0)} % del beneficio
            </span>
          }
        />
        <TarjetaKpi
          titulo="Costes fijos"
          explicacion="g_beneficio"
          valor={eur(cuenta.costesFijos)}
          delta={null}
          icon={Landmark}
          pie={<VerDetalle destino={DESTINO_AJUSTES} texto="Ver gastos" />}
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

      {d.gastos.length === 0 && (
        <Nota>
          Sin gastos apuntados, el beneficio no descuenta alquiler, sueldos ni cuotas.{" "}
          <VerDetalle destino={DESTINO_AJUSTES} texto="Apuntar gastos" />
        </Nota>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              Cuenta de resultados
              <Explicacion titulo="Cuenta de resultados" definicion={DEFINICIONES.g_resultado} />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Del periodo, sin IVA. Vendido con IVA: {eur(c.total)}.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {filas.map(([etiqueta, valor, clase]) => (
              <div
                key={etiqueta}
                className={`flex justify-between gap-4 ${
                  clase === "total" ? "border-t pt-1.5 font-semibold" : ""
                }`}
              >
                <span className={clase === "total" ? "" : "text-muted-foreground"}>
                  {clase === "resta" ? "− " : ""}
                  {etiqueta}
                </span>
                <span
                  className={`tabular-nums ${clase === "total" && valor < 0 ? "text-status-cancelado" : ""}`}
                >
                  {eur(valor)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

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
