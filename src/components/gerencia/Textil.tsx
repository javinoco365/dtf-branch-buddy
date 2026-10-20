import { useMemo, useState } from "react";
import { AlertTriangle, Check, Coins, Package, Receipt, Shirt } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import {
  resumenControlesAlmacen,
  useControlesAlmacen,
  useMovimientosAlmacen,
  useProformasPendientes,
  useTextilGerencia,
  type DatosMovimientosAlmacen,
} from "@/lib/gerencia";
import { AVISO_MIGRACION_ESCANER } from "@/lib/escaner-textil";
import { diaDeFecha } from "@/dominio/periodos";
import { cuentaAlmacen, valorAFecha, type CuentaAlmacen } from "@/dominio/cuenta-almacen";
import type { FilaControlCompra, ResumenControles } from "@/dominio/controles-almacen";
import type { Partida } from "@/dominio/tipos-textil";
import { ESTADO_CANCELADO, variacion } from "@/dominio/kpis";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { DEFINICIONES } from "@/dominio/definiciones";
import { cifrasGerencia, desglose } from "@/dominio/gerencia";
import { porcentajeMargen } from "@/dominio/margen";
import { ivaSoportado } from "@/dominio/fiscal";
import { productosTextil, resumenStock } from "@/dominio/textil";
import { proformasSinFactura, resumenProformas } from "@/dominio/proformas";
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
  // Las proformas sin factura, de cualquier fecha (no dependen del periodo).
  const { data: filasProformas } = useProformasPendientes();
  const proformas = useMemo(
    () => (filasProformas ? resumenProformas(proformasSinFactura(filasProformas, d.hoy)) : null),
    [filasProformas, d.hoy],
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
            {proformas && proformas.proformas > 0 && (
              <p className="text-xs text-muted-foreground">
                {proformas.proformas} {proformas.proformas === 1 ? "proforma" : "proformas"} sin
                factura ({eur(proformas.importe)}): no cuentan en las compras hasta que llegue su
                factura.{" "}
                <VerDetalle
                  destino={{
                    to: "/panel/textil/compras",
                    search: { documento: "proformas_pendientes" },
                  }}
                  texto="Ver"
                />
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

      <AlmacenDelPeriodo rango={d.rango} hoy={d.hoy} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cuenta y controles del almacén
// ---------------------------------------------------------------------------

/** La cuenta del almacén del periodo y sus controles: no dependen de tienda ni canal. */
function AlmacenDelPeriodo({ rango, hoy }: { rango: { desde: Date; hasta: Date }; hoy: Date }) {
  const movs = useMovimientosAlmacen();
  const controles = useControlesAlmacen(rango);
  const resumen = useMemo(
    () => resumenControlesAlmacen(controles.data, movs.data?.movimientos, hoy),
    [controles.data, movs.data, hoy],
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CuentaDelAlmacen rango={rango} datos={movs.data} error={movs.error} />
      <ControlesDelAlmacen
        disponible={controles.data ? controles.data.disponible : null}
        filas={controles.data?.disponible ? controles.data.compras.filas : []}
        resumen={resumen}
        error={controles.error}
      />
    </div>
  );
}

const unidades = (p: Partida) => numero(p.unidades, 0);

function CuentaDelAlmacen({
  rango,
  datos,
  error,
}: {
  rango: { desde: Date; hasta: Date };
  datos: DatosMovimientosAlmacen | null | undefined;
  error: Error | null;
}) {
  const desde = diaDeFecha(rango.desde);
  const hasta = diaDeFecha(rango.hasta);
  const [fecha, setFecha] = useState("");
  const cuenta = useMemo<CuentaAlmacen | null>(
    () => (datos ? cuentaAlmacen(datos.movimientos, desde, hasta) : null),
    [datos, desde, hasta],
  );
  const diaValor = fecha || hasta;
  const aFecha = useMemo(
    () =>
      datos && /^\d{4}-\d{2}-\d{2}$/.test(diaValor)
        ? valorAFecha(datos.movimientos, diaValor)
        : null,
    [datos, diaValor],
  );

  const filas: [string, Partida, boolean][] = cuenta
    ? [
        [`Existencias al ${fechaCorta(desde)}`, cuenta.inicial, true],
        ["+ Compras", cuenta.compras, false],
        ["+ Altas con existencias", cuenta.altas, false],
        ["+ Devoluciones de clientes", cuenta.devolucionesCliente, false],
        ["− Coste de lo vendido", cuenta.ventas, false],
        ["− Mermas", cuenta.mermas, false],
        ["− Devoluciones a proveedores", cuenta.devolucionesProveedor, false],
        ["± Ajustes de inventario", cuenta.ajustes, false],
      ]
    : [];
  const descuadre =
    cuenta && (Math.abs(cuenta.descuadre.valor) >= 0.005 || cuenta.descuadre.unidades !== 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Cuenta del almacén
          <Explicacion titulo="Cuenta del almacén" definicion={DEFINICIONES.g_almacen_cuenta} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Del periodo, a precio de compra. Por la fecha de cada movimiento.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-destructive">
            No se han podido leer los movimientos del almacén: {error.message}
          </p>
        ) : datos === undefined ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : datos === null || !cuenta ? (
          <p className="text-sm text-muted-foreground">El almacén textil no está disponible.</p>
        ) : datos.movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin movimientos en el almacén textil todavía.
          </p>
        ) : (
          <>
            {!datos.conFecha && (
              <p className="text-xs text-status-pendiente">
                {AVISO_MIGRACION_ESCANER} Mientras tanto, cada movimiento cuenta el día en que se
                apuntó: una compra, el de su registro y no el de la factura.
              </p>
            )}
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map(([etiqueta, p, fuerte]) => (
                  <TableRow key={etiqueta} className={fuerte ? "font-semibold" : ""}>
                    <TableCell className={fuerte ? "" : "text-muted-foreground"}>
                      {etiqueta}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{unidades(p)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(p.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">= Existencias al {fechaCorta(hasta)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {unidades(cuenta.final)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(cuenta.final.valor)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {descuadre && (
              <p className="flex items-start gap-1.5 text-xs text-status-cancelado">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                La cuenta no cierra: descuadre de {unidades(cuenta.descuadre)} unidades y{" "}
                {eur(cuenta.descuadre.valor)}.
              </p>
            )}
            <div className="flex justify-between gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                Mermas y ajustes que van a Resultados
                <Explicacion
                  titulo="Mermas y ajustes de almacén"
                  definicion={DEFINICIONES.g_almacen_perdidas}
                />
              </span>
              <span className="tabular-nums">{eur(cuenta.perdidas)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
              <label htmlFor="almacen-valor-fecha" className="text-muted-foreground">
                Valor del almacén según el libro al
              </label>
              <div className="flex items-center gap-3 max-md:w-full max-md:justify-between">
                <Input
                  id="almacen-valor-fecha"
                  type="date"
                  className="h-8 w-40"
                  value={diaValor}
                  onChange={(e) => setFecha(e.target.value)}
                />
                <span className="tabular-nums font-medium">
                  {aFecha ? `${unidades(aFecha)} uds · ${eur(aFecha.valor)}` : "—"}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** ✓ en verde si da 0; la cifra en rojo si no; «No comprobado» si no se pudo leer. */
function Comprobacion({
  etiqueta,
  valor,
  enCero,
  detalle,
}: {
  etiqueta: string;
  valor: string | null;
  enCero: boolean;
  detalle?: string;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        {etiqueta}
        {detalle && <span className="block text-xs">{detalle}</span>}
      </span>
      {valor === null ? (
        <span className="text-muted-foreground">No comprobado</span>
      ) : enCero ? (
        <span className="inline-flex items-center gap-1 tabular-nums text-status-completado">
          <Check className="h-4 w-4" /> {valor}
        </span>
      ) : (
        <span className="font-semibold tabular-nums text-status-cancelado">{valor}</span>
      )}
    </div>
  );
}

function ControlesDelAlmacen({
  disponible,
  filas,
  resumen,
  error,
}: {
  disponible: boolean | null;
  filas: FilaControlCompra[];
  resumen: ResumenControles | null;
  error: Error | null;
}) {
  const conDescuadre = filas.filter((f) => f.estado === "descuadre");
  const cuenta = (n: number | null) => (n === null ? null : numero(n, 0));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Controles del almacén
          <Explicacion
            titulo="Controles del almacén"
            definicion={DEFINICIONES.g_almacen_controles}
          />
        </CardTitle>
        <p className="text-xs text-muted-foreground">Tienen que dar 0.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-destructive">
            No se han podido leer los controles: {error.message}
          </p>
        ) : disponible === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !disponible || !resumen ? (
          <p className="text-xs text-status-pendiente">{AVISO_MIGRACION_ESCANER}</p>
        ) : (
          <>
            {!resumen.todoEnCero && (
              <p className="flex items-start gap-1.5 text-xs text-status-cancelado">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Algún control no da 0 o no se ha podido comprobar: míralo antes de fiarte de las
                cifras del almacén.
              </p>
            )}
            <div className="space-y-2">
              <Comprobacion
                etiqueta="Compras textil frente a sus entradas"
                valor={
                  resumen.comprasConDescuadre === 0
                    ? eur(resumen.diferenciaCompras)
                    : `${eur(resumen.diferenciaCompras)} · ${resumen.comprasConDescuadre} con descuadre`
                }
                enCero={
                  resumen.comprasConDescuadre === 0 && Math.abs(resumen.diferenciaCompras) < 0.005
                }
                detalle={
                  resumen.comprasSinEnlace > 0
                    ? `${resumen.comprasSinEnlace} ${
                        resumen.comprasSinEnlace === 1
                          ? "anterior al enlace: no se puede comprobar"
                          : "anteriores al enlace: no se pueden comprobar"
                      }`
                    : undefined
                }
              />
              {resumen.proformasSinFactura > 0 && (
                <p className="text-xs text-muted-foreground">
                  {resumen.proformasSinFactura}{" "}
                  {resumen.proformasSinFactura === 1 ? "proforma" : "proformas"} sin factura: se
                  comprueban contra sus propias entradas hasta que llegue su factura. No es un
                  descuadre.
                </p>
              )}
              <Comprobacion
                etiqueta="Variantes descuadradas"
                valor={cuenta(resumen.variantesDescuadradas)}
                enCero={resumen.variantesDescuadradas === 0}
              />
              <Comprobacion
                etiqueta="Reservas descuadradas"
                valor={cuenta(resumen.reservasDescuadradas)}
                enCero={resumen.reservasDescuadradas === 0}
              />
            </div>
            {conDescuadre.length > 0 && (
              <Table movil="tarjetas">
                <TableHeader>
                  <TableRow>
                    <TableHead>Compra con descuadre</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Entradas</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conDescuadre.map((f) => (
                    <TableRow key={f.compra.id}>
                      <TableCell className="font-medium">
                        {f.tipo === "par"
                          ? [
                              f.compra.proveedor,
                              `Factura n.º ${f.compra.numero ?? "(sin número)"} con su proforma n.º ${
                                f.proforma?.numero ?? "(sin número)"
                              }`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : [
                              f.compra.proveedor,
                              f.tipo === "proforma_sin_factura" && f.compra.numero
                                ? `Proforma n.º ${f.compra.numero}`
                                : f.compra.numero,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Sin número"}
                        <span className="block text-xs text-muted-foreground">
                          {fechaCorta(f.compra.fecha)}
                          {f.tipo === "par" && f.sinAplicar !== 0 && (
                            <> · sin aplicar {eur(f.sinAplicar)}</>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{eur(f.base)}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(f.entradas)}</TableCell>
                      <TableCell className="text-right tabular-nums text-status-cancelado">
                        {eur(f.diferencia)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Valor según caché − valor según libro:{" "}
              <span className="tabular-nums">
                {resumen.diferenciaValorCache === null ? "—" : eur(resumen.diferenciaValorCache)}
              </span>
              . Informativo: con el coste medio solo lo mueven los redondeos y las variantes que
              llegaron a quedar en negativo. Unos céntimos son normales.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
