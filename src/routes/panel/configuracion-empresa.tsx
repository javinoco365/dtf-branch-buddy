import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Building2, Save, Calculator } from "lucide-react";
import { toast } from "sonner";
import { CLAVE_EMPRESA, leerEmpresa, guardarEmpresa } from "@/lib/empresa";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { leerEstadoSeries, fijarInicioSerie, type EstadoSerie } from "@/lib/facturas.functions";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/panel/configuracion-empresa")({
  head: () => ({ meta: [{ title: "Datos de la empresa · DTF Culture" }] }),
  component: EmpresaPage,
});

type EmpresaForm = {
  razon_social: string;
  cif: string;
  direccion: string;
  codigo_postal: string;
  ciudad: string;
  provincia: string;
  pais: string;
  email_fiscal: string;
  telefono: string;
  coste_consumibles_metro: number;
  coste_packaging_metro: number;
  coste_electricidad_metro: number;
  serie_factura: string;
  serie_rectificativa: string;
};

const EMPTY: EmpresaForm = {
  razon_social: "",
  cif: "",
  direccion: "",
  codigo_postal: "",
  ciudad: "",
  provincia: "",
  pais: "España",
  email_fiscal: "",
  telefono: "",
  coste_consumibles_metro: 0,
  coste_packaging_metro: 0,
  coste_electricidad_metro: 0,
  serie_factura: "",
  serie_rectificativa: "R",
};

function EmpresaPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState<EmpresaForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: CLAVE_EMPRESA,
    queryFn: leerEmpresa,
  });

  useEffect(() => {
    if (data) {
      setF({
        razon_social: data.razon_social ?? "",
        cif: data.cif ?? "",
        direccion: data.direccion ?? "",
        codigo_postal: data.codigo_postal ?? "",
        ciudad: data.ciudad ?? "",
        provincia: data.provincia ?? "",
        pais: data.pais ?? "España",
        email_fiscal: data.email_fiscal ?? "",
        telefono: data.telefono ?? "",
        coste_consumibles_metro: Number(data.coste_consumibles_metro ?? 0),
        coste_packaging_metro: Number(data.coste_packaging_metro ?? 0),
        coste_electricidad_metro: Number(data.coste_electricidad_metro ?? 0),
        serie_factura: data.serie_factura ?? "",
        serie_rectificativa: data.serie_rectificativa ?? "R",
      });
    }
  }, [data]);

  const set = <K extends keyof EmpresaForm>(k: K, v: EmpresaForm[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setSaving(true);
    try {
      if (!data?.id) throw new Error("No hay ninguna empresa activa que guardar");
      await guardarEmpresa(data.id, f);
      toast.success("Datos de la empresa guardados");
      qc.invalidateQueries({ queryKey: CLAVE_EMPRESA });
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/panel/configuracion">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Ajustes
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6" />
          Datos de la empresa
        </h1>
        <p className="text-sm text-muted-foreground">
          Estos datos son únicos para toda la SL. Se aplican automáticamente a todas las tiendas
          (sucursales) que crees, así como a sus facturas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identidad fiscal</CardTitle>
          <CardDescription>
            Razón social, CIF y datos de contacto que aparecerán en facturas y documentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Razón social"
                  v={f.razon_social}
                  on={(v) => set("razon_social", v)}
                  disabled={!isAdmin}
                />
                <Field
                  label="CIF / NIF"
                  v={f.cif}
                  on={(v) => set("cif", v)}
                  placeholder="B12345678"
                  disabled={!isAdmin}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Email fiscal"
                  v={f.email_fiscal}
                  on={(v) => set("email_fiscal", v)}
                  disabled={!isAdmin}
                />
                <Field
                  label="Teléfono"
                  v={f.telefono}
                  on={(v) => set("telefono", v)}
                  disabled={!isAdmin}
                />
              </div>
              <Field
                label="Dirección"
                v={f.direccion}
                on={(v) => set("direccion", v)}
                disabled={!isAdmin}
              />
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label="Código postal"
                  v={f.codigo_postal}
                  on={(v) => set("codigo_postal", v)}
                  disabled={!isAdmin}
                />
                <Field
                  label="Ciudad"
                  v={f.ciudad}
                  on={(v) => set("ciudad", v)}
                  disabled={!isAdmin}
                />
                <Field
                  label="Provincia"
                  v={f.provincia}
                  on={(v) => set("provincia", v)}
                  disabled={!isAdmin}
                />
              </div>
              <Field label="País" v={f.pais} on={(v) => set("pais", v)} disabled={!isAdmin} />

              <div className="rounded-md border p-4 space-y-4">
                <div>
                  <p className="text-sm font-medium">Numeración de facturas</p>
                  <p className="text-xs text-muted-foreground">
                    Una sola serie para toda la sociedad: DTF, textil y manuales comparten
                    numeración. Se reinicia cada año. Con el prefijo ordinario vacío, las facturas
                    salen como 2026/0001.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Las rectificativas llevan serie propia por obligación legal (RD 1619/2012 art.
                    6.1.a), y por eso los dos prefijos no pueden ser iguales.
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                    Cambiar un prefijo abre una serie nueva que empieza otra vez por 1. No lo toques
                    con facturas ya emitidas este año.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Prefijo ordinario"
                    v={f.serie_factura}
                    on={(v) => set("serie_factura", v)}
                    disabled={!isAdmin}
                    placeholder="(vacío)"
                  />
                  <Field
                    label="Prefijo de rectificativas"
                    v={f.serie_rectificativa}
                    on={(v) => set("serie_rectificativa", v)}
                    disabled={!isAdmin}
                    placeholder="R"
                  />
                </div>

                {data?.id && <PorDondeVaLaNumeracion empresaId={data.id} isAdmin={isAdmin} />}
              </div>

              {isAdmin ? (
                <div className="flex justify-end pt-2">
                  <Button onClick={guardar} disabled={saving}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Solo los administradores pueden modificar estos datos.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Costes de producción por metro
          </CardTitle>
          <CardDescription>
            Importes en € por metro producido, compartidos por todas las tiendas. Se usan para
            calcular el margen estimado del mes en cada dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <NumberField
                  label="Consumibles (€/m)"
                  v={f.coste_consumibles_metro}
                  on={(v) => set("coste_consumibles_metro", v)}
                  disabled={!isAdmin}
                />
                <NumberField
                  label="Packaging (€/m)"
                  v={f.coste_packaging_metro}
                  on={(v) => set("coste_packaging_metro", v)}
                  disabled={!isAdmin}
                />
                <NumberField
                  label="Electricidad (€/m)"
                  v={f.coste_electricidad_metro}
                  on={(v) => set("coste_electricidad_metro", v)}
                  disabled={!isAdmin}
                />
              </div>
              <div className="text-sm text-muted-foreground border-t pt-3">
                Coste total estimado:{" "}
                <span className="font-semibold text-foreground">
                  {(
                    (Number(f.coste_consumibles_metro) || 0) +
                    (Number(f.coste_packaging_metro) || 0) +
                    (Number(f.coste_electricidad_metro) || 0)
                  ).toFixed(3)}{" "}
                  €/m
                </span>
              </div>
              {isAdmin && (
                <div className="flex justify-end pt-2">
                  <Button onClick={guardar} disabled={saving}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberField({
  label,
  v,
  on,
  disabled,
}: {
  label: string;
  v: number;
  on: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step="0.001"
        value={v}
        onChange={(e) => on(Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
}

function Field({
  label,
  v,
  on,
  placeholder,
  disabled,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={v}
        onChange={(e) => on(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Por dónde va la numeración, y por dónde empieza.
 *
 * Fijar el número de la próxima factura hace falta una sola vez: el día que la
 * numeración venga de otro programa y haya que continuarla en vez de empezar
 * por el 1. En cuanto hay una factura emitida, la serie se cierra sola y esto
 * pasa a ser solo informativo.
 *
 * Quien decide si se puede o no es la base, dentro del mismo bloqueo que usa la
 * emisión. Aquí solo se pinta lo que ella responde: comprobarlo en el navegador
 * dejaría una rendija entre la comprobación y la escritura.
 */
function PorDondeVaLaNumeracion({ empresaId, isAdmin }: { empresaId: string; isAdmin: boolean }) {
  const ejercicio = new Date().getFullYear();
  const leer = useServerFn(leerEstadoSeries);
  const fijar = useServerFn(fijarInicioSerie);
  const qc = useQueryClient();
  const [editando, setEditando] = useState<EstadoSerie["tipo"] | null>(null);
  const [valor, setValor] = useState("");

  const clave = ["series", empresaId, ejercicio] as const;
  const { data, isLoading } = useQuery({
    queryKey: clave,
    queryFn: () => leer({ data: { empresa_id: empresaId, ejercicio } }),
  });

  const mut = useMutation({
    mutationFn: async (tipo: EstadoSerie["tipo"]) => {
      const n = Number(valor);
      if (!Number.isInteger(n) || n < 1)
        throw new Error("Escribe un número entero de 1 en adelante");
      return fijar({ data: { empresa_id: empresaId, ejercicio, tipo, siguiente: n } });
    },
    onSuccess: (r) => {
      toast.success(`La próxima factura será la ${r.proximo_numero}`);
      setEditando(null);
      setValor("");
      qc.invalidateQueries({ queryKey: clave });
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido fijar"),
  });

  if (isLoading || !data) return null;

  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-xs font-medium">Por dónde va la numeración de {ejercicio}</p>
      {data.series.map((s) => (
        <div key={s.tipo} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="w-28 shrink-0 capitalize text-muted-foreground">{s.tipo}</span>
          <span className="font-medium tabular-nums">
            {s.emitidas === 0
              ? `sin facturas · la próxima será la ${s.proximo_numero}`
              : `${s.emitidas} emitida${s.emitidas === 1 ? "" : "s"} · la próxima será la ${s.proximo_numero}`}
          </span>

          {editando === s.tipo ? (
            <span className="flex items-center gap-2">
              <Input
                className="h-7 w-24"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={String(s.proximo_numero)}
                inputMode="numeric"
              />
              <Button
                size="sm"
                className="h-7"
                onClick={() => mut.mutate(s.tipo)}
                disabled={mut.isPending}
              >
                {mut.isPending ? "Fijando…" : "Fijar"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
            </span>
          ) : (
            isAdmin &&
            s.se_puede_fijar && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => {
                  setEditando(s.tipo);
                  setValor(String(s.proximo_numero));
                }}
              >
                Cambiar por dónde empieza
              </Button>
            )
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Solo se puede elegir por dónde empieza una serie mientras no tenga ninguna factura emitida.
        Después no: subir el contador dejaría un hueco en la numeración y bajarlo repetiría un
        número, y ninguna de las dos cosas se arregla luego.
      </p>
    </div>
  );
}
