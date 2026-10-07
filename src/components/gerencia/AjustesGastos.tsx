import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { eur, fechaCorta, numero } from "@/lib/format";
import {
  borrarGastoFijo,
  guardarAjustesGerencia,
  guardarGastoFijo,
} from "@/lib/gerencia.functions";
import {
  gastosFijosDelRango,
  type AjustesGerencia,
  type GastoFijo,
  type Periodicidad,
} from "@/dominio/gerencia";
import {
  cargosDelRango,
  importesCargo,
  impuestosDeCargos,
  PERIODICIDADES,
  tipoGasto,
  TIPOS_GASTO,
  trimestreDe,
} from "@/dominio/impuestos";
import { rangoDe } from "@/dominio/periodos";
import { Acciones, Campo } from "./comun";

function useRefrescar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["gerencia-ajustes"] });
}

const aNumero = (t: string) => Number(t.replace(",", "."));

// ---------------------------------------------------------------------------
// Datos fiscales de la empresa
// ---------------------------------------------------------------------------

export function DatosFiscales({
  ajustes,
  disponible,
}: {
  ajustes: AjustesGerencia;
  disponible: boolean;
}) {
  const guardar = useServerFn(guardarAjustesGerencia);
  const refrescar = useRefrescar();
  const [f, setF] = useState({
    tipo_is: String(ajustes.tipo_is),
    cuota: ajustes.cuota_is_anterior == null ? "" : String(ajustes.cuota_is_anterior),
    precio: String(ajustes.precio_metro),
  });
  const mut = useMutation({
    mutationFn: () =>
      guardar({
        data: {
          tipo_is: aNumero(f.tipo_is),
          cuota_is_anterior: f.cuota.trim() === "" ? null : aNumero(f.cuota),
          precio_metro: aNumero(f.precio),
        },
      }),
    onSuccess: () => {
      toast.success("Datos fiscales guardados");
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!disponible) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Para el Impuesto sobre Sociedades, el precio del metro y los gastos con IVA e IRPF falta
          aplicar la migración <code>20261010100000_gastos_impuestos.sql</code>.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Datos fiscales</CardTitle>
        <p className="text-xs text-muted-foreground">
          Sociedades: 15 % para una empresa de nueva creación, el primer año con beneficio y el
          siguiente; después, el que te diga la gestoría. Los pagos fraccionados (modelo 202) son el
          18 % de la cuota del último modelo 200: sin 200 presentado, déjalo vacío y no hay 202.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
        >
          <Campo etiqueta="Sociedades (%)">
            <Input
              required
              inputMode="decimal"
              value={f.tipo_is}
              onChange={(e) => setF({ ...f, tipo_is: e.target.value })}
              className="w-28"
            />
          </Campo>
          <Campo etiqueta="Cuota del último 200 (€)">
            <Input
              inputMode="decimal"
              placeholder="Vacío: no hay 202"
              value={f.cuota}
              onChange={(e) => setF({ ...f, cuota: e.target.value })}
              className="w-44"
            />
          </Campo>
          <Campo etiqueta="Precio del metro (€, sin IVA)">
            <Input
              required
              inputMode="decimal"
              value={f.precio}
              onChange={(e) => setF({ ...f, precio: e.target.value })}
              className="w-36"
            />
          </Campo>
          <Button type="submit" size="sm" disabled={mut.isPending}>
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

type Formulario = {
  id: string | undefined;
  concepto: string;
  tipo: string;
  periodicidad: Periodicidad;
  importe: string;
  iva: string;
  irpf: string;
  desde: string;
  hasta: string;
  notas: string;
};

export function GastosFijos({
  gastos,
  conImpuestos,
}: {
  gastos: GastoFijo[];
  conImpuestos: boolean;
}) {
  const guardar = useServerFn(guardarGastoFijo);
  const borrar = useServerFn(borrarGastoFijo);
  const refrescar = useRefrescar();
  const hoy = format(new Date(), "yyyy-MM-dd");
  const vacio: Formulario = {
    id: undefined,
    concepto: "",
    tipo: "otros",
    periodicidad: "mensual",
    importe: "",
    iva: "21",
    irpf: "0",
    desde: format(new Date(), "yyyy-MM-01"),
    hasta: "",
    notas: "",
  };
  const [f, setF] = useState<Formulario>(vacio);
  const [borrando, setBorrando] = useState<GastoFijo | null>(null);

  const mutGuardar = useMutation({
    mutationFn: (fila: Formulario) =>
      guardar({
        data: {
          id: fila.id,
          concepto: fila.concepto,
          importe_mensual: aNumero(fila.importe),
          desde: fila.desde,
          hasta: fila.periodicidad === "puntual" ? null : fila.hasta || null,
          notas: fila.notas || null,
          ...(conImpuestos
            ? {
                periodicidad: fila.periodicidad,
                tipo: fila.tipo,
                iva_pct: aNumero(fila.iva || "0"),
                irpf_pct: aNumero(fila.irpf || "0"),
              }
            : {}),
        },
      }),
    onSuccess: (_r, fila) => {
      toast.success(fila.id ? "Gasto cambiado" : "Gasto añadido");
      setF(vacio);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mutBorrar = useMutation({
    mutationFn: (id: string) => borrar({ data: { id } }),
    onSuccess: () => {
      toast.success("Gasto borrado");
      setBorrando(null);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const esteMes = rangoDe({ tipo: "mes", ref: new Date() })!;
  const costeMes = gastosFijosDelRango(gastos, esteMes);
  const trimestre = trimestreDe(new Date());
  const impuestos = impuestosDeCargos(cargosDelRango(gastos, trimestre));
  const vigente = (g: GastoFijo) => g.desde <= hoy && (!g.hasta || g.hasta >= hoy);
  const filaDe = (g: GastoFijo): Formulario => ({
    id: g.id,
    concepto: g.concepto,
    tipo: g.tipo ?? "otros",
    periodicidad: g.periodicidad ?? "mensual",
    importe: String(g.importe_mensual),
    iva: String(g.iva_pct ?? 0),
    irpf: String(g.irpf_pct ?? 0),
    desde: g.desde,
    hasta: g.hasta ?? "",
    notas: g.notas ?? "",
  });
  // Al elegir el tipo se proponen el IVA y el IRPF de costumbre.
  const elegirTipo = (tipo: string) => {
    const t = tipoGasto(tipo);
    setF({ ...f, tipo, iva: String(t.iva), irpf: String(t.irpf) });
  };
  const periodicidad = (p: Periodicidad | null | undefined) =>
    PERIODICIDADES.find((x) => x.valor === (p ?? "mensual"))?.etiqueta ?? "Mensual";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gastos</CardTitle>
        <p className="text-xs text-muted-foreground">
          Alquiler, nóminas, cuota de autónomos, gestoría, seguros… La base va sin IVA. El IVA no es
          coste: se recupera en el 303. El IRPF que retienes (19 % al casero, 15 % a profesionales)
          tampoco: se lo descuentas al proveedor y lo ingresas en Hacienda en el 115 o el 111.
          Gerencia reparte cada gasto entre los meses que cubre y lo resta del margen. No apuntes
          aquí la tinta ni el film: ya van en el coste por metro.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutGuardar.mutate(f);
          }}
        >
          <Campo etiqueta="Concepto">
            <Input
              required
              placeholder="Ej. Alquiler nave"
              value={f.concepto}
              onChange={(e) => setF({ ...f, concepto: e.target.value })}
              className="w-52 max-md:w-full"
            />
          </Campo>
          {conImpuestos && (
            <Campo etiqueta="Tipo">
              <Select value={f.tipo} onValueChange={elegirTipo}>
                <SelectTrigger className="w-60 max-md:w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_GASTO.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
          {conImpuestos && (
            <Campo etiqueta="Cada cuánto">
              <Select
                value={f.periodicidad}
                onValueChange={(v) => setF({ ...f, periodicidad: v as Periodicidad })}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODICIDADES.map((p) => (
                    <SelectItem key={p.valor} value={p.valor}>
                      {p.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
          <Campo etiqueta={conImpuestos ? "Base de cada pago (€)" : "Al mes (€, sin IVA)"}>
            <Input
              required
              inputMode="decimal"
              placeholder="Ej. 800"
              value={f.importe}
              onChange={(e) => setF({ ...f, importe: e.target.value })}
              className="w-36"
            />
          </Campo>
          {conImpuestos && (
            <Campo etiqueta="IVA (%)">
              <Input
                inputMode="decimal"
                value={f.iva}
                onChange={(e) => setF({ ...f, iva: e.target.value })}
                className="w-20"
              />
            </Campo>
          )}
          {conImpuestos && (
            <Campo etiqueta="IRPF retenido (%)">
              <Input
                inputMode="decimal"
                value={f.irpf}
                onChange={(e) => setF({ ...f, irpf: e.target.value })}
                className="w-28"
              />
            </Campo>
          )}
          <Campo etiqueta={f.periodicidad === "puntual" ? "Fecha" : "Primer pago"}>
            <Input
              type="date"
              required
              value={f.desde}
              onChange={(e) => setF({ ...f, desde: e.target.value })}
              className="w-40"
            />
          </Campo>
          {f.periodicidad !== "puntual" && (
            <Campo etiqueta="Hasta (vacío: sigue)">
              <Input
                type="date"
                value={f.hasta}
                onChange={(e) => setF({ ...f, hasta: e.target.value })}
                className="w-40"
              />
            </Campo>
          )}
          <Button type="submit" size="sm" disabled={mutGuardar.isPending}>
            {f.id ? <Pencil className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
            {f.id ? "Guardar cambio" : "Añadir gasto"}
          </Button>
          {f.id && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setF(vacio)}>
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
          )}
        </form>

        {gastos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay gastos.</p>
        ) : (
          <>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto</TableHead>
                  {conImpuestos && <TableHead>Cada cuánto</TableHead>}
                  <TableHead className="text-right">Base</TableHead>
                  {conImpuestos && <TableHead className="text-right">IVA</TableHead>}
                  {conImpuestos && <TableHead className="text-right">IRPF</TableHead>}
                  {conImpuestos && <TableHead className="text-right">Pagas</TableHead>}
                  <TableHead>Desde</TableHead>
                  <TableHead>Hasta</TableHead>
                  <TableHead aria-label="Acciones" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {gastos.map((g) => {
                  const c = importesCargo(g);
                  return (
                    <TableRow key={g.id} className={vigente(g) ? "" : "text-muted-foreground"}>
                      <TableCell className="font-medium">
                        {g.concepto}
                        {conImpuestos && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {tipoGasto(g.tipo).etiqueta}
                          </span>
                        )}
                      </TableCell>
                      {conImpuestos && <TableCell>{periodicidad(g.periodicidad)}</TableCell>}
                      <TableCell className="text-right tabular-nums">
                        {eur(Number(g.importe_mensual))}
                      </TableCell>
                      {conImpuestos && (
                        <TableCell className="text-right tabular-nums">
                          {numero(Number(g.iva_pct ?? 0), 0)} %
                        </TableCell>
                      )}
                      {conImpuestos && (
                        <TableCell className="text-right tabular-nums">
                          {numero(Number(g.irpf_pct ?? 0), 0)} %
                        </TableCell>
                      )}
                      {conImpuestos && (
                        <TableCell className="text-right tabular-nums">{eur(c.aPagar)}</TableCell>
                      )}
                      <TableCell>{fechaCorta(g.desde)}</TableCell>
                      <TableCell>
                        {g.periodicidad === "puntual"
                          ? "—"
                          : g.hasta
                            ? fechaCorta(g.hasta)
                            : "Sigue"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {!g.hasta && g.periodicidad !== "puntual" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              title="Dejar de pagarlo desde hoy"
                              disabled={mutGuardar.isPending}
                              onClick={() => mutGuardar.mutate({ ...filaDe(g), hasta: hoy })}
                            >
                              Dar de baja
                            </Button>
                          )}
                          <Acciones
                            onEditar={() => setF(filaDe(g))}
                            onBorrar={() => setBorrando(g)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="space-y-1 text-sm">
              <p>
                Este mes cuestan <span className="font-semibold">{eur(costeMes)}</span> sin IVA.
              </p>
              {conImpuestos && (
                <p className="text-muted-foreground">
                  Pagos de este trimestre ({trimestre.numero}.º de {trimestre.anio}): IVA soportado{" "}
                  {eur(impuestos.ivaSoportado)} · retenciones al 111 {eur(impuestos.irpf111)} · al
                  115 {eur(impuestos.irpf115)}.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
      <ConfirmarBorrado
        que={borrando ? `el gasto «${borrando.concepto}»` : ""}
        consecuencias={[
          "Desaparece también de los meses en que se pagó. Si solo has dejado de pagarlo, usa «Dar de baja».",
        ]}
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        onConfirmar={() => borrando && mutBorrar.mutate(borrando.id)}
        cargando={mutBorrar.isPending}
      />
    </Card>
  );
}
