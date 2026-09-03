import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { guardarCredencialesWoo, credencialesWooMascaradas } from "@/lib/admin.functions";
import { sincronizarWoo } from "@/lib/woocommerce.functions";
import {
  RefreshCw,
  KeyRound,
  ShieldCheck,
  Building2,
  Receipt,
  Truck,
  ShoppingBag,
  Construction,
} from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/ajustes")({
  component: Ajustes,
});

type TiendaForm = {
  nombre?: string;
  razon_social?: string;
  cif?: string;
  direccion?: string;
  codigo_postal?: string;
  ciudad?: string;
  provincia?: string;
  pais?: string;
  email_fiscal?: string;
  telefono?: string;
  logo_url?: string;
  woo_url?: string;
  sync_enabled?: boolean;
  iva_default?: number;
  gastos_envio_default?: number;
};

function Ajustes() {
  const { tiendaId } = Route.useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const guardarCreds = useServerFn(guardarCredencialesWoo);
  const getCredsMask = useServerFn(credencialesWooMascaradas);
  const sync = useServerFn(sincronizarWoo);

  const { data: tienda } = useQuery({
    queryKey: ["tienda", tiendaId],
    queryFn: async () =>
      (await supabase.from("tiendas").select("*").eq("id", tiendaId).maybeSingle()).data,
  });

  const { data: creds, refetch: refetchCreds } = useQuery({
    queryKey: ["creds-mask", tiendaId],
    queryFn: () => getCredsMask({ data: { tienda_id: tiendaId } }),
  });

  const [form, setForm] = useState<TiendaForm>({});
  useEffect(() => {
    if (tienda) setForm(tienda as TiendaForm);
  }, [tienda]);

  const set = <K extends keyof TiendaForm>(k: K, v: TiendaForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const guardar = useMutation({
    mutationFn: async () => {
      const payload = {
        nombre: form.nombre,
        razon_social: form.razon_social || null,
        cif: form.cif || null,
        direccion: form.direccion || null,
        codigo_postal: form.codigo_postal || null,
        ciudad: form.ciudad || null,
        provincia: form.provincia || null,
        pais: form.pais || null,
        email_fiscal: form.email_fiscal || null,
        telefono: form.telefono || null,
        logo_url: form.logo_url || null,
        woo_url: form.woo_url || null,
        sync_enabled: !!form.sync_enabled,
        iva_default: Number(form.iva_default) || 21,
        gastos_envio_default: Number(form.gastos_envio_default) || 0,
      };
      const { error } = await supabase.from("tiendas").update(payload).eq("id", tiendaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajustes guardados");
      qc.invalidateQueries({ queryKey: ["tienda", tiendaId] });
      qc.invalidateQueries({ queryKey: ["tiendas-sidebar"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Solo administradores
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ajustes de la tienda</h1>
        <p className="text-sm text-muted-foreground">
          Configuración de WooCommerce, datos fiscales, facturación y seguimiento.
        </p>
      </div>

      <Tabs defaultValue="woo">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full md:w-auto">
          <TabsTrigger value="woo" className="gap-2">
            <ShoppingBag className="h-4 w-4" />
            WooCommerce
          </TabsTrigger>
          <TabsTrigger value="empresa" className="gap-2">
            <Building2 className="h-4 w-4" />
            Mi empresa
          </TabsTrigger>
          <TabsTrigger value="facturacion" className="gap-2">
            <Receipt className="h-4 w-4" />
            Facturación
          </TabsTrigger>
          <TabsTrigger value="seguimiento" className="gap-2">
            <Truck className="h-4 w-4" />
            Seguimiento
          </TabsTrigger>
        </TabsList>

        {/* === WOOCOMMERCE === */}
        <TabsContent value="woo" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conexión WooCommerce</CardTitle>
              <CardDescription>
                URL pública de la tienda y estado de la sincronización.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="URL de la tienda"
                v={form.woo_url}
                on={(v) => set("woo_url", v)}
                placeholder="https://mitienda.com"
              />
              <div className="flex items-center justify-between border rounded-lg px-4 py-3">
                <div>
                  <Label>Sincronización activa</Label>
                  <p className="text-xs text-muted-foreground">
                    Permite importar pedidos, clientes y productos.
                  </p>
                </div>
                <Switch
                  checked={!!form.sync_enabled}
                  onCheckedChange={(c) => set("sync_enabled", c)}
                />
              </div>
            </CardContent>
          </Card>

          <CredencialesCard
            tieneCreds={!!creds?.tiene}
            ckMask={creds?.ck_mask ?? null}
            csMask={creds?.cs_mask ?? null}
            updatedAt={creds?.updated_at ?? null}
            onSave={async (ck, cs) => {
              await guardarCreds({
                data: { tienda_id: tiendaId, consumer_key: ck, consumer_secret: cs },
              });
              await refetchCreds();
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
              Guardar cambios
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const r = await sync({ data: { tienda_id: tiendaId } });
                  toast.success(
                    `Sincronizado: ${r.pedidos} pedidos, ${r.clientes} clientes, ${r.productos} productos`,
                  );
                  qc.invalidateQueries();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
              disabled={!form.sync_enabled || !creds?.tiene}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Sincronizar ahora
            </Button>
          </div>
        </TabsContent>

        {/* === MI EMPRESA === */}
        <TabsContent value="empresa" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos fiscales</CardTitle>
              <CardDescription>Aparecerán como emisor en las facturas.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Nombre comercial" v={form.nombre} on={(v) => set("nombre", v)} />
              <Field
                label="Razón social"
                v={form.razon_social}
                on={(v) => set("razon_social", v)}
              />
              <Field label="CIF / NIF" v={form.cif} on={(v) => set("cif", v)} />
              <Field
                label="Email fiscal"
                v={form.email_fiscal}
                on={(v) => set("email_fiscal", v)}
              />
              <Field label="Teléfono" v={form.telefono} on={(v) => set("telefono", v)} />
              <Field
                label="URL del logo"
                v={form.logo_url}
                on={(v) => set("logo_url", v)}
                placeholder="https://…/logo.png"
              />
              <Field label="Dirección" v={form.direccion} on={(v) => set("direccion", v)} />
              <Field
                label="Código postal"
                v={form.codigo_postal}
                on={(v) => set("codigo_postal", v)}
              />
              <Field label="Ciudad" v={form.ciudad} on={(v) => set("ciudad", v)} />
              <Field label="Provincia" v={form.provincia} on={(v) => set("provincia", v)} />
              <Field label="País" v={form.pais} on={(v) => set("pais", v)} />
              {form.logo_url && (
                <div className="md:col-span-2">
                  <Label className="text-xs">Vista previa del logo</Label>
                  <div className="border rounded-lg p-3 bg-muted/30 flex items-center justify-center h-20">
                    <img
                      src={form.logo_url}
                      alt="Logo"
                      className="max-h-full"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            Guardar cambios
          </Button>
        </TabsContent>

        {/* === FACTURACIÓN === */}
        <TabsContent value="facturacion" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parámetros de facturación</CardTitle>
              <CardDescription>
                Valores por defecto al crear pedidos y facturas en esta tienda.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FieldNumber
                label="IVA por defecto (%)"
                v={form.iva_default}
                on={(v) => set("iva_default", v)}
                step="0.01"
              />
              <FieldNumber
                label="Gastos de envío por defecto (€)"
                v={form.gastos_envio_default}
                on={(v) => set("gastos_envio_default", v)}
                step="0.01"
              />
            </CardContent>
          </Card>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            Guardar cambios
          </Button>
        </TabsContent>

        {/* === SEGUIMIENTO === */}
        <TabsContent value="seguimiento" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Seguimiento de envíos
                <Badge variant="outline">Próximamente</Badge>
              </CardTitle>
              <CardDescription>
                Generador de enlaces de seguimiento para los pedidos. Aún no disponible.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert>
                <Construction className="h-4 w-4" />
                <AlertDescription>
                  Esta sección está preparada como placeholder. Cuando definas qué empresas de
                  transporte (Correos Express, SEUR, GLS, MRW, …) usaréis, configuraremos la
                  generación automática de URLs de tracking para incluir en emails y facturas.
                </AlertDescription>
              </Alert>
              <div className="grid gap-4 md:grid-cols-2 opacity-50 pointer-events-none">
                <Field label="Transportista" v="" on={() => {}} placeholder="Próximamente" />
                <Field
                  label="Plantilla URL de tracking"
                  v=""
                  on={() => {}}
                  placeholder="https://transportista.com/track/{codigo}"
                />
                <Field label="Código de cuenta" v="" on={() => {}} placeholder="—" />
                <Field label="API key" v="" on={() => {}} placeholder="—" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CredencialesCard({
  tieneCreds,
  ckMask,
  csMask,
  updatedAt,
  onSave,
}: {
  tieneCreds: boolean;
  ckMask: string | null;
  csMask: string | null;
  updatedAt: string | null;
  onSave: (ck: string, cs: string) => Promise<void>;
}) {
  const [ck, setCk] = useState("");
  const [cs, setCs] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(ck, cs);
      toast.success("Credenciales guardadas");
      setCk("");
      setCs("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Credenciales API
          {tieneCreds && (
            <Badge className="gap-1" variant="secondary">
              <ShieldCheck className="h-3 w-3" /> Configurado
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Las claves se almacenan en el servidor. El navegador nunca las recibe en claro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tieneCreds && (
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <div className="border rounded-lg px-3 py-2 bg-muted/30">
              <div className="text-xs text-muted-foreground">Consumer Key</div>
              <div className="font-mono">{ckMask}</div>
            </div>
            <div className="border rounded-lg px-3 py-2 bg-muted/30">
              <div className="text-xs text-muted-foreground">Consumer Secret</div>
              <div className="font-mono">{csMask}</div>
            </div>
            {updatedAt && (
              <div className="md:col-span-2 text-xs text-muted-foreground">
                Actualizado el {new Date(updatedAt).toLocaleString("es-ES")}
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">
              {tieneCreds
                ? "Nueva Consumer Key (dejar vacío para mantener la actual)"
                : "Consumer Key"}
            </Label>
            <Input
              placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxx"
              value={ck}
              onChange={(e) => setCk(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {tieneCreds
                ? "Nuevo Consumer Secret (dejar vacío para mantener la actual)"
                : "Consumer Secret"}
            </Label>
            <Input
              type="password"
              placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx"
              value={cs}
              onChange={(e) => setCs(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <Button variant="outline" onClick={handleSave} disabled={!ck || !cs || saving}>
          {saving ? "Guardando…" : tieneCreds ? "Actualizar credenciales" : "Guardar credenciales"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  v,
  on,
  placeholder,
}: {
  label: string;
  v?: string | null;
  on: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={v ?? ""} onChange={(e) => on(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function FieldNumber({
  label,
  v,
  on,
  step,
}: {
  label: string;
  v?: number | null;
  on: (v: number) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step ?? "1"}
        value={v ?? 0}
        onChange={(e) => on(Number(e.target.value))}
      />
    </div>
  );
}
