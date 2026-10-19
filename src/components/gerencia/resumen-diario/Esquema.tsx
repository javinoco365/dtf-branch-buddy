import {
  AlertTriangle,
  CheckCircle2,
  Euro,
  Gauge,
  Info,
  PiggyBank,
  Receipt,
  Ruler,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
import { cn } from "@/lib/utils";
import { eur, eurConSigno, metros, numero } from "@/lib/format";
import { DEFINICIONES, type ClaveDefinicion } from "@/dominio/definiciones";
import {
  variacionResumen,
  type AvisoResumen,
  type CifrasNegocio,
  type Resumen,
} from "@/dominio/resumen-diario";
import { porcentaje, textoAvisoResumen } from "./textos";

const NIVEL: Record<AvisoResumen["nivel"], { icono: typeof Info; clase: string }> = {
  alto: { icono: AlertTriangle, clase: "text-destructive" },
  medio: { icono: AlertTriangle, clase: "text-amber-600 dark:text-amber-400" },
  info: { icono: Info, clase: "text-muted-foreground" },
};

/**
 * Página 1: lo que un socio quiere ver de un vistazo. Seis cifras con su
 * variación, la máquina, una línea por negocio y lo que hay que mirar.
 */
export function Esquema({
  r,
  anterior,
  frente,
  metrosHora,
}: {
  r: Resumen;
  anterior: Resumen | null;
  frente?: string;
  metrosHora: number;
}) {
  const t = r.total;
  const a = anterior?.total;
  const v = (actual: number, previo: number | undefined) =>
    previo === undefined ? null : variacionResumen(actual, previo);
  const comparar = anterior ? frente : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        <TarjetaKpi
          titulo="Pedidos"
          valor={String(t.pedido.pedidos)}
          delta={v(t.pedido.pedidos, a?.pedido.pedidos)}
          frente={comparar}
          icon={ShoppingCart}
          explicacion="rd_pedidos"
          pie={
            <span className="text-muted-foreground">
              {metros(t.pedido.metros)} pedidos · ticket medio {eur(t.pedido.ticket)}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Metros realizados"
          valor={metros(t.realizado.metrosImpresos)}
          delta={v(t.realizado.metrosImpresos, a?.realizado.metrosImpresos)}
          frente={comparar}
          icon={Ruler}
          explicacion="rd_metros_realizados"
          pie={
            <span className="text-muted-foreground">
              {t.realizado.pedidos} {t.realizado.pedidos === 1 ? "pedido hecho" : "pedidos hechos"}{" "}
              · en cola {metros(t.cola.metros)}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Facturado"
          valor={eur(t.facturado)}
          delta={v(t.facturado, a?.facturado)}
          frente={comparar}
          icon={Receipt}
          explicacion="rd_facturado"
          pie={<span className="text-muted-foreground">Base imponible, sin IVA</span>}
        />
        <TarjetaKpi
          titulo="Cobrado"
          valor={eur(t.cobrado)}
          delta={v(t.cobrado, a?.cobrado)}
          frente={comparar}
          icon={Wallet}
          explicacion="rd_cobrado"
          pie={
            <span className="text-muted-foreground">
              De lo pedido, falta por cobrar {eur(t.pedido.pendiente)}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Margen neto"
          valor={eur(t.pedido.margenConEnvios)}
          delta={v(t.pedido.margenConEnvios, a?.pedido.margenConEnvios)}
          frente={comparar}
          icon={PiggyBank}
          color={t.pedido.margenConEnvios < 0 ? "destructive" : "primary"}
          explicacion="rd_margen_neto"
          pie={
            <span className="text-muted-foreground">
              De lo realizado: {eur(t.realizado.margenConEnvios)}
            </span>
          }
        />
        <TarjetaKpi
          titulo="Margen sin envíos"
          valor={eur(t.pedido.margenSinEnvios)}
          delta={v(t.pedido.margenSinEnvios, a?.pedido.margenSinEnvios)}
          frente={comparar}
          icon={Euro}
          color={t.pedido.margenSinEnvios < 0 ? "destructive" : "primary"}
          explicacion="rd_margen_sin_envios"
          pie={
            <span
              className={cn(
                t.pedido.resultadoEnvios < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              Envíos: {eurConSigno(t.pedido.resultadoEnvios)}
            </span>
          }
        />
      </div>

      <Maquina r={r} metrosHora={metrosHora} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por negocio</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaNegocios r={r} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Qué mirar</CardTitle>
          </CardHeader>
          <CardContent>
            {r.avisos.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-status-completado" />
                Nada fuera de lo normal.
              </p>
            ) : (
              <ul className="space-y-2">
                {r.avisos.slice(0, 5).map((x) => {
                  const { icono: Icono, clase } = NIVEL[x.nivel];
                  return (
                    <li key={x.tipo} className="flex items-start gap-2 text-sm">
                      <Icono className={cn("mt-0.5 h-4 w-4 shrink-0", clase)} />
                      <span>{textoAvisoResumen(x)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Resultado r={r} />
      </div>
    </div>
  );
}

/** La máquina: lo que imprimió frente a lo que podía imprimir. */
function Maquina({ r, metrosHora }: { r: Resumen; metrosHora: number }) {
  const c = r.capacidad;
  const uso = c.uso ?? 0;
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Gauge className="h-4 w-4" />
            Máquina
            <Explicacion titulo="Máquina" definicion={DEFINICIONES.rd_capacidad} />
          </div>
          <span
            className={cn(
              "text-2xl font-bold tabular-nums",
              uso >= 0.9 ? "text-destructive" : uso < 0.5 ? "text-muted-foreground" : "",
            )}
          >
            {c.uso == null ? "—" : porcentaje(c.uso)}
          </span>
        </div>
        <Progress value={Math.min(100, uso * 100)} />
        <p className="text-xs text-muted-foreground">
          {c.dias === 0
            ? "Sin días laborables en el periodo (o todavía no han llegado)."
            : `${metros(r.total.realizado.metrosImpresos)} impresos de ${metros(c.metros)} posibles · ${numero(metrosHora, 0)} m/h × ${numero(c.horasDia, 1)} h × ${c.dias} ${c.dias === 1 ? "día" : "días"}`}
        </p>
      </CardContent>
    </Card>
  );
}

/** El margen neto menos los gastos fijos, y el objetivo del periodo. */
function Resultado({ r }: { r: Resumen }) {
  const o = r.objetivo;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resultado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Linea etiqueta="Margen neto" valor={eur(r.total.pedido.margenConEnvios)} />
        <Linea
          etiqueta="Gastos fijos del periodo"
          valor={r.gastosFijos == null ? "—" : `−${eur(r.gastosFijos)}`}
        />
        <Linea
          etiqueta="Beneficio"
          valor={r.beneficio == null ? "—" : eur(r.beneficio)}
          fuerte
          negativo={(r.beneficio ?? 0) < 0}
        />
        {o.avanceMetros != null && (
          <Avance
            etiqueta="Objetivo de metros"
            avance={o.avanceMetros}
            texto={`${metros(r.total.realizado.metrosImpresos)} de ${metros(o.metros)}`}
          />
        )}
        {o.avanceVendido != null && (
          <Avance
            etiqueta="Objetivo de ventas"
            avance={o.avanceVendido}
            texto={`${eur(r.total.pedido.vendido)} de ${eur(o.vendido)}`}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Avance({ etiqueta, avance, texto }: { etiqueta: string; avance: number; texto: string }) {
  return (
    <div className="pt-2 space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{etiqueta}</span>
        <span className="font-medium tabular-nums">{porcentaje(avance)}</span>
      </div>
      <Progress value={Math.min(100, avance * 100)} />
      <p className="text-xs text-muted-foreground">{texto}</p>
    </div>
  );
}

export function Linea({
  etiqueta,
  valor,
  fuerte = false,
  negativo = false,
  nota,
  conDefinicion,
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
  negativo?: boolean;
  nota?: string;
  /** La definición de su ⓘ. */
  conDefinicion?: ClaveDefinicion;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        fuerte && "border-t pt-2 font-semibold",
      )}
    >
      <span className={fuerte ? "" : "text-muted-foreground"}>
        {etiqueta}
        {nota && <span className="ml-1 text-xs text-muted-foreground">({nota})</span>}
        {conDefinicion && (
          <span className="ml-1 inline-flex align-middle">
            <Explicacion titulo={etiqueta} definicion={DEFINICIONES[conDefinicion]} />
          </span>
        )}
      </span>
      <span
        className={cn("tabular-nums text-right whitespace-nowrap", negativo && "text-destructive")}
      >
        {valor}
      </span>
    </div>
  );
}

const filaNegocio = (n: CifrasNegocio) => [
  String(n.pedido.pedidos),
  metros(n.pedido.metros),
  metros(n.realizado.metrosImpresos),
  eur(n.facturado),
  eur(n.cobrado),
  eur(n.pedido.margenConEnvios),
  eur(n.pedido.margenSinEnvios),
];

const COLUMNAS = [
  "Pedidos",
  "Metros pedidos",
  "Metros hechos",
  "Facturado",
  "Cobrado",
  "Margen neto",
  "Sin envíos",
];

function TablaNegocios({ r }: { r: Resumen }) {
  if (r.negocios.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin pedidos ni cobros en el periodo.</p>;
  }
  return (
    <Table movil="tarjetas">
      <TableHeader>
        <TableRow>
          <TableHead>Negocio</TableHead>
          {COLUMNAS.map((c) => (
            <TableHead key={c} className="text-right">
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {r.negocios.map((n) => (
          <TableRow key={n.id}>
            <TableCell className="font-medium">{n.nombre}</TableCell>
            {filaNegocio(n).map((x, i) => (
              <TableCell
                key={COLUMNAS[i]}
                className={cn(
                  "text-right tabular-nums",
                  i >= 5 && x.startsWith("-") && "text-destructive",
                )}
              >
                {x}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {r.negocios.length > 1 && (
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            {filaNegocio(r.total).map((x, i) => (
              <TableCell key={COLUMNAS[i]} className="text-right tabular-nums font-semibold">
                {x}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
