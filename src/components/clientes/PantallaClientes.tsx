import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFiltrosUrl, useTextoDiferido } from "@/lib/filtros-url";
import { tabla } from "@/lib/rpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Pencil,
  Trash2,
  Shirt,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { eur, fechaCorta } from "@/lib/format";
import {
  etiquetaOrigen,
  filtrarClientes,
  totalDePedidos,
  type FiltroOrigen,
  type OrigenCliente,
} from "@/dominio/clientes";

type Cliente = {
  id: string;
  tienda_id: string | null;
  origen: OrigenCliente | null;
  woo_customer_id: number | null;
  nombre: string;
  apodo: string | null;
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

/** Desde dónde se abre la pantalla: decide el filtro inicial y el origen de un alta. */
export type ContextoClientes =
  { tipo: "tienda"; tiendaId: string } | { tipo: "textil" } | { tipo: "general" };

const vacio: Partial<Cliente> = {
  nombre: "",
  apodo: "",
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
};

/** Las listas que enseñan clientes en otros sitios, para refrescarlas todas a la vez. */
const CLAVES_CLIENTES = [["clientes-empresa"], ["textil-clientes"], ["caja-clientes"]] as const;

function filtroInicial(contexto: ContextoClientes): FiltroOrigen {
  if (contexto.tipo === "tienda") return `tienda:${contexto.tiendaId}`;
  if (contexto.tipo === "textil") return "textil";
  return "todos";
}

/**
 * La ficha única de clientes de la empresa.
 *
 * La misma pantalla sirve para cada tienda, para el textil y para la vista
 * general: todas leen la misma tabla. Lo que cambia según desde dónde se abra
 * es el filtro con el que empieza —los de esa tienda, los del textil, o todos—
 * y qué origen se apunta al dar de alta uno nuevo. El filtro se puede cambiar
 * a «Todos» desde cualquiera: un cliente de una tienda que encarga camisetas
 * es el mismo cliente.
 */
export function PantallaClientes({ contexto }: { contexto: ContextoClientes }) {
  const qc = useQueryClient();
  // Los filtros viven en la dirección. El origen por defecto depende de desde
  // dónde se entra: la tienda, el textil o todos.
  const { valores: filtros, cambiar } = useFiltrosUrl({ q: "", origen: filtroInicial(contexto) });
  const [texto, setTexto] = useTextoDiferido(filtros.q, (q) => cambiar({ q }));
  const origen = filtros.origen as FiltroOrigen;
  const setOrigen = (o: FiltroOrigen) => cambiar({ origen: o });
  const [editing, setEditing] = useState<Partial<Cliente> | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<Cliente | null>(null);

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes-empresa"],
    queryFn: async () => {
      // tabla() y no .from(): types.ts está generado y todavía no conoce
      // apodo ni origen. Se quita cuando se regenere.
      const { data, error } = await tabla(supabase, "clientes").select("*").order("nombre");
      if (error) throw error;
      return (data ?? []) as Cliente[];
    },
  });

  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas-para-cliente"],
    queryFn: async () => {
      const { data } = await supabase.from("tiendas").select("id, nombre").order("nombre");
      return (data ?? []) as { id: string; nombre: string }[];
    },
  });
  const nombreTienda = (id: string) => tiendas.find((t) => t.id === id)?.nombre;

  const filtrados = useMemo(
    () => filtrarClientes(clientes, { texto: filtros.q, origen }),
    [clientes, filtros.q, origen],
  );

  function refrescar() {
    for (const clave of CLAVES_CLIENTES) qc.invalidateQueries({ queryKey: [...clave] });
  }

  const save = useMutation({
    mutationFn: async (c: Partial<Cliente>) => {
      if (!c.nombre?.trim()) throw new Error("El nombre es obligatorio");
      const payload = {
        nombre: c.nombre.trim(),
        apodo: c.apodo?.trim() || null,
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
        // Editar no toca tienda ni origen: siguen diciendo dónde se dio de
        // alta, aunque se edite desde otra tienda o desde el textil.
        const { error } = await tabla(supabase, "clientes").update(payload).eq("id", c.id);
        if (error) throw error;
        return;
      }
      const alta =
        contexto.tipo === "tienda"
          ? { tienda_id: contexto.tiendaId, origen: "tienda" }
          : { tienda_id: null, origen: contexto.tipo };
      const { error } = await tabla(supabase, "clientes").insert({ ...payload, ...alta });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente guardado");
      refrescar();
      if (editing?.id) qc.invalidateQueries({ queryKey: ["cliente", editing.id] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Pedidos, facturas, apuntes de caja y documentos del textil llevan
  // cliente_id ON DELETE SET NULL: borrar la ficha no destruye el historial,
  // solo lo deja sin ficha.
  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabla(supabase, "clientes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Cliente borrado");
      refrescar();
      setBorrando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const titulo =
    contexto.tipo === "textil"
      ? "Clientes textil"
      : contexto.tipo === "tienda"
        ? "Clientes de la tienda"
        : "Clientes";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground">
            Una sola ficha por cliente para toda la empresa: las tiendas y el textil comparten la
            misma lista.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...vacio })}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo cliente
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar nombre, apodo, email, NIF, teléfono…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={origen} onValueChange={(v) => setOrigen(v as FiltroOrigen)}>
          <SelectTrigger className="w-56" aria-label="Origen">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los clientes</SelectItem>
            <SelectItem value="textil">Dados de alta en textil</SelectItem>
            <SelectItem value="general">Dados de alta en general</SelectItem>
            {tiendas.map((t) => (
              <SelectItem key={t.id} value={`tienda:${t.id}`}>
                Dados de alta en {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="self-center text-sm text-muted-foreground">
          {filtrados.length} de {clientes.length}
        </span>
      </div>

      {contexto.tipo === "general" && (
        <DuplicadosClientes clientes={clientes} onVer={(id) => setDetailId(id)} />
      )}

      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
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
              {filtrados.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setDetailId(c.id)}>
                  <TableCell className="font-medium">
                    {c.nombre}
                    {c.apodo && (
                      <div className="text-xs font-normal text-muted-foreground">{c.apodo}</div>
                    )}
                  </TableCell>
                  <TableCell>{c.email ?? "—"}</TableCell>
                  <TableCell>{c.telefono ?? "—"}</TableCell>
                  <TableCell>{c.nif ?? "—"}</TableCell>
                  <TableCell>{c.ciudad ?? "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <Badge variant="outline">{etiquetaOrigen(c, nombreTienda)}</Badge>
                      {c.woo_customer_id && <Badge variant="secondary">WooCommerce</Badge>}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Borrar"
                      onClick={() => setBorrando(c)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {clientes.length === 0
                      ? "Sin clientes"
                      : "Ningún cliente con este filtro. Prueba con «Todos los clientes»."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`el cliente ${borrando?.nombre ?? ""}`}
        consecuencias={[
          "Es la ficha de toda la empresa: desaparece de todas las tiendas y del textil.",
          "Sus pedidos, presupuestos, facturas y apuntes de caja no se borran: se quedan sin ficha de cliente asociada.",
          borrando?.woo_customer_id
            ? "Viene de WooCommerce: la próxima sincronización volverá a crearlo."
            : "",
        ].filter(Boolean)}
        cargando={borrar.isPending}
        onConfirmar={() => borrando && borrar.mutate(borrando.id)}
      />

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

/**
 * Fichas que comparten correo o NIF, para revisarlas.
 *
 * No fusiona nada: juntar dos fichas es mover pedidos, facturas y apuntes de
 * una a otra y decidir qué datos fiscales se quedan, y eso lo decide una
 * persona. La fusión llega en un paso posterior. Si la vista no existe
 * todavía —la migración no está aplicada— no se enseña nada.
 */
function DuplicadosClientes({
  clientes,
  onVer,
}: {
  clientes: Cliente[];
  onVer: (id: string) => void;
}) {
  const { data: grupos = [] } = useQuery({
    queryKey: ["clientes-duplicados"],
    queryFn: async () => {
      const { data, error } = await tabla(supabase, "clientes_posibles_duplicados").select(
        "motivo, clave, fichas, cliente_ids",
      );
      if (error && (error.code === "42P01" || error.code === "PGRST205")) return [];
      if (error) throw error;
      return (data ?? []) as {
        motivo: "email" | "nif";
        clave: string;
        fichas: number;
        cliente_ids: string[];
      }[];
    },
  });

  if (grupos.length === 0) return null;
  const porId = new Map(clientes.map((c) => [c.id, c]));

  return (
    <Card className="border-status-pendiente/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Copy className="h-4 w-4 text-status-pendiente" />
          Posibles duplicados ({grupos.length})
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Fichas que comparten correo o NIF. Revísalas: la fusión, que junta el historial en una
          sola ficha, llega en el siguiente paso. Mientras, no borres la que sobre para juntarlas:
          sus pedidos se quedarían sin cliente.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {grupos.map((g) => (
          <div key={`${g.motivo}:${g.clave}`} className="rounded-md border p-3 text-sm">
            <div className="text-xs text-muted-foreground mb-1">
              Mismo {g.motivo === "email" ? "correo" : "NIF"}:{" "}
              <span className="font-mono">{g.clave}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.cliente_ids.map((id) => (
                <Button key={id} variant="outline" size="sm" onClick={() => onVer(id)}>
                  {porId.get(id)?.nombre ?? "Ficha sin acceso"}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
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
            <p className="text-xs text-muted-foreground mt-1">
              El nombre o razón social tal cual va en la factura. No lo toca la sincronización de
              WooCommerce ni se cambia solo.
            </p>
          </div>
          <div className="col-span-2">
            <Label>Apodo</Label>
            <Input value={cliente.apodo ?? ""} onChange={(e) => set("apodo", e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              Cómo lo llamáis vosotros, si es distinto del nombre fiscal — por ejemplo «Martí» para
              «Martí &amp; Hijos S.L.». Solo para encontrarlo rápido: nunca sale en una factura.
            </p>
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
      const { data, error } = await tabla(supabase, "clientes")
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

  // El mismo cliente, sus pedidos del textil: es la razón de tener una sola ficha.
  const { data: pedidosTextil = [] } = useQuery({
    queryKey: ["cliente-pedidos-textil", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("textil_pedidos")
        .select("id, numero, estado, total, fecha")
        .eq("cliente_id", clienteId)
        .order("fecha", { ascending: false });
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

  const totalPedidos = totalDePedidos(pedidos, pedidosTextil);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {cliente.apodo || cliente.nombre}
            {cliente.woo_customer_id && <Badge variant="secondary">WooCommerce</Badge>}
          </DialogTitle>
          {cliente.apodo && <p className="text-sm text-muted-foreground">{cliente.nombre}</p>}
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Resumen titulo="Pedidos tiendas" valor={String(pedidos.length)} />
          <Resumen titulo="Pedidos textil" valor={String(pedidosTextil.length)} />
          <Resumen titulo="Facturas" valor={String(facturas.length)} />
          <Resumen titulo="Total pedidos" valor={eur(totalPedidos)} />
        </div>

        <Historial
          titulo="Pedidos de las tiendas"
          icono={<ShoppingCart className="h-4 w-4" />}
          vacio="Sin pedidos en las tiendas"
          filas={pedidos.map((p) => ({
            id: p.id,
            ref: p.numero,
            fecha: p.fecha_pedido,
            estado: p.estado,
            total: Number(p.total),
          }))}
        />
        <Historial
          titulo="Pedidos del textil"
          icono={<Shirt className="h-4 w-4" />}
          vacio="Sin pedidos del textil"
          filas={pedidosTextil.map((p) => ({
            id: p.id,
            ref: p.numero,
            fecha: p.fecha,
            estado: p.estado,
            total: Number(p.total),
          }))}
        />
        <Historial
          titulo="Facturas"
          icono={<Receipt className="h-4 w-4" />}
          vacio="Sin facturas"
          filas={facturas.map((f) => ({
            id: f.id,
            ref: `${f.serie}-${String(f.numero).padStart(4, "0")}`,
            fecha: f.fecha,
            estado: f.estado,
            total: Number(f.total),
          }))}
        />

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

function Resumen({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{titulo}</div>
        <div className="text-xl font-bold tabular-nums">{valor}</div>
      </CardContent>
    </Card>
  );
}

function Historial({
  titulo,
  icono,
  vacio,
  filas,
}: {
  titulo: string;
  icono: React.ReactNode;
  vacio: string;
  filas: { id: string; ref: string; fecha: string; estado: string; total: number }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
        {icono} {titulo}
      </h3>
      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.ref}</TableCell>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{f.estado}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{eur(f.total)}</TableCell>
                </TableRow>
              ))}
              {filas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">
                    {vacio}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
