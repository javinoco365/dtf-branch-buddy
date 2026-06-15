import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Store } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/panel/tiendas/")({
  head: () => ({ meta: [{ title: "Tiendas · CRM DTF" }] }),
  component: TiendasIndex,
});

function TiendasIndex() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [wooUrl, setWooUrl] = useState("");
  const [cif, setCif] = useState("");

  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tiendas").select("*").order("nombre");
      if (error) throw error;
      return data;
    },
  });

  const crear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tiendas").insert({ nombre, woo_url: wooUrl || null, cif: cif || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tienda creada");
      setOpen(false);
      setNombre(""); setWooUrl(""); setCif("");
      qc.invalidateQueries({ queryKey: ["tiendas"] });
      qc.invalidateQueries({ queryKey: ["tiendas-sidebar"] });
    },
    onError: (e: any) => toast.error(e.message),
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
            <DialogContent>
              <DialogHeader><DialogTitle>Nueva tienda</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>Nombre</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="DTFTextil.es" /></div>
                <div className="space-y-2"><Label>URL WooCommerce</Label><Input value={wooUrl} onChange={(e) => setWooUrl(e.target.value)} placeholder="https://mitienda.com" /></div>
                <div className="space-y-2"><Label>CIF</Label><Input value={cif} onChange={(e) => setCif(e.target.value)} placeholder="B12345678" /></div>
              </div>
              <DialogFooter><Button onClick={() => crear.mutate()} disabled={!nombre || crear.isPending}>Crear</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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