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
import { Explicacion } from "@/components/Explicacion";
import { cn } from "@/lib/utils";
import { eur, eurConSigno, fechaCorta, metros, numero } from "@/lib/format";
import { DEFINICIONES, type ClaveDefinicion } from "@/dominio/definiciones";
import type { AjustesJornada, GastoDelRango } from "@/dominio/gerencia";
import type { CifrasNegocio, Margenes, Resumen } from "@/dominio/resumen-diario";
import { Linea } from "./Esquema";
import {
  dondeSeCorrige,
  etiquetaGasto,
  horas,
  porcentaje,
  textoCargo,
  textoVigencia,
} from "@/lib/resumen-diario-textos";
import { costesDelPeriodo, proporcion } from "@/dominio/resumen-diario";

/**
 * Página 2: todo desglosado. Lo pedido frente a lo realizado, la producción,
 * el dinero, cada negocio con todas sus cifras y, si el periodo tiene varios
 * días, el día a día.
 */
export function Desglose({
  r,
  ajustes,
  acciones,
  gastos,
}: {
  r: Resumen;
  ajustes: AjustesJornada;
  /** Los gastos fijos del periodo uno a uno; nulo mientras cargan. */
  gastos: readonly GastoDelRango[] | null;
  /** Lo que se puede hacer con los pedidos sin fecha (recuperarlos de la web). */
  acciones?: React.ReactNode;
}) {
  const t = r.total;
  return (
    <div className="space-y-4">
      <Seccion titulo="Lo pedido y lo realizado">
        <PedidoRealizado t={t} />
        <p className="mt-2 text-xs text-muted-foreground">
          «Pedido»: los pedidos con fecha en el periodo. «Realizado»: los que se hicieron en el
          periodo, fueran del día que fueran (los que entran después de las {ajustes.hora_corte} se
          hacen al día siguiente).
        </p>
      </Seccion>

      <div className="grid gap-4 md:grid-cols-2">
        <Seccion titulo="Producción">
          <div className="space-y-2 text-sm">
            <Linea etiqueta="Metros impresos" valor={metros(t.realizado.metrosImpresos)} />
            <Linea
              etiqueta="Capacidad de la máquina"
              valor={metros(r.capacidad.metros)}
              nota={`${numero(ajustes.metros_hora, 0)} m/h, ${ajustes.jornada_inicio}–${ajustes.jornada_fin}, ${r.capacidad.dias} ${r.capacidad.dias === 1 ? "día" : "días"}`}
            />
            <Linea etiqueta="Uso de la máquina" valor={porcentaje(r.capacidad.uso)} />
            <Linea
              etiqueta="En cola al cerrar"
              valor={`${t.cola.pedidos} · ${metros(t.cola.metros)}`}
              conDefinicion="rd_cola"
            />
            <Linea
              etiqueta="Fuera de hora"
              valor={String(t.pedido.fueraDeHora)}
              nota={`desde las ${ajustes.hora_corte}`}
            />
            <Linea
              etiqueta="Del pedido a realizado"
              valor={horas(t.realizado.horasMedias)}
              nota="de media"
            />
            <Linea etiqueta="Cancelados" valor={String(t.pedido.cancelados)} />
            <Linea
              etiqueta="Enviados sin fecha de realizado"
              valor={String(t.sinFecha)}
              negativo={t.sinFecha > 0}
            />
            {t.sinFecha > 0 && acciones}
          </div>
        </Seccion>
        <Seccion titulo="Dinero">
          <div className="space-y-2 text-sm">
            <Linea etiqueta="Vendido (con IVA)" valor={eur(t.pedido.vendido)} />
            <Linea etiqueta="Facturado (base)" valor={eur(t.facturado)} />
            <Linea etiqueta="Cobrado" valor={eur(t.cobrado)} />
            <Linea
              etiqueta="De lo pedido, por cobrar"
              valor={eur(t.pedido.pendiente)}
              negativo={t.pedido.pendiente > 0}
            />
            <Linea
              etiqueta="Hechos sin cobrar"
              valor={`${t.realizado.sinCobrar} · ${eur(t.realizado.importeSinCobrar)}`}
              negativo={t.realizado.sinCobrar > 0}
            />
            <Linea etiqueta="Ticket medio" valor={eur(t.pedido.ticket)} />
            <Linea
              etiqueta="Precio medio del metro"
              valor={t.pedido.euroMetro == null ? "—" : eur(t.pedido.euroMetro)}
              nota="sin IVA ni envío"
            />
            <Linea
              etiqueta="Margen por metro"
              valor={t.pedido.margenMetro == null ? "—" : eur(t.pedido.margenMetro)}
              nota="sin envíos"
            />
          </div>
        </Seccion>
      </div>

      <Seccion titulo="Gastos del periodo">
        <Gastos r={r} gastos={gastos} />
      </Seccion>

      <Seccion titulo="Cada negocio">
        <TablaDetalle r={r} />
      </Seccion>

      {r.porDia.length > 0 && (
        <Seccion titulo="Día a día">
          <DiaADia r={r} />
        </Seccion>
      )}

      <p className="text-xs text-muted-foreground">
        Margen neto = facturación bruta (sin IVA ni envío) − producción (metros × coste por metro
        congelado en el pedido; en textil, la ropa que salió del almacén) + envíos cobrados − coste
        de los envíos. Un envío sin coste real apuntado se estima a{" "}
        {eur(ajustes.coste_envio_defecto)}. Los gastos fijos no están en el margen: se restan en el
        beneficio.
      </p>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type FilaComparada = {
  etiqueta: string;
  valor: (m: Margenes) => string;
  fuerte?: boolean;
  negativo?: (m: Margenes) => boolean;
  definicion?: ClaveDefinicion;
};

const FILAS: FilaComparada[] = [
  { etiqueta: "Pedidos", valor: (m) => String(m.pedidos) },
  { etiqueta: "Metros", valor: (m) => metros(m.metros) },
  { etiqueta: "Vendido (con IVA)", valor: (m) => eur(m.vendido) },
  { etiqueta: "Facturación bruta (sin IVA ni envío)", valor: (m) => eur(m.bruta) },
  { etiqueta: "− Producción", valor: (m) => resta(m.costeProduccion) },
  {
    etiqueta: "Margen sin envíos",
    valor: (m) => eur(m.margenSinEnvios),
    fuerte: true,
    negativo: (m) => m.margenSinEnvios < 0,
    definicion: "rd_margen_sin_envios",
  },
  { etiqueta: "+ Envíos cobrados", valor: (m) => eur(m.enviosCobrados) },
  {
    etiqueta: "− Coste de los envíos",
    valor: (m) =>
      `${resta(m.costeEnvios)}${m.enviosEstimados ? ` (${m.enviosEstimados} ${m.enviosEstimados === 1 ? "estimado" : "estimados"})` : ""}`,
  },
  {
    etiqueta: "Resultado de los envíos",
    valor: (m) => eurConSigno(m.resultadoEnvios),
    negativo: (m) => m.resultadoEnvios < 0,
  },
  {
    etiqueta: "Margen neto",
    valor: (m) => eur(m.margenConEnvios),
    fuerte: true,
    negativo: (m) => m.margenConEnvios < 0,
    definicion: "rd_margen_neto",
  },
];

function PedidoRealizado({ t }: { t: CifrasNegocio }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-right">Pedido</TableHead>
          <TableHead className="text-right">Realizado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {FILAS.map((f) => (
          <TableRow key={f.etiqueta} className={cn(f.fuerte && "font-semibold bg-muted/40")}>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                {f.etiqueta}
                {f.definicion && (
                  <Explicacion titulo={f.etiqueta} definicion={DEFINICIONES[f.definicion]} />
                )}
              </span>
            </TableCell>
            {[t.pedido, t.realizado].map((m, i) => (
              <TableCell
                key={i}
                className={cn("text-right tabular-nums", f.negativo?.(m) && "text-destructive")}
              >
                {f.valor(m)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const DETALLE: { titulo: string; valor: (n: CifrasNegocio) => string; rojo?: boolean }[] = [
  { titulo: "Pedidos", valor: (n) => String(n.pedido.pedidos) },
  { titulo: "Cancelados", valor: (n) => String(n.pedido.cancelados) },
  { titulo: "Metros pedidos", valor: (n) => metros(n.pedido.metros) },
  { titulo: "Metros hechos", valor: (n) => metros(n.realizado.metrosImpresos) },
  { titulo: "Vendido", valor: (n) => eur(n.pedido.vendido) },
  { titulo: "Bruta", valor: (n) => eur(n.pedido.bruta) },
  { titulo: "Producción", valor: (n) => eur(n.pedido.costeProduccion) },
  { titulo: "Margen sin envíos", valor: (n) => eur(n.pedido.margenSinEnvios), rojo: true },
  { titulo: "Envíos", valor: (n) => eurConSigno(n.pedido.resultadoEnvios), rojo: true },
  { titulo: "Margen neto", valor: (n) => eur(n.pedido.margenConEnvios), rojo: true },
  { titulo: "Margen neto hecho", valor: (n) => eur(n.realizado.margenConEnvios), rojo: true },
  { titulo: "€/m", valor: (n) => (n.pedido.euroMetro == null ? "—" : eur(n.pedido.euroMetro)) },
  { titulo: "Facturado", valor: (n) => eur(n.facturado) },
  { titulo: "Cobrado", valor: (n) => eur(n.cobrado) },
  { titulo: "Por cobrar", valor: (n) => eur(n.pedido.pendiente) },
  { titulo: "En cola", valor: (n) => metros(n.cola.metros) },
];

/** Un coste que resta: «−4,20 €»; sin coste, «0,00 €» (no «-0,00 €»). */
const resta = (x: number) => (x ? eur(-x) : eur(0));

const esNegativo = (texto: string) => texto.startsWith("-") || texto.startsWith("−");

function TablaDetalle({ r }: { r: Resumen }) {
  if (r.negocios.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin pedidos ni cobros en el periodo.</p>;
  }
  const celdas = (n: CifrasNegocio, total = false) =>
    DETALLE.map((c) => {
      const x = c.valor(n);
      return (
        <TableCell
          key={c.titulo}
          className={cn(
            "text-right tabular-nums whitespace-nowrap",
            total && "font-semibold",
            c.rojo && esNegativo(x) && "text-destructive",
          )}
        >
          {x}
        </TableCell>
      );
    });
  return (
    <Table movil="tarjetas" className="tabla-ancha text-xs">
      <TableHeader>
        <TableRow>
          <TableHead>Negocio</TableHead>
          {DETALLE.map((c) => (
            <TableHead key={c.titulo} className="text-right whitespace-nowrap">
              {c.titulo}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {r.negocios.map((n) => (
          <TableRow key={n.id}>
            <TableCell className="font-medium whitespace-nowrap">{n.nombre}</TableCell>
            {celdas(n)}
          </TableRow>
        ))}
      </TableBody>
      {r.negocios.length > 1 && (
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            {celdas(r.total, true)}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}

function DiaADia({ r }: { r: Resumen }) {
  // El total del día a día es el del periodo: los días que faltan (después de hoy) están vacíos.
  const t = r.total;
  return (
    <Table movil="tarjetas">
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead className="text-right">Pedidos</TableHead>
          <TableHead className="text-right">Metros pedidos</TableHead>
          <TableHead className="text-right">Metros hechos</TableHead>
          <TableHead className="text-right">Vendido</TableHead>
          <TableHead className="text-right">Cobrado</TableHead>
          <TableHead className="text-right">Margen neto</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {r.porDia.map((d) => {
          const finde = [0, 6].includes(new Date(`${d.dia}T12:00:00`).getDay());
          return (
            <TableRow key={d.dia} className={cn(finde && "text-muted-foreground")}>
              <TableCell className="whitespace-nowrap">
                {new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(
                  new Date(`${d.dia}T12:00:00`),
                )}{" "}
                {fechaCorta(`${d.dia}T12:00:00`)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{d.pedidos}</TableCell>
              <TableCell className="text-right tabular-nums">{metros(d.metrosPedidos)}</TableCell>
              <TableCell className="text-right tabular-nums">{metros(d.metrosImpresos)}</TableCell>
              <TableCell className="text-right tabular-nums">{eur(d.vendido)}</TableCell>
              <TableCell className="text-right tabular-nums">{eur(d.cobrado)}</TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  d.margenConEnvios < 0 && "text-destructive",
                )}
              >
                {eur(d.margenConEnvios)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {t.pedido.pedidos}
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {metros(t.pedido.metros)}
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {metros(t.realizado.metrosImpresos)}
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {eur(t.pedido.vendido)}
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">{eur(t.cobrado)}</TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {eur(t.pedido.margenConEnvios)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** Producción, envíos y gastos fijos; y los gastos fijos uno a uno. */
function Gastos({ r, gastos }: { r: Resumen; gastos: readonly GastoDelRango[] | null }) {
  const c = costesDelPeriodo(r);
  const partidas: [string, number][] = [
    ["Producción", c.produccion],
    ["Envíos (agencia)", c.envios],
    ["Gastos fijos", c.fijos],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        {partidas.map(([nombre, importe]) => (
          <div key={nombre} className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">{nombre}</div>
            <div className="text-lg font-semibold tabular-nums">{eur(importe)}</div>
            <div className="text-xs text-muted-foreground">
              {porcentaje(proporcion(importe, c.total))} del total
            </div>
          </div>
        ))}
        <div className="rounded-lg bg-primary/10 p-3">
          <div className="text-xs text-muted-foreground">Total de costes</div>
          <div className="text-lg font-bold tabular-nums">{eur(c.total)}</div>
          <div className="text-xs text-muted-foreground">Sin IVA</div>
        </div>
      </div>
      {!gastos ? (
        <p className="text-sm text-muted-foreground">Cargando los gastos fijos…</p>
      ) : gastos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay gastos fijos en este periodo.</p>
      ) : (
        <Table movil="tarjetas">
          <TableHeader>
            <TableRow>
              <TableHead>Gasto fijo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Cada cargo</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Se corrige en</TableHead>
              <TableHead className="text-right">En el periodo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gastos.map(({ gasto: g, importe }) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">
                  {g.concepto}
                  {g.con_justificante === false && (
                    <span className="ml-1 text-xs text-muted-foreground">(sin justificante)</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{etiquetaGasto(g)}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {textoCargo(g)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{textoVigencia(g)}</TableCell>
                <TableCell className="text-muted-foreground">{dondeSeCorrige(g)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {eur(importe)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="font-semibold">
                Total gastos fijos
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {eur(r.gastosFijos ?? 0)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
