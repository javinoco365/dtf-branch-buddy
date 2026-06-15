import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { crearUsuarioInvitado } from "@/lib/admin.functions";

export const Route = createFileRoute("/panel/usuarios")({ component: Usuarios });
function Usuarios() {
  const { isAdmin } = useAuth();
  const crear = useServerFn(crearUsuarioInvitado);
  const qc = useQueryClient();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [nombre, setNombre] = useState("");
  const [admin, setAdmin] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>([]);

  const { data: tiendas = [] } = useQuery({ queryKey: ["tiendas"], queryFn: async () => (await supabase.from("tiendas").select("id, nombre")).data ?? [] });

  const m = useMutation({
    mutationFn: async () => await crear({ data: { email, password: pw, full_name: nombre, admin, tienda_ids: seleccion } }),
    onSuccess: () => { toast.success("Usuario creado"); setEmail(""); setPw(""); setNombre(""); setAdmin(false); setSeleccion([]); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!isAdmin) return <Card><CardContent className="py-8 text-center text-muted-foreground">Solo administradores</CardContent></Card>;

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Invitar usuario</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Nombre</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1 md:col-span-2"><Label>Contraseña inicial</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} /></div>
        </div>
        <div className="flex items-center gap-2"><Checkbox checked={admin} onCheckedChange={(c) => setAdmin(!!c)} /><Label>Administrador</Label></div>
        <div>
          <Label>Acceso a tiendas</Label>
          <div className="mt-2 space-y-1">
            {tiendas.map((t: any) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={seleccion.includes(t.id)} onCheckedChange={(c) => setSeleccion(c ? [...seleccion, t.id] : seleccion.filter((x) => x !== t.id))} />
                {t.nombre}
              </label>
            ))}
          </div>
        </div>
        <Button onClick={() => m.mutate()} disabled={!email || !pw || !nombre || m.isPending}>Crear usuario</Button>
      </CardContent>
    </Card>
  );
}