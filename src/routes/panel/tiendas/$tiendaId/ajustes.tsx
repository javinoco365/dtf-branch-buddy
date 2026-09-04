import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch as SwitchCorreo } from "@/components/ui/switch";
import { toast } from "sonner";
import { tabla } from "@/lib/rpc";
import {
  VARIABLES_PEDIDO_ENVIADO,
  erratasEnPlantilla,
  vistaPrevia,
  vistaPreviaHtml,
} from "@/lib/plantillas-correo";
import { useAuth } from "@/lib/auth-context";
import { estadoSmtp, usarSmtpGeneral } from "@/lib/smtp.functions";
import { FormularioSmtp } from "@/components/FormularioSmtp";
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
  Mail,
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

  const [subiendoLogo, setSubiendoLogo] = useState(false);

  // Nombre con marca de tiempo, nunca sobrescribiendo: si se reemplazara el
  // fichero en una ruta fija, cambiar el logo cambiaría RETROACTIVAMENTE el de
  // las facturas ya emitidas, que son inmutables. Cada logo es un fichero nuevo
  // y cada factura conserva la URL que congeló.
  async function subirLogo(archivo: File) {
    const tipos: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    const ext = tipos[archivo.type];
    if (!ext) {
      toast.error("El logo tiene que ser PNG, JPG o WebP");
      return;
    }
    if (archivo.size > 2 * 1024 * 1024) {
      toast.error("El logo no puede pasar de 2 MB");
      return;
    }

    setSubiendoLogo(true);
    try {
      const ruta = `tiendas/${tiendaId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("logos")
        .upload(ruta, archivo, { contentType: archivo.type });
      if (error) throw error;
      const { data } = supabase.storage.from("logos").getPublicUrl(ruta);
      set("logo_url", data.publicUrl);
      toast.success("Logo subido. Guarda los cambios para asociarlo a la tienda.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir el logo");
    } finally {
      setSubiendoLogo(false);
    }
  }

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
        <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full md:w-auto">
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
          <TabsTrigger value="correos" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Correos</span>
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
              <CardTitle className="text-base">Identidad de la tienda</CardTitle>
              <CardDescription>
                El emisor de las facturas es siempre la sociedad, con sus datos de Configuración. De
                aquí la factura solo toma el nombre comercial y el logo.
              </CardDescription>
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
              <Field label="Dirección" v={form.direccion} on={(v) => set("direccion", v)} />
              <Field
                label="Código postal"
                v={form.codigo_postal}
                on={(v) => set("codigo_postal", v)}
              />
              <Field label="Ciudad" v={form.ciudad} on={(v) => set("ciudad", v)} />
              <Field label="Provincia" v={form.provincia} on={(v) => set("provincia", v)} />
              <Field label="País" v={form.pais} on={(v) => set("pais", v)} />
              <div className="md:col-span-2 space-y-2">
                <Label className="text-xs">Logo de la tienda</Label>
                <p className="text-xs text-muted-foreground">
                  Se imprime en las facturas de esta tienda. PNG, JPG o WebP, hasta 2 MB. Cada logo
                  que subes se guarda como un fichero nuevo: las facturas ya emitidas siguen
                  mostrando el que tenían el día que se emitieron.
                </p>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={subiendoLogo}
                  onChange={(e) => {
                    const archivo = e.target.files?.[0];
                    e.target.value = "";
                    if (archivo) void subirLogo(archivo);
                  }}
                />
                {subiendoLogo && <p className="text-xs text-muted-foreground">Subiendo…</p>}
                {form.logo_url && (
                  <div className="border rounded-lg p-3 bg-muted/30 flex items-center justify-center h-20">
                    <img
                      src={form.logo_url}
                      alt="Logo de la tienda"
                      className="max-h-full"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  </div>
                )}
                {form.logo_url && (
                  <Button variant="ghost" size="sm" onClick={() => set("logo_url", "")}>
                    Quitar el logo
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Acuérdate de pulsar «Guardar cambios» para que quede asociado a la tienda.
                </p>
              </div>
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
        <PlantillasCorreo tiendaId={tiendaId} isAdmin={isAdmin} />

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

/**
 * Las plantillas de correo de una tienda.
 *
 * No deja guardar una plantilla con una variable que no existe: si se cuela,
 * el cliente recibe un correo con `{{clietne_nombre}}` escrito tal cual, y de
 * eso te enteras cuando ya lo ha leído.
 */
function PlantillasCorreo({ tiendaId, isAdmin }: { tiendaId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [cuerpoHtml, setCuerpoHtml] = useState("");
  const [formato, setFormato] = useState<"texto" | "html">("texto");
  const [activa, setActiva] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [remitenteNombre, setRemitenteNombre] = useState("");
  const [remitenteEmail, setRemitenteEmail] = useState("");

  const { data: tiendaCorreo } = useQuery({
    queryKey: ["tienda-remitente", tiendaId],
    queryFn: async () =>
      (
        await tabla(supabase, "tiendas")
          .select("correo_remitente_nombre, correo_remitente_email")
          .eq("id", tiendaId)
          .maybeSingle()
      ).data,
  });

  useEffect(() => {
    if (tiendaCorreo) {
      setRemitenteNombre(tiendaCorreo.correo_remitente_nombre ?? "");
      setRemitenteEmail(tiendaCorreo.correo_remitente_email ?? "");
    }
  }, [tiendaCorreo]);

  async function guardarRemitente() {
    setGuardando(true);
    try {
      const { error } = await tabla(supabase, "tiendas")
        .update({
          correo_remitente_nombre: remitenteNombre.trim() || null,
          correo_remitente_email: remitenteEmail.trim() || null,
        })
        .eq("id", tiendaId);
      if (error) throw error;
      toast.success("Remitente guardado");
      qc.invalidateQueries({ queryKey: ["tienda-remitente", tiendaId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const { data: plantilla, isLoading } = useQuery({
    queryKey: ["plantilla-correo", tiendaId, "pedido_enviado"],
    queryFn: async () =>
      (
        await tabla(supabase, "tienda_plantillas_correo")
          // select("*"): nombrar las columnas nuevas rompería la pantalla
          // entera mientras la migración no esté aplicada.
          .select("*")
          .eq("tienda_id", tiendaId)
          .eq("clave", "pedido_enviado")
          .maybeSingle()
      ).data,
  });

  useEffect(() => {
    if (plantilla) {
      setAsunto(plantilla.asunto ?? "");
      setCuerpo(plantilla.cuerpo ?? "");
      setCuerpoHtml(plantilla.cuerpo_html ?? "");
      setFormato(plantilla.formato === "html" ? "html" : "texto");
      setActiva(plantilla.activa ?? true);
    }
  }, [plantilla]);

  const erratas = erratasEnPlantilla(asunto, cuerpo, formato === "html" ? cuerpoHtml : "");

  async function guardarPlantilla() {
    if (erratas.length > 0) {
      toast.error(`Hay variables que no existen: ${erratas.map((e) => `{{${e}}}`).join(", ")}`);
      return;
    }
    if (formato === "html" && !cuerpoHtml.trim()) {
      toast.error("En formato HTML hace falta escribir la maqueta");
      return;
    }
    setGuardando(true);
    try {
      const { error } = await tabla(supabase, "tienda_plantillas_correo")
        .update({ asunto, cuerpo, cuerpo_html: cuerpoHtml || null, formato, activa })
        .eq("id", plantilla?.id);
      if (error) throw error;
      toast.success("Plantilla guardada");
      qc.invalidateQueries({ queryKey: ["plantilla-correo", tiendaId, "pedido_enviado"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <TabsContent value="correos" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remitente de esta tienda</CardTitle>
          <CardDescription>
            Desde qué dirección salen los avisos de esta tienda. Al revés que la factura, que
            siempre va a nombre de la sociedad: el correo lo recibe alguien que compró en esta
            tienda y espera ver esta marca.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nombre visible</Label>
              <Input
                value={remitenteNombre}
                onChange={(e) => setRemitenteNombre(e.target.value)}
                placeholder="DTF Culture"
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección</Label>
              <Input
                type="email"
                value={remitenteEmail}
                onChange={(e) => setRemitenteEmail(e.target.value)}
                placeholder="pedidos@dtfculture.com"
                disabled={!isAdmin}
              />
            </div>
          </div>
          <Alert>
            <AlertDescription>
              El proveedor solo deja enviar desde dominios verificados. Si esta dirección es de un
              dominio que no has verificado, el correo no saldrá.
            </AlertDescription>
          </Alert>
          {isAdmin && (
            <Button onClick={guardarRemitente} disabled={guardando}>
              Guardar remitente
            </Button>
          )}
        </CardContent>
      </Card>

      <ServidorDeCorreo tiendaId={tiendaId} isAdmin={isAdmin} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aviso de pedido enviado</CardTitle>
          <CardDescription>
            El correo que recibe el cliente cuando marcas su pedido como enviado. El texto es de
            esta tienda; cada una puede tener el suyo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : !plantilla ? (
            <Alert>
              <AlertDescription>
                Esta tienda todavía no tiene plantilla. Se crea sola al dar de alta la tienda; si
                ves esto, avisa.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Enviar este aviso</p>
                  <p className="text-xs text-muted-foreground">
                    Desactivado, el texto se conserva pero no se manda nada.
                  </p>
                </div>
                <SwitchCorreo checked={activa} onCheckedChange={setActiva} disabled={!isAdmin} />
              </div>

              <div className="space-y-1.5">
                <Label>Asunto</Label>
                <Input
                  value={asunto}
                  onChange={(e) => setAsunto(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>

              <Tabs value={formato} onValueChange={(v) => setFormato(v as "texto" | "html")}>
                <TabsList>
                  <TabsTrigger value="texto">Texto</TabsTrigger>
                  <TabsTrigger value="html">HTML y CSS</TabsTrigger>
                </TabsList>

                <TabsContent value="texto" className="space-y-1.5 mt-4">
                  <Label>Cuerpo</Label>
                  <Textarea
                    value={cuerpo}
                    onChange={(e) => setCuerpo(e.target.value)}
                    rows={12}
                    disabled={!isAdmin}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Texto plano. Los saltos de línea se respetan.
                  </p>
                </TabsContent>

                <TabsContent value="html" className="space-y-4 mt-4">
                  <div className="space-y-1.5">
                    <Label>Maqueta HTML</Label>
                    <Textarea
                      value={cuerpoHtml}
                      onChange={(e) => setCuerpoHtml(e.target.value)}
                      rows={18}
                      disabled={!isAdmin}
                      className="font-mono text-xs"
                      placeholder={PLANTILLA_HTML_EJEMPLO}
                    />
                  </div>

                  <Alert>
                    <AlertDescription className="text-xs space-y-1">
                      <p>
                        El CSS que pongas en un <code>&lt;style&gt;</code> se pasa a estilos en
                        línea al enviar. Hace falta: Outlook pinta con el motor de Word y varios
                        clientes de Gmail descartan el bloque <code>&lt;style&gt;</code>.
                      </p>
                      <p>
                        Por lo mismo, maqueta con <code>&lt;table&gt;</code> y no con flexbox ni
                        grid, que Outlook no entiende. Las imágenes tienen que estar en una URL
                        pública.
                      </p>
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-1.5">
                    <Label>Versión en texto</Label>
                    <Textarea
                      value={cuerpo}
                      onChange={(e) => setCuerpo(e.target.value)}
                      rows={6}
                      disabled={!isAdmin}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      La que ven los clientes de correo que no pintan HTML. Si la dejas vacía se
                      saca del propio HTML, pero escribirla baja la puntuación de spam.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              {erratas.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Estas variables no existen y saldrían escritas tal cual en el correo:{" "}
                    {erratas.map((e) => `{{${e}}}`).join(", ")}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Variables disponibles</Label>
                <div className="grid gap-1 sm:grid-cols-2">
                  {VARIABLES_PEDIDO_ENVIADO.map((v) => (
                    <div key={v.clave} className="text-xs">
                      <code className="bg-muted px-1 py-0.5 rounded">{`{{${v.clave}}}`}</code>{" "}
                      <span className="text-muted-foreground">{v.descripcion}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Vista previa</Label>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <p className="text-sm font-medium">{vistaPrevia(asunto)}</p>
                  {formato === "html" ? (
                    // En un iframe aislado y no incrustado en la página: la
                    // maqueta trae su propio CSS y, metida en el DOM del CRM,
                    // se lo pintaría encima.
                    <iframe
                      title="Vista previa del correo"
                      sandbox=""
                      className="w-full h-96 rounded border bg-white"
                      srcDoc={vistaPreviaHtml(cuerpoHtml)}
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{vistaPrevia(cuerpo)}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Con datos de muestra. El correo real lleva los del pedido.
                </p>
              </div>

              {isAdmin && (
                <Button onClick={guardarPlantilla} disabled={guardando || erratas.length > 0}>
                  {guardando ? "Guardando…" : "Guardar plantilla"}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          El aviso sale solo al marcar un pedido como enviado, una vez por pedido. Si el envío falla
          queda registrado con el motivo, y el estado del pedido se guarda igualmente.
        </AlertDescription>
      </Alert>
    </TabsContent>
  );
}

/**
 * El servidor de correo de una tienda.
 *
 * Casi siempre se usa el general: una cuenta de Resend con varios dominios
 * verificados y un remitente por tienda. Por eso lo normal es ver solo el aviso
 * de que se usa el general, y el formulario aparece si de verdad hace falta
 * separar esta tienda.
 */
function ServidorDeCorreo({ tiendaId, isAdmin }: { tiendaId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const estadoFn = useServerFn(estadoSmtp);
  const generalFn = useServerFn(usarSmtpGeneral);

  const { data } = useQuery({
    queryKey: ["smtp-estado", tiendaId],
    queryFn: () => estadoFn({ data: { tienda_id: tiendaId } }),
  });
  const estado = (data as any)?.estado ?? null;
  const propia = estado?.ambito === "tienda";

  const volverAGeneral = useMutation({
    mutationFn: () => generalFn({ data: { tienda_id: tiendaId } }),
    onSuccess: () => {
      toast.success("Esta tienda vuelve a usar el servidor general");
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["smtp-estado"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo quitar"),
  });

  if (editando || propia) {
    return (
      <div className="space-y-2">
        <FormularioSmtp tiendaId={tiendaId} />
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (propia ? volverAGeneral.mutate() : setEditando(false))}
            disabled={volverAGeneral.isPending}
          >
            {propia ? "Usar el servidor general" : "Cancelar"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Servidor de correo</CardTitle>
        <CardDescription>
          {estado
            ? `Esta tienda usa el servidor general: ${estado.host}.`
            : "No hay ningún servidor de correo configurado todavía, así que los avisos no salen."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/panel/configuracion-correo">Configurar el general</Link>
        </Button>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
            Usar un servidor propio para esta tienda
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Un punto de partida para quien nunca ha maquetado un correo. */
const PLANTILLA_HTML_EJEMPLO = `<style>
  .caja { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
  .cabecera { background: #f97316; color: #fff; padding: 20px; }
  .boton { background: #111; color: #fff; padding: 12px 20px;
           text-decoration: none; display: inline-block; }
</style>
<table class="caja" cellpadding="0" cellspacing="0" width="100%">
  <tr><td class="cabecera"><h1>{{tienda_nombre}}</h1></td></tr>
  <tr><td style="padding: 20px">
    <p>Hola {{cliente_nombre}},</p>
    <p>Tu pedido {{pedido_numero}} ya va de camino.</p>
    <p><a class="boton" href="{{seguimiento_url}}">Seguir el envio</a></p>
  </td></tr>
</table>`;
