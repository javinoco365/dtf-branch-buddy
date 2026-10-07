import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Eye, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { eur, fechaCorta } from "@/lib/format";
import { releerFacturaRecibida, verFicheroCompra } from "@/lib/compras.functions";
import { UMBRAL_CONFIANZA } from "@/dominio/cola-compras";

/**
 * Las facturas que ha leído la IA y aún no ha confirmado nadie, y las que no
 * se pudieron leer. No cuentan en ningún sitio hasta que se registran.
 */
export function ColaRevision({
  compras,
  onRevisar,
  onBorrar,
}: {
  compras: any[];
  onRevisar: (c: any) => void;
  onBorrar: (c: any) => void;
}) {
  const qc = useQueryClient();
  const releerFn = useServerFn(releerFacturaRecibida);
  const verFn = useServerFn(verFicheroCompra);
  const releer = useMutation({
    mutationFn: (id: string) => releerFn({ data: { id } }),
    onSuccess: (r: any) => {
      if (r.resultado === "error") toast.error(r.motivo);
      else toast.success("Leída otra vez");
      qc.invalidateQueries({ queryKey: ["compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo volver a leer"),
  });
  const ver = async (id: string) => {
    try {
      const { url } = await verFn({ data: { id } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo abrir el fichero");
    }
  };

  if (compras.length === 0) return null;
  return (
    <Card className="border-amber-500/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Por revisar ({compras.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          La IA propone y tú confirmas. No cuentan en Gerencia ni en el IVA hasta que las registres.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table movil="tarjetas">
          <TableHeader>
            <TableRow>
              <TableHead>Factura</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Lectura</TableHead>
              <TableHead>Qué mirar</TableHead>
              <TableHead aria-label="Acciones" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {compras.map((c) => {
              const motivos = String(c.revision_motivo ?? "")
                .split("\n")
                .filter(Boolean);
              const error = c.revision === "error";
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.proveedor ?? (error ? "Sin leer" : "—")}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {c.numero ? `N.º ${c.numero}` : String(c.notas ?? "")}
                    </span>
                  </TableCell>
                  <TableCell>{c.fecha ? fechaCorta(c.fecha) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {error ? "—" : eur(Number(c.total))}
                  </TableCell>
                  <TableCell>
                    {error ? (
                      <Badge variant="destructive">Error</Badge>
                    ) : (
                      <Badge
                        variant={
                          Number(c.confianza ?? 0) < UMBRAL_CONFIANZA ? "outline" : "secondary"
                        }
                      >
                        {c.confianza == null
                          ? "Leyendo…"
                          : `Confianza ${Math.round(Number(c.confianza) * 100)} %`}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md text-sm">
                    {motivos.length === 0 ? (
                      <span className="text-muted-foreground">Nada en especial</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {motivos.map((m, i) => (
                          <li key={i} className={error ? "text-destructive" : ""}>
                            {m}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      {!error && (
                        <Button size="sm" onClick={() => onRevisar(c)}>
                          Revisar
                        </Button>
                      )}
                      {c.fichero_ruta && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Ver el fichero"
                          onClick={() => ver(c.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {c.fichero_ruta && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Volver a leer con IA"
                          disabled={releer.isPending}
                          onClick={() => releer.mutate(c.id)}
                        >
                          <RotateCw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Descartar"
                        onClick={() => onBorrar(c)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
