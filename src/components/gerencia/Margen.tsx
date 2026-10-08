import { useMemo } from "react";
import { Coins, Euro, Percent, Wrench } from "lucide-react";
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
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { DEFINICIONES } from "@/dominio/definiciones";
import { tramosGrafica } from "@/dominio/periodos";
import { CANALES, cifrasGerencia } from "@/dominio/gerencia";
import {
  margenPor,
  margenPorMetro,
  margenPorTramos,
  porcentajeMargen,
  type FilaMargen,
} from "@/dominio/margen";
import type { DatosGerencia } from "./destinos";
import { Nota } from "./comun";

const pct = (p: number | null) => (p === null ? "—" : `${numero(p, 1)} %`);

export function Margen({ d }: { d: DatosGerencia }) {
  const frente = d.comparacion?.etiqueta;
  const c = useMemo(() => cifrasGerencia(d.ventas, d.costeMetro), [d.ventas, d.costeMetro]);
  const p = useMemo(
    () => cifrasGerencia(d.ventasPrevias, d.costeMetro),
    [d.ventasPrevias, d.costeMetro],
  );
  const nombresTienda = useMemo(
    () => new Map([...d.tiendas, TIENDA_TEXTIL].map((t) => [t.id, t.nombre])),
    [d.tiendas],
  );
  const porTienda = useMemo(
    () => margenPor(d.ventas, (v) => v.tienda_id, nombresTienda, d.costeMetro),
    [d.ventas, nombresTienda, d.costeMetro],
  );
  const porCanal = useMemo(
    () =>
      margenPor(
        d.ventas,
        (v) => v.canal,
        new Map(CANALES.map((x) => [x.valor, x.etiqueta])),
        d.costeMetro,
      ),
    [d.ventas, d.costeMetro],
  );
  const tramos = useMemo(() => {
    const { por, tramos } = tramosGrafica(d.rango);
    return { por, filas: margenPorTramos(d.ventas, tramos, d.costeMetro, d.gastosDelGrupo, d.hoy) };
  }, [d.rango, d.ventas, d.costeMetro, d.gastosDelGrupo, d.hoy]);
  const metro = useMemo(() => margenPorMetro(d.ventas, d.costeMetro), [d.ventas, d.costeMetro]);

  const sinCosteMetro = d.costeMetro === 0 && c.costeDtf === 0 && c.metros > 0;
  const porcentaje = porcentajeMargen(c.margen, c.bruta);
  const porcentajePrevio = porcentajeMargen(p.margen, p.bruta);
  const conGastos = d.gastosDelGrupo.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Facturación bruta"
          explicacion="g_bruta"
          valor={eur(c.bruta)}
          frente={frente}
          delta={variacion(c.bruta, p.bruta)}
          icon={Euro}
        />
        <TarjetaKpi
          titulo="Coste"
          explicacion="g_coste"
          valor={eur(c.coste)}
          frente={frente}
          delta={variacion(c.coste, p.coste)}
          deltaInverso
          icon={Wrench}
          pie={
            <span className="text-muted-foreground">
              DTF {eur(c.costeDtf)} · Textil {eur(c.costeTextil)}
              {c.envios > 0 &&
                ` · Envíos cobrados ${eur(c.envios)}, aparte de la bruta y del coste`}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Margen"
          explicacion="g_margen"
          valor={eur(c.margen)}
          frente={frente}
          delta={variacion(c.margen, p.margen)}
          icon={Coins}
        />
        <TarjetaKpi
          titulo="Margen sobre ventas"
          explicacion="g_margen_pct"
          valor={pct(porcentaje)}
          frente={frente}
          delta={
            porcentaje !== null && porcentajePrevio !== null
              ? variacion(porcentaje, porcentajePrevio)
              : null
          }
          icon={Percent}
        />
      </div>

      {sinCosteMetro && (
        <Nota>
          Falta el coste por metro en Configuración › Empresa: el DTF sale sin coste y su margen es
          toda su facturación.
        </Nota>
      )}
      {c.textilSinCoste > 0 && (
        <Nota>
          {c.textilSinCoste}{" "}
          {c.textilSinCoste === 1
            ? "pedido textil todavía no ha salido del almacén y va"
            : "pedidos textil todavía no han salido del almacén y van"}{" "}
          sin coste: su margen sale más alto de lo que será.
        </Nota>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <TablaMargen titulo="Por tienda" columna="Tienda" filas={porTienda} />
        <TablaMargen titulo="Por canal" columna="Canal" filas={porCanal} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {tramos.por === "dia" ? "Día a día" : "Mes a mes"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Sin IVA.
            {conGastos
              ? " Los gastos fijos, repartidos por días y solo hasta hoy."
              : d.grupo === "b"
                ? " No hay gastos sin justificante."
                : " Pon los gastos fijos en Ajustes para ver el beneficio."}
          </p>
        </CardHeader>
        <CardContent>
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>{tramos.por === "dia" ? "Día" : "Mes"}</TableHead>
                <TableHead className="text-right">Bruta</TableHead>
                <TableHead className="text-right">Coste</TableHead>
                <TableHead className="text-right">Margen</TableHead>
                {conGastos && <TableHead className="text-right">Gastos fijos</TableHead>}
                {conGastos && <TableHead className="text-right">Beneficio</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tramos.filas.map((t) => (
                <TableRow key={t.etiqueta}>
                  <TableCell className="font-medium">{t.etiqueta}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(t.bruta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(t.coste)}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(t.margen)}</TableCell>
                  {conGastos && (
                    <TableCell className="text-right tabular-nums">{eur(t.gastos)}</TableCell>
                  )}
                  {conGastos && (
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        t.beneficio < 0 ? "text-status-cancelado" : ""
                      }`}
                    >
                      {eur(t.beneficio)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            El metro de DTF
            <Explicacion titulo="El metro de DTF" definicion={DEFINICIONES.g_margen_metro} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {!metro ? (
            <p className="text-muted-foreground">Sin metros vendidos con estos filtros.</p>
          ) : (
            (
              [
                ["Precio medio del metro", metro.precio],
                ["Coste medio del metro", metro.coste],
                ["Queda de cada metro", metro.margen],
              ] as const
            ).map(([etiqueta, valor], i) => (
              <div
                key={etiqueta}
                className={`flex justify-between gap-4 ${i === 2 ? "border-t pt-1.5 font-semibold" : ""}`}
              >
                <span className={i === 2 ? "" : "text-muted-foreground"}>{etiqueta}</span>
                <span className="tabular-nums">{eur(valor)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TablaMargen({
  titulo,
  columna,
  filas,
}: {
  titulo: string;
  columna: string;
  filas: FilaMargen[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="text-xs text-muted-foreground">Sin IVA, de más a menos margen.</p>
      </CardHeader>
      <CardContent>
        {filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin pedidos con estos filtros.</p>
        ) : (
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>{columna}</TableHead>
                <TableHead className="text-right">Bruta</TableHead>
                <TableHead className="text-right">Coste</TableHead>
                <TableHead className="text-right">Margen</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={f.clave}>
                  <TableCell className="font-medium">{f.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(f.bruta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(f.coste)}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(f.margen)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(f.porcentaje)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
