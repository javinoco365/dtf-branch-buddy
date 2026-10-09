import { useMemo } from "react";
import { Coins, Package, Receipt, Shirt } from "lucide-react";
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
import { eur, numero } from "@/lib/format";
import { useTextilGerencia } from "@/lib/gerencia";
import { ESTADO_CANCELADO, variacion } from "@/dominio/kpis";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { DEFINICIONES } from "@/dominio/definiciones";
import { cifrasGerencia, desglose } from "@/dominio/gerencia";
import { porcentajeMargen } from "@/dominio/margen";
import { ivaSoportado } from "@/dominio/fiscal";
import { productosTextil, resumenStock } from "@/dominio/textil";
import { sumarCantidades, sumarImportes } from "@/dominio/sumatorios";
import type { DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, Nota, VerDetalle } from "./comun";

const SIN_MARCA = "sin-marca";
const FILAS = 10;

export function Textil({ d }: { d: DatosGerencia }) {
  const fuera =
    (d.filtro.canal !== "todos" && d.filtro.canal !== "textil") ||
    (d.filtro.tienda !== "todas" && d.filtro.tienda !== TIENDA_TEXTIL.id);

  const ventas = useMemo(() => d.ventas.filter((v) => v.canal === "textil"), [d.ventas]);
  const previas = useMemo(
    () => d.ventasPrevias.filter((v) => v.canal === "textil"),
    [d.ventasPrevias],
  );
  const ids = useMemo(
    () => ventas.filter((v) => v.estado !== ESTADO_CANCELADO && v.id).map((v) => v.id as string),
    [ventas],
  );
  const datos = useTextilGerencia(d.rango, ids);

  const c = useMemo(() => cifrasGerencia(ventas, 0), [ventas]);
  const p = useMemo(() => cifrasGerencia(previas, 0), [previas]);
  const marcas = useMemo(() => {
    const nombres = new Map<string, string>([
      [SIN_MARCA, "Sin marca"],
      ...(datos.data?.marcas ?? []).map((m) => [m.id, m.nombre] as [string, string]),
    ]);
    return desglose(ventas, (v) => v.marca_id ?? SIN_MARCA, nombres);
  }, [ventas, datos.data]);
  const productos = useMemo(() => productosTextil(datos.data?.lineas ?? [], FILAS), [datos.data]);
  // Solo las prendas que se ven: productosTextil ya llega recortada a FILAS.
  const totalProductos = useMemo(
    () => ({
      unidades: sumarCantidades(productos, (x) => x.unidades),
      importe: sumarImportes(productos, (x) => x.importe),
    }),
    [productos],
  );
  const stock = useMemo(
    () => (datos.data?.stock ? resumenStock(datos.data.stock) : null),
    [datos.data],
  );
  // De toda la lista bajo mínimo, no solo de las FILAS que se pintan.
  const faltanTotal = useMemo(
    () => (stock ? sumarCantidades(stock.bajoMinimo, (a) => a.faltan) : 0),
    [stock],
  );
  const compras = useMemo(
    () => (datos.data?.compras ? ivaSoportado(datos.data.compras) : null),
    [datos.data],
  );

  if (fuera) {
    return (
      <Nota>
        Con estos filtros no entra el textil. Elige «Todas las tiendas» o «Textil personalizado» y
        «Todos los canales» o «Textil».
      </Nota>
    );
  }
  if (datos.error) return <ErrorPestana que="el textil" error={datos.error} />;
  if (!datos.data) return <CargandoPestana />;

  const frente = d.comparacion?.etiqueta;
  const pct = porcentajeMargen(c.margen, c.bruta);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Vendido textil"
          explicacion="g_vendido"
          valor={eur(c.total)}
          frente={frente}
          delta={variacion(c.total, p.total)}
          icon={Shirt}
          pie={
            <VerDetalle
              destino={{ to: "/panel/textil/pedidos", search: {} }}
              texto="Ver pedidos textil"
            />
          }
        />
        <TarjetaKpi
          titulo="Pedidos"
          explicacion="g_pedidos"
          valor={String(c.pedidos)}
          frente={frente}
          delta={variacion(c.pedidos, p.pedidos)}
          icon={Receipt}
          pie={<span className="text-muted-foreground">Ticket medio {eur(c.ticket)}</span>}
        />
        <TarjetaKpi
          titulo="Margen textil"
          explicacion="g_margen"
          valor={eur(c.margen)}
          frente={frente}
          delta={variacion(c.margen, p.margen)}
          icon={Coins}
          pie={
            <span className="text-muted-foreground">
              {pct === null ? "Sin ventas" : `${numero(pct, 1)} % de la bruta`}
              {c.textilSinCoste > 0 && ` · ${c.textilSinCoste} sin salir del almacén`}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Valor del almacén"
          explicacion="g_stock_valor"
          valor={stock ? eur(stock.valor) : "—"}
          delta={null}
          icon={Package}
          pie={
            stock ? (
              <span className="text-muted-foreground">
                Hoy · {numero(stock.unidades, 0)} unidades, {numero(stock.reservadas, 0)} reservadas
              </span>
            ) : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Por marca</CardTitle>
            <p className="text-xs text-muted-foreground">Lo vendido en el periodo, con IVA.</p>
          </CardHeader>
          <CardContent>
            {marcas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin pedidos textil en el periodo.</p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Marca</TableHead>
                    <TableHead className="text-right">Pedidos</TableHead>
                    <TableHead className="text-right">Vendido</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marcas.map((m) => (
                    <TableRow key={m.clave}>
                      <TableCell className="font-medium">{m.nombre}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.pedidos}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(m.vendido)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numero(m.peso, 1)} %
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Las mismas cifras que las tarjetas «Vendido textil» y «Pedidos». */}
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">
                      Total
                      {c.cancelados > 0 &&
                        ` · ${numero(c.cancelados, 0)} ${
                          c.cancelados === 1 ? "cancelado" : "cancelados"
                        } aparte`}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {numero(c.pedidos, 0)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(c.total)}
                    </TableCell>
                    {/* El peso es una parte del total: no se suma. */}
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lo más vendido</CardTitle>
            <p className="text-xs text-muted-foreground">
              Por la descripción de la línea, sin IVA. Los {FILAS} primeros.
            </p>
          </CardHeader>
          <CardContent>
            {productos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin líneas en el periodo.</p>
            ) : (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Prenda</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productos.map((x) => (
                    <TableRow key={x.nombre}>
                      <TableCell className="font-medium">{x.nombre}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numero(x.unidades, 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{eur(x.importe)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Con la lista llena puede haber más prendas: la etiqueta dice que es el top. */}
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">
                      {productos.length < FILAS
                        ? `Total · ${productos.length} ${productos.length === 1 ? "prenda" : "prendas"}`
                        : `Total de las ${FILAS} primeras`}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {numero(totalProductos.unidades, 0)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {eur(totalProductos.importe)}
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
          <CardTitle className="text-base">Almacén</CardTitle>
          <p className="text-xs text-muted-foreground">
            A día de hoy.{" "}
            <VerDetalle destino={{ to: "/panel/textil/stock", search: {} }} texto="Ver stock" />
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                Compras del periodo, sin IVA
                <Explicacion
                  titulo="Compras del periodo"
                  definicion={DEFINICIONES.g_compras_textil}
                />
              </span>
              <span className="tabular-nums">{compras ? eur(compras.base) : "—"}</span>
            </div>
            {compras && compras.sinRegistrar > 0 && (
              <p className="text-xs text-muted-foreground">
                Más {compras.sinRegistrar}{" "}
                {compras.sinRegistrar === 1 ? "compra subida" : "compras subidas"} sin registrar.
              </p>
            )}
          </div>
          {!stock ? (
            <p className="text-sm text-muted-foreground">El almacén textil no está disponible.</p>
          ) : stock.bajoMinimo.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ningún artículo está en su mínimo o por debajo.
            </p>
          ) : (
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>En el mínimo o por debajo</TableHead>
                  <TableHead className="text-right">Quedan</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Faltan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.bajoMinimo.slice(0, FILAS).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {[a.nombre, a.talla, a.color].filter(Boolean).join(" · ")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {numero(Number(a.cantidad ?? 0), 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {numero(Number(a.cantidad_minima ?? 0), 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-status-cancelado">
                      {numero(a.faltan, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {/* Quedan y mínimo mezclan tallas y colores: solo se suma lo que falta. */}
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">
                    {stock.bajoMinimo.length > FILAS
                      ? `Total de los ${numero(stock.bajoMinimo.length, 0)} artículos (se ven ${FILAS})`
                      : `Total · ${stock.bajoMinimo.length} ${
                          stock.bajoMinimo.length === 1 ? "artículo" : "artículos"
                        }`}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right font-bold tabular-nums text-status-cancelado">
                    {numero(faltanTotal, 0)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
