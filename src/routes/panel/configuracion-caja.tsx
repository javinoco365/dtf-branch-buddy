import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  guardarConceptoCaja,
  guardarSocioCaja,
  listarCatalogosCaja,
  type ConceptoCaja,
  type SocioCaja,
} from "@/lib/caja.functions";

export const Route = createFileRoute("/panel/configuracion-caja")({
  head: () => ({ meta: [{ title: "Caja · Ajustes · DTF Culture" }] }),
  component: ConfiguracionCajaPage,
});

const CLAVE = ["caja-catalogos"] as const;

type EntradaConcepto = {
  id?: string;
  nombre: string;
  categoria: "ingreso" | "gasto";
  activo?: boolean;
};
type EntradaSocio = { id?: string; nombre: string; activo?: boolean };

function ConfiguracionCajaPage() {
  const listar = useServerFn(listarCatalogosCaja);
  const { data, isLoading } = useQuery({ queryKey: CLAVE, queryFn: () => listar() });

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <Link
        to="/panel/configuracion"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Ajustes
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Conceptos de caja
          </CardTitle>
          <CardDescription>
            Las opciones del desplegable Concepto. Cada una es de ingreso o de gasto, y eso es lo
            que decide la categoría del apunte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <Conceptos conceptos={data?.conceptos ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Socios</CardTitle>
          <CardDescription>
            Quién pone el dinero en los gastos. No son los usuarios de la aplicación: un socio sigue
            en el libro aunque no entre nunca al CRM.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <Socios socios={data?.socios ?? []} />
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Nada de esto se borra, se desactiva. Un concepto o un socio en uso no se puede borrar sin
        romper los apuntes que lo nombran; desactivarlo lo quita del desplegable y deja intacto lo
        que ya se apuntó.
      </p>
    </div>
  );
}

function Conceptos({ conceptos }: { conceptos: ConceptoCaja[] }) {
  const qc = useQueryClient();
  const guardar = useServerFn(guardarConceptoCaja);
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState<"ingreso" | "gasto">("gasto");

  const mut = useMutation({
    mutationFn: (v: EntradaConcepto) => guardar({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLAVE });
      setNombre("");
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido guardar"),
  });

  const ingresos = conceptos.filter((c) => c.categoria === "ingreso");
  const gastos = conceptos.filter((c) => c.categoria === "gasto");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Grupo titulo="Ingresos" items={ingresos} mut={mut} />
        <Grupo titulo="Gastos" items={gastos} mut={mut} />
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1 flex-1 min-w-48">
          <Label className="text-xs">Nuevo concepto</Label>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Por ejemplo, Transporte"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Categoría</Label>
          <Select value={categoria} onValueChange={(v) => setCategoria(v as "ingreso" | "gasto")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ingreso">Ingreso</SelectItem>
              <SelectItem value="gasto">Gasto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => mut.mutate({ nombre, categoria })}
          disabled={!nombre.trim() || mut.isPending}
        >
          <Plus className="h-4 w-4 mr-1" /> Añadir
        </Button>
      </div>
    </div>
  );
}

function Grupo({
  titulo,
  items,
  mut,
}: {
  titulo: string;
  items: ConceptoCaja[];
  mut: { mutate: (v: EntradaConcepto) => void };
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Ninguno todavía.</p>}
      {items.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <span
            className={`text-sm flex-1 ${c.activo ? "" : "text-muted-foreground line-through"}`}
          >
            {c.nombre}
          </span>
          {!c.activo && <Badge variant="outline">Desactivado</Badge>}
          <Switch
            checked={c.activo}
            onCheckedChange={(v) =>
              mut.mutate({ id: c.id, nombre: c.nombre, categoria: c.categoria, activo: v })
            }
            aria-label={c.activo ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`}
          />
        </div>
      ))}
    </div>
  );
}

function Socios({ socios }: { socios: SocioCaja[] }) {
  const qc = useQueryClient();
  const guardar = useServerFn(guardarSocioCaja);
  const [nombre, setNombre] = useState("");

  const mut = useMutation({
    mutationFn: (v: EntradaSocio) => guardar({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLAVE });
      setNombre("");
    },
    onError: (e: Error) => toast.error(e.message || "No se ha podido guardar"),
  });

  return (
    <div className="space-y-3">
      {socios.length === 0 && <p className="text-sm text-muted-foreground">Ninguno todavía.</p>}
      {socios.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <span
            className={`text-sm flex-1 ${s.activo ? "" : "text-muted-foreground line-through"}`}
          >
            {s.nombre}
          </span>
          {!s.activo && <Badge variant="outline">Desactivado</Badge>}
          <Switch
            checked={s.activo}
            onCheckedChange={(v) => mut.mutate({ id: s.id, nombre: s.nombre, activo: v })}
            aria-label={s.activo ? `Desactivar ${s.nombre}` : `Activar ${s.nombre}`}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1 flex-1 min-w-48">
          <Label className="text-xs">Nuevo socio</Label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <Button onClick={() => mut.mutate({ nombre })} disabled={!nombre.trim() || mut.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Añadir
        </Button>
      </div>
    </div>
  );
}
