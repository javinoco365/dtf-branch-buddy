import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { eur, fechaCorta, metros } from "@/lib/format";
import { useAjustesGerencia } from "@/lib/gerencia";
import {
  borrarGastoFijo,
  borrarObjetivo,
  guardarAjustesGerencia,
  guardarGastoFijo,
  guardarObjetivo,
} from "@/lib/gerencia.functions";
import { gastosFijosDelRango, type GastoFijo, type Objetivo } from "@/dominio/gerencia";
import { rangoDe } from "@/dominio/periodos";

/**
 * Gerencia › Ajustes: lo que Gerencia necesita saber y solo sabe la empresa.
 * Se guarda en la base (migración 20261008100000_gerencia_ajustes) y cada
 * cambio queda en la auditoría con su autor.
 */
export function Ajustes() {
  const { data, isPending, error } = useAjustesGerencia();

  if (isPending) return <p className="text-sm text-muted-foreground">Cargando ajustes…</p>;
  if (error) {
    return (
      <p className="text-sm text-destructive">No se han podido leer los ajustes: {error.message}</p>
    );
  }
  if (!data.disponible) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Los ajustes de Gerencia necesitan la migración{" "}
          <code>20261008100000_gerencia_ajustes.sql</code>. Hasta que se aplique, Gerencia funciona
          sin gastos fijos ni objetivos, y los pedidos web sin pagar cuentan como vendidos.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <AjusteWebSinPagar cuenta={data.ajustes.web_sin_pagar_cuenta} />
      <Objetivos objetivos={data.objetivos} />
      <GastosFijos gastos={data.gastos} />
    </div>
  );
}

function useRefrescar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["gerencia-ajustes"] });
}

// ---------------------------------------------------------------------------

