import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  User,
  Mail,
  Phone,
  MapPin,
  FileText,
  ShoppingCart,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/clientes")({
  component: Clientes,
});

type Cliente = {
  id: string;
  tienda_id: string;
  woo_customer_id: number | null;
  nombre: string;
  email: string | null;
  telefono: string | null;
  nif: string | null;
  empresa: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string | null;
  notas: string | null;
};

const empty = (tiendaId: string): Partial<Cliente> => ({
  tienda_id: tiendaId,
  nombre: "",
  email: "",
  telefono: "",
  nif: "",
  empresa: "",
  direccion: "",
  codigo_postal: "",
  ciudad: "",
  provincia: "",
  pais: "España",
  notas: "",
});

function Clientes() {
  const { tiendaId } = Route.useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Cliente> | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes", tiendaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .eq("tienda_id", tiendaId)
        .order("nombre");
      if (error) throw error;
      return (data ?? []) as Cliente[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.nif ?? "").toLowerCase().includes(q) ||
        (c.telefono ?? "").toLowerCase().includes(q),
    );
  }, [clientes, search]);

  const save = useMutation({
    mutationFn: async (c: Partial<Cliente>) => {
      if (!c.nombre?.trim()) throw new Error("El nombre es obligatorio");
      const payload = {
        tienda_id: tiendaId,
        nombre: c.nombre.trim(),
        email: c.email || null,
        telefono: c.telefono || null,
        nif: c.nif || null,
        empresa: c.empresa || null,
        direccion: c.direccion || null,
        codigo_postal: c.codigo_postal || null,
        ciudad: c.ciudad || null,
        provincia: c.provincia || null,
        pais: c.pais || null,
        notas: c.notas || null,
      };
      if (c.id) {
        const { error } = await supabase.from("clientes").update(payload).eq("id", c.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clientes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Cliente guardado");
      qc.invalidateQueries({ queryKey: ["clientes", tiendaId] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Fichas de clientes. Importación automática desde pedidos de WooCommerce.
          </p>
        </div>
        <Button onClick={() => setEditing(empty(tiendaId))}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo cliente
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar nombre, email, NIF…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>NIF</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setDetailId(c.id)}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell>{c.email ?? "—"}</TableCell>
                  <TableCell>{c.telefono ?? "—"}</TableCell>
                  <TableCell>{c.nif ?? "—"}</TableCell>
                  <TableCell>{c.ciudad ?? "—"}</TableCell>
                  <TableCell>
                    {c.woo_customer_id ? (
                      <Badge variant="secondary">WooCommerce</Badge>
                    ) : (
                      <Badge variant="outline">Manual</Badge>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Sin clientes
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <ClienteForm
          cliente={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing)}
          saving={save.isPending}
        />
      )}

      {detailId && (
        <ClienteDetalle
          clienteId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(c) => {
            setDetailId(null);
            setEditing(c);
          }}
        />
      )}
    </div>
  );
}

function ClienteForm({
  cliente,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  cliente: Partial<Cliente>;
  onChange: (c: Partial<Cliente>) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = (k: keyof Cliente, v: string) => onChange({ ...cliente, [k]: v });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cliente.id ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Nombre *</Label>
            <Input value={cliente.nombre ?? ""} onChange={(e) => set("nombre", e.target.value)} />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={cliente.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <Label>Teléfono</Label>
            <Input
              value={cliente.telefono ?? ""}
              onChange={(e) => set("telefono", e.target.value)}
            />
          </div>
          <div>
            <Label>NIF / CIF</Label>
            <Input value={cliente.nif ?? ""} onChange={(e) => set("nif", e.target.value)} />
          </div>
          <div>
            <Label>Empresa</Label>
            <Input value={cliente.empresa ?? ""} onChange={(e) => set("empresa", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Dirección</Label>
            <Input
              value={cliente.direccion ?? ""}
              onChange={(e) => set("direccion", e.target.value)}
            />
          </div>
          <div>
            <Label>Código postal</Label>
            <Input
              value={cliente.codigo_postal ?? ""}
              onChange={(e) => set("codigo_postal", e.target.value)}
            />
          </div>
          <div>
            <Label>Ciudad</Label>
            <Input value={cliente.ciudad ?? ""} onChange={(e) => set("ciudad", e.target.value)} />
          </div>
          <div>
            <Label>Provincia</Label>
            <Input
              value={cliente.provincia ?? ""}
              onChange={(e) => set("provincia", e.target.value)}
            />
          </div>
          <div>
            <Label>País</Label>
            <Input value={cliente.pais ?? ""} onChange={(e) => set("pais", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Notas</Label>
            <Textarea
              rows={3}
              value={cliente.notas ?? ""}
              onChange={(e) => set("notas", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClienteDetalle({
  clienteId,
  onClose,
  onEdit,
}: {
  clienteId: string;
  onClose: () => void;
  onEdit: (c: Cliente) => void;
}) {
  const { data: cliente } = useQuery({
    queryKey: ["cliente", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .eq("id", clienteId)
        .maybeSingle();
      if (error) throw error;
      return data as Cliente | null;
    },
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ["cliente-pedidos", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedidos")
        .select("id, numero, estado, total, fecha_pedido")
        .eq("cliente_id", clienteId)
        .order("fecha_pedido", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: facturas = [] } = useQuery({
    queryKey: ["cliente-facturas", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facturas")
        .select("id, serie, numero, fecha, estado, total")
        .eq("cliente_id", clienteId)
        .order("fecha", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!cliente) return null;

  const totalGastado = pedidos.reduce((s, p) => s + Number(p.total ?? 0), 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {cliente.nombre}
            {cliente.woo_customer_id && <Badge variant="secondary">WooCommerce</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {cliente.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {cliente.email}
            </div>
          )}
          {cliente.telefono && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {cliente.telefono}
            </div>
          )}
          {cliente.nif && (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {cliente.nif}
            </div>
          )}
          {(cliente.direccion || cliente.ciudad) && (
            <div className="flex items-center gap-2 col-span-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {[
                cliente.direccion,
                cliente.codigo_postal,
                cliente.ciudad,
                cliente.provincia,
                cliente.pais,
              ]
                .filter(Boolean)
                .join(", ")}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Pedidos</div>
              <div className="text-2xl font-bold">{pedidos.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Facturas</div>
              <div className="text-2xl font-bold">{facturas.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total gastado</div>
              <div className="text-2xl font-bold">{totalGastado.toFixed(2)} €</div>
            </CardContent>
          </Card>
        </div>

        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <ShoppingCart className="h-4 w-4" /> Historial de pedidos
          </h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                      <TableCell>{new Date(p.fecha_pedido).toLocaleDateString("es-ES")}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.estado}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{Number(p.total).toFixed(2)} €</TableCell>
                    </TableRow>
                  ))}
                  {pedidos.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center py-6 text-muted-foreground text-sm"
                      >
                        Sin pedidos
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <Receipt className="h-4 w-4" /> Historial de facturas
          </h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facturas.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono text-xs">
                        {f.serie}-{String(f.numero).padStart(4, "0")}
                      </TableCell>
                      <TableCell>{new Date(f.fecha).toLocaleDateString("es-ES")}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{f.estado}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{Number(f.total).toFixed(2)} €</TableCell>
                    </TableRow>
                  ))}
                  {facturas.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center py-6 text-muted-foreground text-sm"
                      >
                        Sin facturas
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={() => onEdit(cliente)}>Editar cliente</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
