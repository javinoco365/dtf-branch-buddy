import { useMemo } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { StatusBadge } from "@/components/StatusBadge";
import { eur, fechaCorta, numero } from "@/lib/format";
import { proformasSinFactura, resumenProformas, type ProformaFila } from "@/dominio/proformas";

/**
 * Las proformas registradas que todavía esperan su factura: desde el primer
 * día, sin umbral y sin mirar los filtros ni el periodo de la lista. El género
 * ya está en el stock; no cuentan en el IVA ni en Gerencia hasta que llegue su
 * factura y se case con ella.
 */
export function ProformasPendientes({
  compras,
  onVerFichero,
}: {
  /** Todas las compras de la pantalla (las facturas casadas apartan sus proformas). */
  compras: readonly ProformaFila[];
  onVerFichero: (id: string) => void;
}) {
  const pendientes = useMemo(() => proformasSinFactura(compras, new Date()), [compras]);
  const resumen = useMemo(() => resumenProformas(pendientes), [pendientes]);
  if (pendientes.length === 0) return null;

  return (
    <Card className="border-amber-500/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Proformas sin factura ({pendientes.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          El género ya está en el stock. No cuentan en el IVA ni en Gerencia hasta que llegue su
          factura y la cases.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table movil="tarjetas">
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Días</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead aria-label="Acciones" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendientes.map(({ proforma: p, dias, pagada, importe }) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {p.proveedor ?? "—"}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {p.numero ? `N.º ${p.numero}` : "Sin número"}
                  </span>
                </TableCell>
                <TableCell>{p.fecha ? fechaCorta(p.fecha) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {dias === null ? "—" : numero(dias, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{eur(importe)}</TableCell>
                <TableCell>
                  <StatusBadge estado={pagada ? "pagada" : "pendiente"} />
                  {pagada && p.fecha_pago && (
                    <span className="block text-xs text-muted-foreground">
                      El {fechaCorta(p.fecha_pago)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {p.fichero_ruta && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Ver el fichero"
                      aria-label="Ver el fichero"
                      onClick={() => onVerFichero(p.id)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Total · {resumen.proformas} proforma{resumen.proformas === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {eur(resumen.importe)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
