import { useMemo } from "react";
import { CheckCircle2, Hourglass, Percent, Send } from "lucide-react";
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
import { useComercial } from "@/lib/gerencia";
import { variacion } from "@/dominio/kpis";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { DEFINICIONES } from "@/dominio/definiciones";
import type { FiltroGerencia } from "@/dominio/gerencia";
import {
  embudoPresupuestos,
  presupuestosPendientes,
  type PresupuestoResumen,
} from "@/dominio/comercial";
import { destinoPresupuestos, type DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, Nota, NotaGrupo, VerDetalle } from "./comun";

const FILAS = 10;

/**
 * Los presupuestos con los filtros de arriba. No tienen canal propio: los de
 * tienda acaban en pedidos manuales, los del textil en el textil, y la web
 * no hace presupuestos.
 */
function filtrar(lista: readonly PresupuestoResumen[], f: FiltroGerencia) {
  return lista.filter(
    (p) =>
      (f.tienda === "todas" || p.tienda_id === f.tienda) &&
      (f.canal === "todos" ||
        (f.canal === "textil" && p.tienda_id === TIENDA_TEXTIL.id) ||
        (f.canal === "manual" && p.tienda_id !== TIENDA_TEXTIL.id)),
  );
}

export function Comercial({ d }: { d: DatosGerencia }) {
  const actual = useComercial(d.rango);
  const previa = useComercial(d.comparacion?.previo ?? d.rango);
  const nombres = useMemo(
    () => new Map([...d.tiendas, TIENDA_TEXTIL].map((t) => [t.id, t.nombre])),
    [d.tiendas],
  );

  const e = useMemo(
    () => embudoPresupuestos(filtrar(actual.data?.periodo ?? [], d.filtro)),
    [actual.data, d.filtro],
  );
  const ep = useMemo(
    () =>
      d.comparacion && previa.data
        ? embudoPresupuestos(filtrar(previa.data.periodo, d.filtro))
        : null,
    [d.comparacion, previa.data, d.filtro],
  );
  const pend = useMemo(
    () => presupuestosPendientes(filtrar(actual.data?.enviados ?? [], d.filtro), d.hoy),
    [actual.data, d.filtro, d.hoy],
  );

  if (d.filtro.canal === "web") {
    return (
      <Nota>
        Los pedidos de la web no pasan por presupuesto. Elige «Todos los canales», «Manual» o
        «Textil».
      </Nota>
    );
  }
  if (actual.error) return <ErrorPestana que="los presupuestos" error={actual.error} />;
  if (!actual.data) return <CargandoPestana />;

  const frente = d.comparacion?.etiqueta;

  return (
    <div className="space-y-4">
      <NotaGrupo
        grupo={d.grupo}
        texto="Los presupuestos no llevan factura: esta pestaña no se separa en A y B."
      />
      {!actual.data.tiendasDisponible && (
        <Nota>
          Los presupuestos de las tiendas todavía no están en la base de datos: falta aplicar su
          migración. Abajo solo salen los del textil.
        </Nota>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Enviados"
          explicacion="g_presupuestos_enviados"
          valor={String(e.enviados.n)}
          frente={frente}
          delta={ep ? variacion(e.enviados.n, ep.enviados.n) : null}
          icon={Send}
          pie={<span className="text-muted-foreground">Por {eur(e.enviados.importe)}</span>}
        />
        <TarjetaKpi
          titulo="Aceptados"
          explicacion="g_presupuestos_aceptados"
          valor={String(e.aceptados.n)}
          frente={frente}
          delta={ep ? variacion(e.aceptados.n, ep.aceptados.n) : null}
          icon={CheckCircle2}
          pie={<span className="text-muted-foreground">Por {eur(e.aceptados.importe)}</span>}
        />
        <TarjetaKpi
          titulo="Conversión"
          explicacion="g_conversion"
          valor={e.conversion === null ? "—" : `${numero(e.conversion, 1)} %`}
          frente={frente}
          delta={
            e.conversion !== null && ep?.conversion != null
              ? variacion(e.conversion, ep.conversion)
              : null
          }
          icon={Percent}
          pie={
            e.conversionImporte !== null ? (
              <span className="text-muted-foreground">
                En importe, {numero(e.conversionImporte, 1)} %
              </span>
            ) : undefined
          }
        />
        <TarjetaKpi
          titulo="Días hasta el pedido"
          explicacion="g_dias_a_pedido"
          valor={e.diasAPedido ? `${numero(e.diasAPedido.media, 1)} días` : "—"}
          frente={frente}
          delta={
            e.diasAPedido && ep?.diasAPedido
              ? variacion(e.diasAPedido.media, ep.diasAPedido.media)
              : null
          }
          deltaInverso
          icon={Hourglass}
          pie={
            e.diasAPedido ? (
              <span className="text-muted-foreground">
                De {e.diasAPedido.n} {e.diasAPedido.n === 1 ? "confirmado" : "confirmados"} como
                pedido
              </span>
            ) : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Presupuestos del periodo</CardTitle>
            <p className="text-xs text-muted-foreground">Por la fecha del presupuesto, con IVA.</p>
          </CardHeader>
          <CardContent>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Presupuestos</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ["Creados", e.creados],
                    ["Borradores, sin enviar", e.borradores],
                    ["Enviados", e.enviados],
                    ["Aceptados", e.aceptados],
                    ["Rechazados", e.rechazados],
                    ["Sin respuesta", e.sinRespuesta],
                  ] as const
                ).map(([etiqueta, c]) => (
                  <TableRow key={etiqueta}>
                    <TableCell className="font-medium">{etiqueta}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(c.importe)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              Esperando respuesta
              <Explicacion
                titulo="Esperando respuesta"
                definicion={DEFINICIONES.g_presupuestos_pendientes}
              />
            </CardTitle>
            <p className="text-xs text-muted-foreground">A día de hoy, sea cual sea su fecha.</p>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">
                En plazo ({pend.vigentes.n} {pend.vigentes.n === 1 ? "presupuesto" : "presupuestos"}
                )
              </span>
              <span className="font-semibold tabular-nums">{eur(pend.vigentes.importe)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">
                Caducados sin respuesta ({pend.caducados.n})
              </span>
              <span className="tabular-nums">{eur(pend.caducados.importe)}</span>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              Un presupuesto caducado sigue «enviado» en su pantalla: márcalo como aceptado o
              rechazado para que deje de contar aquí.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Los que más pueden entrar</CardTitle>
          <p className="text-xs text-muted-foreground">
            Enviados y en plazo, de más a menos importe.
            {pend.lista.length > FILAS && ` Los ${FILAS} primeros de ${pend.lista.length}.`}
          </p>
        </CardHeader>
        <CardContent>
          {pend.lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ningún presupuesto enviado espera respuesta en plazo.
            </p>
          ) : (
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Presupuesto</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tienda</TableHead>
                  <TableHead>Vale hasta</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pend.lista.slice(0, FILAS).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <VerDetalle destino={destinoPresupuestos(p.tienda_id)} texto={p.numero} />
                    </TableCell>
                    <TableCell>{p.cliente_nombre || "—"}</TableCell>
                    <TableCell>{nombres.get(p.tienda_id) ?? "—"}</TableCell>
                    <TableCell>
                      {fechaCorta(p.validoHasta)}
                      <span className="text-muted-foreground">
                        {" "}
                        ·{" "}
                        {p.diasRestantes === 0
                          ? "último día"
                          : `${p.diasRestantes} ${p.diasRestantes === 1 ? "día" : "días"}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(Number(p.total ?? 0))}
                    </TableCell>
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
