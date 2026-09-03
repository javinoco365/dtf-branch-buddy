import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
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
import {
  Plus,
  Store,
  ShoppingBag,
  Receipt,
  KeyRound,
  Building2,
  Pencil,
  Trash2,
  Power,
  PowerOff,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { guardarCredencialesWoo } from "@/lib/admin.functions";
import {
  actualizarTienda,
  activarTienda,
  eliminarTienda,
  resumenBorradoTienda,
} from "@/lib/tiendas.functions";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";

export const Route = createFileRoute("/panel/tiendas/")({
  head: () => ({ meta: [{ title: "Tiendas · CRM DTF" }] }),
  validateSearch: (s: Record<string, unknown>): { nueva?: 1 } =>
    s.nueva === 1 || s.nueva === "1" ? { nueva: 1 } : {},
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

  const [editando, setEditando] = useState<any>(null);
  const [borrando, setBorrando] = useState<any>(null);

  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tiendas").select("*").order("nombre");
      if (error) throw error;
      return data;
    },
  });

  function refrescar() {
    qc.invalidateQueries({ queryKey: ["tiendas"] });
    qc.invalidateQueries({ queryKey: ["tiendas-sidebar"] });
  }

  const activarFn = useServerFn(activarTienda);
  const activar = useMutation({
    mutationFn: (v: { id: string; activa: boolean }) => activarFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.activa ? "Tienda activada" : "Tienda desactivada");
      refrescar();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo cambiar el estado"),
  });

  const borrarFn = useServerFn(eliminarTienda);
  const borrar = useMutation({
    mutationFn: (id: string) => borrarFn({ data: { id } }),
    onSuccess: (r: any) => {
      toast.success(`Tienda «${r?.nombre ?? ""}» borrada`);
      setBorrando(null);
      refrescar();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo borrar la tienda"),
  });

  // El resumen se pide al abrir el aviso: sin él no se puede decir qué se
  // lleva por delante, y un «¿seguro?» sin números no avisa de nada.
  const resumenFn = useServerFn(resumenBorradoTienda);
  const { data: resumen, isLoading: cargandoResumen } = useQuery({
    queryKey: ["tienda-resumen-borrado", borrando?.id],
    enabled: !!borrando,
    queryFn: () => resumenFn({ data: { id: borrando.id } }),
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
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nueva tienda
              </Button>
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
        {tiendas.map((t: any) => (
          <Card
            key={t.id}
            className={t.activa === false ? "opacity-60 border-dashed" : "transition-colors"}
          >
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Link
                  to="/panel/tiendas/$tiendaId"
                  params={{ tiendaId: t.id }}
                  className="flex items-center gap-2 hover:underline min-w-0"
                >
                  <Store className="h-5 w-5 shrink-0" style={{ color: t.color ?? undefined }} />
                  <span className="truncate">{t.nombre}</span>
                </Link>
                {t.activa === false && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                    Desactivada
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground space-y-1">
                <div className="truncate">{t.woo_url || "Sin URL configurada"}</div>
                <div>CIF: {t.cif || "—"}</div>
                <div>Sync: {t.sync_enabled ? "✅ Activa" : "⏸ Desactivada"}</div>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap gap-2 pt-1 border-t">
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setEditando(t)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => activar.mutate({ id: t.id, activa: t.activa === false })}
                  >
                    {t.activa === false ? (
                      <>
                        <Power className="h-3.5 w-3.5 mr-1.5" />
                        Activar
                      </>
                    ) : (
                      <>
                        <PowerOff className="h-3.5 w-3.5 mr-1.5" />
                        Desactivar
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-destructive hover:text-destructive"
                    onClick={() => setBorrando(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Borrar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {tiendas.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="text-center py-12 text-muted-foreground">
              No hay tiendas. {isAdmin && "Crea la primera."}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        {editando && (
          <EditarTiendaDialog
            tienda={editando}
            onDone={() => {
              setEditando(null);
              refrescar();
            }}
          />
        )}
      </Dialog>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`la tienda «${borrando?.nombre ?? ""}»`}
        escribirParaConfirmar={borrando?.nombre}
        cargando={borrar.isPending || cargandoResumen}
        impedimento={
          resumen && Number(resumen.facturas_emitidas) > 0
            ? `Tiene ${resumen.facturas_emitidas} factura(s) emitida(s). Una factura ` +
              "emitida no se borra, y sin su tienda no sabría de qué web salió. " +
              "Desactívala: desaparece del menú y las facturas se conservan."
            : null
        }
        consecuencias={consecuenciasDeBorrar(resumen)}
        onConfirmar={() => borrando && borrar.mutate(borrando.id)}
      />
    </div>
  );
}

/** Lo que se va a llevar por delante, en frases y solo lo que existe. */
function consecuenciasDeBorrar(r: any): string[] {
  if (!r) return [];
  const lineas: string[] = [];
  const añadir = (n: number, uno: string, varios: string) => {
    if (Number(n) > 0) lineas.push(`${n} ${Number(n) === 1 ? uno : varios}`);
  };
  añadir(r.pedidos, "pedido", "pedidos");
  añadir(r.clientes, "cliente", "clientes");
  añadir(r.productos, "producto", "productos");
  añadir(r.proyectos, "proyecto", "proyectos");
  añadir(r.facturas_borrador, "factura en borrador", "facturas en borrador");
  if (lineas.length === 0) return ["No cuelga nada de esta tienda."];
  return lineas.map((l) => `Se borrarán ${l}.`);
}

function EditarTiendaDialog({ tienda, onDone }: { tienda: any; onDone: () => void }) {
  const [f, setF] = useState({
    nombre: tienda.nombre ?? "",
    slug: tienda.slug ?? "",
    color: tienda.color ?? "#3b82f6",
    woo_url: tienda.woo_url ?? "",
    sync_enabled: !!tienda.sync_enabled,
  });
  const guardarFn = useServerFn(actualizarTienda);
  const guardar = useMutation({
    mutationFn: () => guardarFn({ data: { id: tienda.id, ...f, slug: f.slug || null } }),
    onSuccess: () => {
      toast.success("Tienda actualizada");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo guardar"),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Editar {tienda.nombre}</DialogTitle>
        <DialogDescription>
          Los datos fiscales de la factura son los de la sociedad, en Configuración. De la tienda
          solo salen el nombre comercial y el logo.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Nombre</Label>
          <Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Identificador</Label>
            <Input
              value={f.slug}
              placeholder={slugify(f.nombre)}
              onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <Input
              type="color"
              value={f.color}
              className="h-10 p-1"
              onChange={(e) => setF({ ...f, color: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>URL de WooCommerce</Label>
          <Input
            value={f.woo_url}
            placeholder="https://…"
            onChange={(e) => setF({ ...f, woo_url: e.target.value })}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label className="cursor-pointer">Sincronización activa</Label>
            <p className="text-xs text-muted-foreground">Necesita URL y credenciales guardadas.</p>
          </div>
          <Switch
            checked={f.sync_enabled}
            onCheckedChange={(v) => setF({ ...f, sync_enabled: v })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => guardar.mutate()} disabled={guardar.isPending || !f.nombre.trim()}>
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </DialogContent>
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
    if (
      f.sync_enabled &&
      (!f.woo_url.trim() || !f.consumer_key.trim() || !f.consumer_secret.trim())
    ) {
      toast.error("Para activar la sincronización necesitas URL + Consumer Key + Secret");
      setTab("woo");
      return;
    }
    setSaving(true);
    try {
      const slug = f.slug || slugify(f.nombre) || null;
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
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="identidad" className="gap-1">
            <Store className="h-3.5 w-3.5" />
            Identidad
          </TabsTrigger>
          <TabsTrigger value="facturacion" className="gap-1">
            <Receipt className="h-3.5 w-3.5" />
            Facturación
          </TabsTrigger>
          <TabsTrigger value="woo" className="gap-1">
            <ShoppingBag className="h-3.5 w-3.5" />
            WooCommerce
          </TabsTrigger>
        </TabsList>

        {/* === IDENTIDAD === */}
        <TabsContent value="identidad" className="space-y-3 mt-4">
          <Row>
            <FieldText
              label="Nombre comercial *"
              v={f.nombre}
              on={(v) => {
                set("nombre", v);
                if (!f.slug) set("slug", slugify(v));
              }}
              placeholder="DTFTextil.es"
            />
            <FieldText
              label="Slug"
              v={f.slug}
              on={(v) => set("slug", slugify(v))}
              placeholder="dtftextil"
            />
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
              <Input
                value={f.color}
                onChange={(e) => set("color", e.target.value)}
                className="w-32 font-mono"
              />
              <span className="text-xs text-muted-foreground">Se usa en el sidebar y badges.</span>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 flex items-start gap-3">
            <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Esta tienda heredará automáticamente los datos fiscales de la SL (razón social, CIF,
                dirección, etc.).
              </p>
              <p>
                Si necesitas modificarlos, ve a{" "}
                <Link to="/panel/configuracion-empresa" className="underline text-primary">
                  Ajustes › Datos de la empresa
                </Link>
                .
              </p>
            </div>
          </div>
        </TabsContent>

        {/* === FACTURACIÓN === */}
        <TabsContent value="facturacion" className="space-y-3 mt-4">
          <Row>
            <FieldText
              label="Serie de factura"
              v={f.serie_factura}
              on={(v) => set("serie_factura", v)}
              placeholder="F"
            />
            <FieldNum
              label="Siguiente nº de factura"
              v={f.siguiente_numero_factura}
              on={(v) => set("siguiente_numero_factura", v)}
            />
          </Row>
          <Row>
            <FieldNum
              label="IVA por defecto (%)"
              v={f.iva_default}
              on={(v) => set("iva_default", v)}
              step="0.01"
            />
            <FieldNum
              label="Gastos de envío (€)"
              v={f.gastos_envio_default}
              on={(v) => set("gastos_envio_default", v)}
              step="0.01"
            />
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
          {f.nombre ? (
            <>
              Creando <strong>{f.nombre}</strong>
            </>
          ) : (
            "Empieza por el nombre"
          )}
        </div>
        <div className="flex gap-2">
          {tab !== "identidad" && (
            <Button
              variant="ghost"
              onClick={() => setTab(tab === "facturacion" ? "identidad" : "facturacion")}
            >
              Anterior
            </Button>
          )}
          {tab !== "woo" ? (
            <Button onClick={() => setTab(tab === "identidad" ? "facturacion" : "woo")}>
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
