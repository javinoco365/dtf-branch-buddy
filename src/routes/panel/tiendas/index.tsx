import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Store, ShoppingBag, Receipt, KeyRound, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { guardarCredencialesWoo } from "@/lib/admin.functions";

export const Route = createFileRoute("/panel/tiendas/")({
  head: () => ({ meta: [{ title: "Tiendas · CRM DTF" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    nueva: s.nueva === 1 || s.nueva === "1" ? 1 : undefined,
  }),
  component: TiendasIndex,
});

type WizardForm = {
  // Identidad
  nombre: string;
  slug: string;
  color: string;
  // Facturación
  serie_factura: string;
  siguiente_numero_factura: number;
  iva_default: number;
  gastos_envio_default: number;
  // WooCommerce
  woo_url: string;
  sync_enabled: boolean;
  consumer_key: string;
  consumer_secret: string;
};

const FORM_INICIAL: WizardForm = {
  nombre: "",
  slug: "",
  color: "#3b82f6",
  serie_factura: "F",
  siguiente_numero_factura: 1,
  iva_default: 21,
  gastos_envio_default: 0,
  woo_url: "",
  sync_enabled: false,
  consumer_key: "",
  consumer_secret: "",
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function TiendasIndex() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { nueva } = Route.useSearch();
  const navigate = Route.useNavigate();

  useEffect(() => {
    if (nueva && isAdmin) {
      setOpen(true);
      navigate({ search: {} as any, replace: true });
    }
  }, [nueva, isAdmin, navigate]);

  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tiendas").select("*").order("nombre");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tiendas</h1>
          <p className="text-muted-foreground">Gestiona las webs WooCommerce</p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Nueva tienda</Button>
            </DialogTrigger>
            <NuevaTiendaWizard
              onDone={() => {
                setOpen(false);
                qc.invalidateQueries({ queryKey: ["tiendas"] });
                qc.invalidateQueries({ queryKey: ["tiendas-sidebar"] });
              }}
            />
          </Dialog>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Card className="border-dashed hover:border-primary transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[180px]">
                <CardContent className="flex flex-col items-center gap-3 text-muted-foreground">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <span className="font-medium">Crear tienda</span>
                </CardContent>
              </Card>
            </DialogTrigger>
            <NuevaTiendaWizard
              onDone={() => {
                setOpen(false);
                qc.invalidateQueries({ queryKey: ["tiendas"] });
                qc.invalidateQueries({ queryKey: ["tiendas-sidebar"] });
              }}
            />
          </Dialog>
        )}
        {tiendas.map((t) => (
          <Link key={t.id} to="/panel/tiendas/$tiendaId" params={{ tiendaId: t.id }}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" style={{ color: t.color ?? undefined }} />
                  {t.nombre}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>{t.woo_url || "Sin URL configurada"}</div>
                  <div>CIF: {t.cif || "—"}</div>
                  <div>Sync: {t.sync_enabled ? "✅ Activa" : "⏸ Desactivada"}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {tiendas.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="text-center py-12 text-muted-foreground">No hay tiendas. {isAdmin && "Crea la primera."}</CardContent></Card>
        )}
      </div>
    </div>
  );
}

function NuevaTiendaWizard({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState("identidad");
  const [f, setF] = useState<WizardForm>(FORM_INICIAL);
  const [saving, setSaving] = useState(false);
  const guardarCreds = useServerFn(guardarCredencialesWoo);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  async function crearTienda() {
    if (!f.nombre.trim()) {
      toast.error("El nombre es obligatorio");
      setTab("identidad");
      return;
    }
    if (f.sync_enabled && (!f.woo_url.trim() || !f.consumer_key.trim() || !f.consumer_secret.trim())) {
      toast.error("Para activar la sincronización necesitas URL + Consumer Key + Secret");
      setTab("woo");
      return;
    }
    setSaving(true);
    try {
      const slug = (f.slug || slugify(f.nombre)) || null;
      const { data: tienda, error } = await supabase
        .from("tiendas")
        .insert({
          nombre: f.nombre,
          slug,
          color: f.color || null,
          serie_factura: f.serie_factura || "F",
          siguiente_numero_factura: Number(f.siguiente_numero_factura) || 1,
          iva_default: Number(f.iva_default) || 21,
          gastos_envio_default: Number(f.gastos_envio_default) || 0,
          woo_url: f.woo_url || null,
          sync_enabled: f.sync_enabled,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (f.consumer_key.trim() && f.consumer_secret.trim()) {
        try {
          await guardarCreds({
            data: {
              tienda_id: tienda.id,
              consumer_key: f.consumer_key.trim(),
              consumer_secret: f.consumer_secret.trim(),
            },
          });
        } catch (e: any) {
          toast.warning(
            `Tienda creada, pero no se guardaron las credenciales: ${e?.message ?? "error"}`,
          );
        }
      }

      toast.success(`Tienda "${f.nombre}" creada`);
      setF(FORM_INICIAL);
      setTab("identidad");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Error creando la tienda");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nueva tienda</DialogTitle>
        <DialogDescription>
          Configura identidad, datos fiscales, facturación y WooCommerce en un solo paso.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="identidad" className="gap-1"><Store className="h-3.5 w-3.5" />Identidad</TabsTrigger>
          <TabsTrigger value="empresa" className="gap-1"><Building2 className="h-3.5 w-3.5" />Empresa</TabsTrigger>
          <TabsTrigger value="facturacion" className="gap-1"><Receipt className="h-3.5 w-3.5" />Facturación</TabsTrigger>
          <TabsTrigger value="woo" className="gap-1"><ShoppingBag className="h-3.5 w-3.5" />WooCommerce</TabsTrigger>
        </TabsList>

        {/* === IDENTIDAD === */}
        <TabsContent value="identidad" className="space-y-3 mt-4">
          <Row>
            <FieldText label="Nombre comercial *" v={f.nombre} on={(v) => {
              set("nombre", v);
              if (!f.slug) set("slug", slugify(v));
            }} placeholder="DTFTextil.es" />
            <FieldText label="Slug" v={f.slug} on={(v) => set("slug", slugify(v))} placeholder="dtftextil" />
          </Row>
          <div className="space-y-1">
            <Label className="text-xs">Color identificativo</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={f.color}
                onChange={(e) => set("color", e.target.value)}
                className="h-9 w-12 rounded border bg-background cursor-pointer"
              />
              <Input value={f.color} onChange={(e) => set("color", e.target.value)} className="w-32 font-mono" />
              <span className="text-xs text-muted-foreground">Se usa en el sidebar y badges.</span>
            </div>
          </div>
        </TabsContent>

        {/* === EMPRESA === */}
        <TabsContent value="empresa" className="space-y-3 mt-4">
          <Row>
            <FieldText label="Razón social" v={f.razon_social} on={(v) => set("razon_social", v)} />
            <FieldText label="CIF / NIF" v={f.cif} on={(v) => set("cif", v)} placeholder="B12345678" />
          </Row>
          <Row>
            <FieldText label="Email fiscal" v={f.email_fiscal} on={(v) => set("email_fiscal", v)} />
            <FieldText label="Teléfono" v={f.telefono} on={(v) => set("telefono", v)} />
          </Row>
          <FieldText label="Dirección" v={f.direccion} on={(v) => set("direccion", v)} />
          <Row>
            <FieldText label="Código postal" v={f.codigo_postal} on={(v) => set("codigo_postal", v)} />
            <FieldText label="Ciudad" v={f.ciudad} on={(v) => set("ciudad", v)} />
          </Row>
          <Row>
            <FieldText label="Provincia" v={f.provincia} on={(v) => set("provincia", v)} />
            <FieldText label="País" v={f.pais} on={(v) => set("pais", v)} />
          </Row>
        </TabsContent>

        {/* === FACTURACIÓN === */}
        <TabsContent value="facturacion" className="space-y-3 mt-4">
          <Row>
            <FieldText label="Serie de factura" v={f.serie_factura} on={(v) => set("serie_factura", v)} placeholder="F" />
            <FieldNum label="Siguiente nº de factura" v={f.siguiente_numero_factura} on={(v) => set("siguiente_numero_factura", v)} />
          </Row>
          <Row>
            <FieldNum label="IVA por defecto (%)" v={f.iva_default} on={(v) => set("iva_default", v)} step="0.01" />
            <FieldNum label="Gastos de envío (€)" v={f.gastos_envio_default} on={(v) => set("gastos_envio_default", v)} step="0.01" />
          </Row>
        </TabsContent>

        {/* === WOOCOMMERCE === */}
        <TabsContent value="woo" className="space-y-3 mt-4">
          <FieldText
            label="URL de la tienda WooCommerce"
            v={f.woo_url}
            on={(v) => set("woo_url", v)}
            placeholder="https://mitienda.com"
          />
          <div className="flex items-center justify-between border rounded-lg px-4 py-3">
            <div>
              <Label>Activar sincronización al crear</Label>
              <p className="text-xs text-muted-foreground">
                Requiere URL + Consumer Key + Secret. Puedes activarlo más tarde en Ajustes.
              </p>
            </div>
            <Switch checked={f.sync_enabled} onCheckedChange={(c) => set("sync_enabled", c)} />
          </div>

          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4" /> Credenciales API
              <span className="text-xs text-muted-foreground font-normal">
                Se cifran en el servidor. Opcional ahora.
              </span>
            </div>
            <Row>
              <FieldText
                label="Consumer Key"
                v={f.consumer_key}
                on={(v) => set("consumer_key", v)}
                placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <FieldPassword
                label="Consumer Secret"
                v={f.consumer_secret}
                on={(v) => set("consumer_secret", v)}
                placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </Row>
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter className="mt-4 flex !justify-between items-center w-full">
        <div className="text-xs text-muted-foreground">
          {f.nombre ? <>Creando <strong>{f.nombre}</strong></> : "Empieza por el nombre"}
        </div>
        <div className="flex gap-2">
          {tab !== "identidad" && (
            <Button
              variant="ghost"
              onClick={() =>
                setTab(
                  tab === "empresa" ? "identidad" : tab === "facturacion" ? "empresa" : "facturacion",
                )
              }
            >
              Anterior
            </Button>
          )}
          {tab !== "woo" ? (
            <Button
              onClick={() =>
                setTab(
                  tab === "identidad" ? "empresa" : tab === "empresa" ? "facturacion" : "woo",
                )
              }
            >
              Siguiente
            </Button>
          ) : (
            <Button onClick={crearTienda} disabled={saving || !f.nombre.trim()}>
              {saving ? "Creando…" : "Crear tienda"}
            </Button>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>;
}

function FieldText({
  label,
  v,
  on,
  placeholder,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function FieldPassword({
  label,
  v,
  on,
  placeholder,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="password"
        value={v}
        onChange={(e) => on(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}

function FieldNum({
  label,
  v,
  on,
  step,
}: {
  label: string;
  v: number;
  on: (v: number) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step ?? "1"}
        value={v}
        onChange={(e) => on(Number(e.target.value))}
      />
    </div>
  );
}