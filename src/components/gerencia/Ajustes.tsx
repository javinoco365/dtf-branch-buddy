import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { DatosFiscales, GastosFijos } from "./AjustesGastos";
import { Acciones, Campo } from "./comun";
import { eur, metros } from "@/lib/format";
import { useAjustesGerencia } from "@/lib/gerencia";
import { borrarObjetivo, guardarAjustesGerencia, guardarObjetivo } from "@/lib/gerencia.functions";
import type { Objetivo } from "@/dominio/gerencia";

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
      <DatosFiscales ajustes={data.ajustes} disponible={data.impuestosDisponibles} />
      <GastosFijos gastos={data.gastos} conImpuestos={data.impuestosDisponibles} />
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

// ---------------------------------------------------------------------------
