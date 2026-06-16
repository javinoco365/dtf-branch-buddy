import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Building2, Save, Calculator } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/panel/configuracion-empresa")({
  head: () => ({ meta: [{ title: "Datos de la empresa · CRM DTF" }] }),
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
};

function EmpresaPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState<EmpresaForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["empresa_global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_global")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
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
      });
    }
  }, [data]);

  const set = <K extends keyof EmpresaForm>(k: K, v: EmpresaForm[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("empresa_global")
        .upsert({ id: true, ...f });
      if (error) throw error;
      toast.success("Datos de la empresa guardados");
      qc.invalidateQueries({ queryKey: ["empresa_global"] });
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
                <Field label="Razón social" v={f.razon_social} on={(v) => set("razon_social", v)} disabled={!isAdmin} />
                <Field label="CIF / NIF" v={f.cif} on={(v) => set("cif", v)} placeholder="B12345678" disabled={!isAdmin} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Email fiscal" v={f.email_fiscal} on={(v) => set("email_fiscal", v)} disabled={!isAdmin} />
                <Field label="Teléfono" v={f.telefono} on={(v) => set("telefono", v)} disabled={!isAdmin} />
              </div>
              <Field label="Dirección" v={f.direccion} on={(v) => set("direccion", v)} disabled={!isAdmin} />
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Código postal" v={f.codigo_postal} on={(v) => set("codigo_postal", v)} disabled={!isAdmin} />
                <Field label="Ciudad" v={f.ciudad} on={(v) => set("ciudad", v)} disabled={!isAdmin} />
                <Field label="Provincia" v={f.provincia} on={(v) => set("provincia", v)} disabled={!isAdmin} />
              </div>
              <Field label="País" v={f.pais} on={(v) => set("pais", v)} disabled={!isAdmin} />

              {isAdmin ? (
                <div className="flex justify-end pt-2">
                  <Button onClick={guardar} disabled={saving}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Solo los administradores pueden modificar estos datos.</p>
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
            Importes en € por metro producido, compartidos por todas las tiendas. Se usan para calcular el margen estimado del mes en cada dashboard.
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