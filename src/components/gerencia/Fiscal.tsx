import { useMemo } from "react";
import { FileWarning, Landmark, Receipt, ShoppingBag } from "lucide-react";
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
import { useFiscal } from "@/lib/gerencia";
import { variacion } from "@/dominio/kpis";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { DEFINICIONES } from "@/dominio/definiciones";
import { ivaSoportado, resultadoIva, resumenIva } from "@/dominio/fiscal";
import type { DatosGerencia } from "./destinos";
import { CargandoPestana, ErrorPestana, Nota, NotaGrupo } from "./comun";

/** Las facturas son de una tienda o del textil; el canal no se les aplica. */
function deLaTienda<T extends { tienda_id: string }>(lista: readonly T[], tienda: string) {
  return tienda === "todas" ? lista : lista.filter((x) => x.tienda_id === tienda);
}

export function Fiscal({ d }: { d: DatosGerencia }) {
  const fiscal = useFiscal(d.rango);
  const previo = useFiscal(d.comparacion?.previo ?? d.rango);

  // Las compras que hay en el CRM son todas del textil.
  const conCompras = d.filtro.tienda === "todas" || d.filtro.tienda === TIENDA_TEXTIL.id;

  const iva = useMemo(
    () => resumenIva(deLaTienda(fiscal.data?.documentos ?? [], d.filtro.tienda)),
    [fiscal.data, d.filtro.tienda],
  );
  const ivaPrevio = useMemo(
    () =>
      d.comparacion && previo.data
        ? resumenIva(deLaTienda(previo.data.documentos, d.filtro.tienda))
        : null,
    [d.comparacion, previo.data, d.filtro.tienda],
  );
  const soportado = useMemo(
    () => (fiscal.data?.compras && conCompras ? ivaSoportado(fiscal.data.compras) : null),
    [fiscal.data, conCompras],
  );
  // Lo mismo que el botón de la esquina: los pedidos del periodo sin documento.
  const sinFactura = d.pendiente;

  if (fiscal.error) return <ErrorPestana que="las facturas" error={fiscal.error} />;
  if (!fiscal.data) return <CargandoPestana />;

  const frente = d.comparacion?.etiqueta;
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                ? `${soportado.documentos} ${soportado.documentos === 1 ? "compra registrada" : "compras registradas"} del textil`
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
              </TableBody>
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
                        {t.tipo === 0 ? "Sin desglose" : `${numero(t.tipo, 0)} %`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{eur(t.base)}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(t.cuota)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
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
    </div>
  );
}
