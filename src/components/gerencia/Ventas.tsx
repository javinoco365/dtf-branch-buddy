import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { eur, metros, numero } from "@/lib/format";
import { useLineasPeriodo } from "@/lib/periodo";
import { calcularKpis, topPorMetros, type KpisPeriodo } from "@/dominio/kpis";
import { sumarCantidades } from "@/dominio/sumatorios";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { CANALES, desglose, porDiaSemana, type FilaDesglose } from "@/dominio/gerencia";
import type { DatosGerencia } from "./destinos";

const estiloTooltip = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
};

export function Ventas({ d }: { d: DatosGerencia }) {
  const nombresTienda = useMemo(
    () => new Map([...d.tiendas, TIENDA_TEXTIL].map((t) => [t.id, t.nombre])),
    [d.tiendas],
  );
  const porTienda = useMemo(
    () =>
      desglose(
        d.ventas,
        (v) => v.tienda_id,
        nombresTienda,
        d.filtro.tienda === "todas" ? [...d.tiendas.map((t) => t.id), TIENDA_TEXTIL.id] : [],
      ),
    [d.ventas, nombresTienda, d.filtro.tienda, d.tiendas],
  );
  const porCanal = useMemo(
    () =>
      desglose(
        d.ventas,
        (v) => v.canal,
        new Map(CANALES.map((c) => [c.valor, c.etiqueta])),
        d.filtro.canal === "todos" ? CANALES.map((c) => c.valor) : [],
      ),
    [d.ventas, d.filtro.canal],
  );
  const semana = useMemo(() => porDiaSemana(d.ventas), [d.ventas]);
  // El pie de «Por tienda» y «Por canal»: el mismo cálculo con el que desglose
  // saca el peso, así las dos tablas dan el mismo total y el 100 % es este.
  const total = useMemo(() => calcularKpis(d.ventas), [d.ventas]);

  // Los productos salen de las líneas de los pedidos de tienda: el textil no
  // se vende por metros. El filtro de canal no llega a las líneas.
  const soloTextil = d.filtro.canal === "textil" || d.filtro.tienda === TIENDA_TEXTIL.id;
  const lineas = useLineasPeriodo({
    ...d.rango,
    tiendaId: d.filtro.tienda !== "todas" && !soloTextil ? d.filtro.tienda : undefined,
  });
  const productos = useMemo(() => topPorMetros(lineas.data ?? [], 10), [lineas.data]);
  // Solo los productos que se ven: topPorMetros ya llega recortada a 10.
  const metrosProductos = useMemo(() => sumarCantidades(productos, (p) => p.metros), [productos]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TablaDesglose titulo="Por tienda" columna="Tienda" filas={porTienda} total={total} />
        <TablaDesglose titulo="Por canal" columna="Canal" filas={porCanal} total={total} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por día de la semana</CardTitle>
            <p className="text-xs text-muted-foreground">
              Lo vendido según el día en que se hizo el pedido.
            </p>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={semana}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => v.slice(0, 3)}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  formatter={(v: number, nombre) => [
                    eur(v),
                    nombre === "vendido" ? "Vendido" : nombre,
                  ]}
                  contentStyle={estiloTooltip}
                />
                <Bar dataKey="vendido" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Productos más vendidos por metros</CardTitle>
            <p className="text-xs text-muted-foreground">
              Pedidos de tienda del periodo
              {d.filtro.canal === "web" || d.filtro.canal === "manual"
                ? ", web y manuales juntos"
                : ""}
              .
            </p>
          </CardHeader>
          <CardContent>
            {soloTextil ? (
              <p className="text-sm text-muted-foreground">
                El textil no se vende por metros: no tiene productos aquí.
              </p>
            ) : productos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {lineas.isPending
                  ? "Cargando…"
                  : "Los pedidos de este periodo no tienen líneas en metros."}
              </p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Metros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productos.map((p) => (
                    <TableRow key={p.producto}>
                      <TableCell>{p.producto}</TableCell>
                      <TableCell className="text-right tabular-nums">{metros(p.metros)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Con la lista llena puede haber más productos: la etiqueta dice que es el top. */}
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">
                      {productos.length < 10
                        ? `Total · ${productos.length} ${productos.length === 1 ? "producto" : "productos"}`
                        : "Total de los 10 primeros"}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {metros(metrosProductos)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TablaDesglose({
  titulo,
  columna,
  filas,
  total,
}: {
  titulo: string;
  columna: string;
  filas: FilaDesglose[];
  /** El total de las ventas de las que salen las filas (calcularKpis). */
  total: KpisPeriodo;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        {filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin pedidos con estos filtros.</p>
        ) : (
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>{columna}</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Vendido</TableHead>
                <TableHead className="text-right">Metros</TableHead>
                <TableHead className="text-right">Ticket</TableHead>
                <TableHead className="text-right">Peso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={f.clave}>
                  <TableCell className="font-medium">{f.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.pedidos}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(f.vendido)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.metros > 0 ? metros(f.metros) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.pedidos > 0 ? eur(f.ticket) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{numero(f.peso, 1)} %</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">
                  Total
                  {total.cancelados > 0 &&
                    ` · ${numero(total.cancelados, 0)} ${
                      total.cancelados === 1 ? "cancelado" : "cancelados"
                    } aparte`}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {numero(total.pedidos, 0)}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {eur(total.total)}
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums">
                  {total.metros > 0 ? metros(total.metros) : "—"}
                </TableCell>
                {/* El ticket es una media: el de todos, lo vendido entre los pedidos. */}
                <TableCell className="text-right font-bold tabular-nums">
                  {total.pedidos > 0 ? eur(total.ticket) : "—"}
                </TableCell>
                {/* El peso es una parte del total: no se suma. */}
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