function AjusteWebSinPagar({ cuenta }: { cuenta: boolean }) {
  const guardar = useServerFn(guardarAjustesGerencia);
  const refrescar = useRefrescar();
  const mut = useMutation({
    mutationFn: (v: boolean) => guardar({ data: { web_sin_pagar_cuenta: v } }),
    onSuccess: () => {
      toast.success("Ajuste guardado");
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Qué cuenta como vendido</CardTitle>
      </CardHeader>
      <CardContent>
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={cuenta}
            disabled={mut.isPending}
            onCheckedChange={(v) => mut.mutate(v)}
            aria-label="Contar los pedidos web sin pagar como vendidos"
          />
          <span>
            <span className="font-medium">Contar los pedidos web sin pagar como vendidos</span>
            <span className="block text-muted-foreground">
              En WooCommerce, un pedido «pendiente de pago» o «en espera» puede no pagarse nunca.
              Apagado, Gerencia no los cuenta en lo vendido hasta que se paguen. No cambia el
              Dashboard ni la Facturación de las tiendas.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

const mesTexto = (desde: string) => {
  const [a, m] = desde.split("-").map(Number);
  return format(new Date(a, m - 1, 1), "MMMM yyyy", { locale: es }).replace(/^./, (c) =>
    c.toUpperCase(),
  );
};

function Objetivos({ objetivos }: { objetivos: Objetivo[] }) {
  const guardar = useServerFn(guardarObjetivo);
  const borrar = useServerFn(borrarObjetivo);
  const refrescar = useRefrescar();
  const vacio = {
    id: undefined as string | undefined,
    mes: format(new Date(), "yyyy-MM"),
    metros: "",
    vendido: "",
  };
  const [f, setF] = useState(vacio);
  const [borrando, setBorrando] = useState<Objetivo | null>(null);

  const numeroONulo = (t: string) => (t.trim() === "" ? null : Number(t.replace(",", ".")));

  const mutGuardar = useMutation({
    mutationFn: () =>
      guardar({
        data: {
          id: f.id,
          desde: `${f.mes}-01`,
          metros: numeroONulo(f.metros),
          vendido: numeroONulo(f.vendido),
        },
      }),
    onSuccess: () => {
      toast.success(f.id ? "Objetivo cambiado" : "Objetivo guardado");
      setF(vacio);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mutBorrar = useMutation({
    mutationFn: (id: string) => borrar({ data: { id } }),
    onSuccess: () => {
      toast.success("Objetivo borrado");
      setBorrando(null);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Objetivos al mes</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cada objetivo vale desde su mes hasta que pongas otro. Gerencia lo prorratea por días si
          miras una semana o un trimestre. Las ventas son con IVA, como «Vendido».
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutGuardar.mutate();
          }}
        >
          <Campo etiqueta="Desde el mes">
            <Input
              type="month"
              required
              value={f.mes}
              onChange={(e) => setF({ ...f, mes: e.target.value })}
              className="w-44"
            />
          </Campo>
          <Campo etiqueta="Metros al mes">
            <Input
              inputMode="decimal"
              placeholder="Ej. 2000"
              value={f.metros}
              onChange={(e) => setF({ ...f, metros: e.target.value })}
              className="w-32"
            />
          </Campo>
          <Campo etiqueta="Ventas al mes (€)">
            <Input
              inputMode="decimal"
              placeholder="Ej. 15000"
              value={f.vendido}
              onChange={(e) => setF({ ...f, vendido: e.target.value })}
              className="w-36"
            />
          </Campo>
          <Button type="submit" size="sm" disabled={mutGuardar.isPending}>
            {f.id ? <Pencil className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
            {f.id ? "Guardar cambio" : "Añadir objetivo"}
          </Button>
          {f.id && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setF(vacio)}>
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
          )}
        </form>

        {objetivos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay objetivos.</p>
        ) : (
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Desde</TableHead>
                <TableHead className="text-right">Metros</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {objetivos.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{mesTexto(o.desde)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.metros != null ? metros(Number(o.metros)) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.vendido != null ? eur(Number(o.vendido)) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Acciones
                      onEditar={() =>
                        setF({
                          id: o.id,
                          mes: o.desde.slice(0, 7),
                          metros: o.metros != null ? String(o.metros) : "",
                          vendido: o.vendido != null ? String(o.vendido) : "",
                        })
                      }
                      onBorrar={() => setBorrando(o)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConfirmarBorrado
        que={borrando ? `el objetivo de ${mesTexto(borrando.desde)}` : ""}
        consecuencias={["Desde ese mes valdrá el objetivo anterior, si lo hay."]}
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        onConfirmar={() => borrando && mutBorrar.mutate(borrando.id)}
        cargando={mutBorrar.isPending}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------

function GastosFijos({ gastos }: { gastos: GastoFijo[] }) {
  const guardar = useServerFn(guardarGastoFijo);
  const borrar = useServerFn(borrarGastoFijo);
  const refrescar = useRefrescar();
  const hoy = format(new Date(), "yyyy-MM-dd");
  const vacio = {
    id: undefined as string | undefined,
    concepto: "",
    importe: "",
    desde: format(new Date(), "yyyy-MM-01"),
    hasta: "",
    notas: "",
  };
  const [f, setF] = useState(vacio);
  const [borrando, setBorrando] = useState<GastoFijo | null>(null);

  const mutGuardar = useMutation({
    mutationFn: (fila: typeof f) =>
      guardar({
        data: {
          id: fila.id,
          concepto: fila.concepto,
          importe_mensual: Number(fila.importe.replace(",", ".")),
          desde: fila.desde,
          hasta: fila.hasta || null,
          notas: fila.notas || null,
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

  // Lo que se paga al mes, contando solo los gastos vigentes este mes entero.
  const esteMes = rangoDe({ tipo: "mes", ref: new Date() })!;
  const alMes = gastosFijosDelRango(gastos, esteMes);
  const vigente = (g: GastoFijo) => g.desde <= hoy && (!g.hasta || g.hasta >= hoy);
  const filaDe = (g: GastoFijo) => ({
    id: g.id,
    concepto: g.concepto,
    importe: String(g.importe_mensual),
    desde: g.desde,
    hasta: g.hasta ?? "",
    notas: g.notas ?? "",
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Gastos fijos</CardTitle>
        <p className="text-xs text-muted-foreground">
          Alquiler, sueldos, cuota de autónomos, gestoría… Importe al mes y sin IVA. Gerencia los
          reparte por días y los resta del margen para enseñar el beneficio. Si dejas de pagar uno,
          dale de baja: se queda en los meses que sí se pagó.
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
          <Campo etiqueta="Al mes (€, sin IVA)">
            <Input
              required
              inputMode="decimal"
              placeholder="Ej. 800"
              value={f.importe}
              onChange={(e) => setF({ ...f, importe: e.target.value })}
              className="w-36"
            />
          </Campo>
          <Campo etiqueta="Desde">
            <Input
              type="date"
              required
              value={f.desde}
              onChange={(e) => setF({ ...f, desde: e.target.value })}
              className="w-40"
            />
          </Campo>
          <Campo etiqueta="Hasta (vacío: sigue)">
            <Input
              type="date"
              value={f.hasta}
              onChange={(e) => setF({ ...f, hasta: e.target.value })}
              className="w-40"
            />
          </Campo>
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
          <p className="text-sm text-muted-foreground">Todavía no hay gastos fijos.</p>
        ) : (
          <>
            <Table movil="tarjetas">
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Al mes</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Hasta</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {gastos.map((g) => (
                  <TableRow key={g.id} className={vigente(g) ? "" : "text-muted-foreground"}>
                    <TableCell className="font-medium">{g.concepto}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(Number(g.importe_mensual))}
                    </TableCell>
                    <TableCell>{fechaCorta(g.desde)}</TableCell>
                    <TableCell>{g.hasta ? fechaCorta(g.hasta) : "Sigue"}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        {!g.hasta && (
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
                ))}
              </TableBody>
            </Table>
            <p className="text-sm">
              Este mes suman <span className="font-semibold">{eur(alMes)}</span> sin IVA.
            </p>
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

// ---------------------------------------------------------------------------

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 max-md:w-full">
      <Label className="text-xs">{etiqueta}</Label>
      {children}
    </div>
  );
}

function Acciones({ onEditar, onBorrar }: { onEditar: () => void; onBorrar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Editar"
        onClick={onEditar}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive"
        title="Borrar"
        onClick={onBorrar}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </span>
  );
}
