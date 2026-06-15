import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { guardarCredencialesWoo, tieneCredencialesWoo } from "@/lib/admin.functions";
import { sincronizarWoo } from "@/lib/woocommerce.functions";
import { RefreshCw, KeyRound } from "lucide-react";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/ajustes")({ component: Ajustes });

function Ajustes() {
  const { tiendaId } = Route.useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const guardarCreds = useServerFn(guardarCredencialesWoo);
  const checkCreds = useServerFn(tieneCredencialesWoo);
  const sync = useServerFn(sincronizarWoo);

  const { data: tienda } = useQuery({
    queryKey: ["tienda", tiendaId],
    queryFn: async () => (await supabase.from("tiendas").select("*").eq("id", tiendaId).maybeSingle()).data,
  });

  const [form, setForm] = useState<any>({});
  useEffect(() => { if (tienda) setForm(tienda); }, [tienda]);

  const [ck, setCk] = useState("");
  const [cs, setCs] = useState("");
  const [tieneCreds, setTieneCreds] = useState(false);
  useEffect(() => { checkCreds({ data: { tienda_id: tiendaId } }).then((r) => setTieneCreds(r.tiene)); }, [tiendaId, checkCreds]);

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tiendas").update({
        nombre: form.nombre, razon_social: form.razon_social, cif: form.cif,
        direccion: form.direccion, codigo_postal: form.codigo_postal, ciudad: form.ciudad,
        provincia: form.provincia, email_fiscal: form.email_fiscal, telefono: form.telefono,
        woo_url: form.woo_url, sync_enabled: form.sync_enabled, serie_factura: form.serie_factura,
      }).eq("id", tiendaId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Guardado"); qc.invalidateQueries({ queryKey: ["tienda", tiendaId] }); qc.invalidateQueries({ queryKey: ["tiendas-sidebar"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const guardarCredsM = useMutation({
    mutationFn: async () => { await guardarCreds({ data: { tienda_id: tiendaId, consumer_key: ck, consumer_secret: cs } }); },
    onSuccess: () => { toast.success("Credenciales guardadas"); setCk(""); setCs(""); setTieneCreds(true); },
    onError: (e: any) => toast.error(e.message),
  });

  const sincronizar = useMutation({
    mutationFn: async () => await sync({ data: { tienda_id: tiendaId } }),
    onSuccess: (r: any) => { toast.success(`Sincronizado: ${r.pedidos} pedidos, ${r.clientes} clientes, ${r.productos} productos`); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!isAdmin) return <Card><CardContent className="py-8 text-center text-muted-foreground">Solo administradores</CardContent></Card>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader><CardTitle>Datos fiscales</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre" v={form.nombre} on={(v) => setForm({ ...form, nombre: v })} />
          <Field label="Razón social" v={form.razon_social} on={(v) => setForm({ ...form, razon_social: v })} />
          <Field label="CIF" v={form.cif} on={(v) => setForm({ ...form, cif: v })} />
          <Field label="Email fiscal" v={form.email_fiscal} on={(v) => setForm({ ...form, email_fiscal: v })} />
          <Field label="Dirección" v={form.direccion} on={(v) => setForm({ ...form, direccion: v })} />
          <Field label="CP" v={form.codigo_postal} on={(v) => setForm({ ...form, codigo_postal: v })} />
          <Field label="Ciudad" v={form.ciudad} on={(v) => setForm({ ...form, ciudad: v })} />
          <Field label="Provincia" v={form.provincia} on={(v) => setForm({ ...form, provincia: v })} />
          <Field label="Teléfono" v={form.telefono} on={(v) => setForm({ ...form, telefono: v })} />
          <Field label="Serie factura" v={form.serie_factura} on={(v) => setForm({ ...form, serie_factura: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>WooCommerce</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="URL de la tienda" v={form.woo_url} on={(v) => setForm({ ...form, woo_url: v })} placeholder="https://mitienda.com" />
          <div className="flex items-center gap-3">
            <Switch checked={!!form.sync_enabled} onCheckedChange={(c) => setForm({ ...form, sync_enabled: c })} />
            <Label>Sincronización activa</Label>
          </div>
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm"><KeyRound className="h-4 w-4" />Credenciales API {tieneCreds && <span className="text-green-600">· guardadas</span>}</div>
            <p className="text-xs text-muted-foreground">Las claves se almacenan cifradas en el servidor y nunca se envían al navegador.</p>
            <Input placeholder="Consumer Key" value={ck} onChange={(e) => setCk(e.target.value)} />
            <Input placeholder="Consumer Secret" type="password" value={cs} onChange={(e) => setCs(e.target.value)} />
            <Button variant="outline" onClick={() => guardarCredsM.mutate()} disabled={!ck || !cs || guardarCredsM.isPending}>Guardar credenciales</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>Guardar cambios</Button>
        <Button variant="secondary" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending || !form.sync_enabled || !tieneCreds}>
          <RefreshCw className={`h-4 w-4 mr-2 ${sincronizar.isPending ? "animate-spin" : ""}`} />
          Sincronizar WooCommerce
        </Button>
      </div>
    </div>
  );
}

function Field({ label, v, on, placeholder }: { label: string; v: any; on: (v: string) => void; placeholder?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input value={v ?? ""} onChange={(e) => on(e.target.value)} placeholder={placeholder} /></div>;
}