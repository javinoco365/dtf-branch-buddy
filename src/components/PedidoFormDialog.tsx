import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { createPedidoManual, updatePedido } from "@/lib/pedidos.functions";
import type { PedidoFila } from "@/components/PedidosTable";
import { eur } from "@/lib/format";
import { calcularTotales } from "@/dominio/importes";
import { mismaDireccion, normalizarDireccion, type Direccion } from "@/dominio/direcciones";

type Linea = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_rate: number;
};

const PAGOS = [
  "Transferencia bancaria directa",
  "Bizum",
  "Pago con tarjeta (Redsys)",
  "Contra reembolso",
  "Efectivo",
  "Otro",
];

/** Los campos del bloque de dirección, en el orden en que se escriben. */
const CAMPOS: { clave: keyof Direccion; etiqueta: string; ancho: "medio" | "entero" }[] = [
  { clave: "nombre", etiqueta: "Nombre o razón social", ancho: "entero" },
  { clave: "empresa", etiqueta: "Empresa", ancho: "entero" },
  { clave: "direccion", etiqueta: "Dirección", ancho: "entero" },
  { clave: "codigo_postal", etiqueta: "Código postal", ancho: "medio" },
  { clave: "ciudad", etiqueta: "Ciudad", ancho: "medio" },
  { clave: "provincia", etiqueta: "Provincia", ancho: "medio" },
  { clave: "pais", etiqueta: "País", ancho: "medio" },
  { clave: "telefono", etiqueta: "Teléfono", ancho: "medio" },
  { clave: "email", etiqueta: "Email", ancho: "medio" },
];

/** El formulario trabaja con cadenas: un campo vacío es "", no undefined. */
type DireccionForm = Record<keyof Direccion, string>;

const DIRECCION_VACIA: DireccionForm = {
  nombre: "",
  empresa: "",
  direccion: "",
  codigo_postal: "",
  ciudad: "",
  provincia: "",
  pais: "",
  telefono: "",
  email: "",
};

function aFormulario(d: Direccion | null | undefined): DireccionForm {
  const salida = { ...DIRECCION_VACIA };
  if (!d) return salida;
  for (const campo of Object.keys(DIRECCION_VACIA) as (keyof Direccion)[]) {
    const valor = d[campo];
    if (typeof valor === "string") salida[campo] = valor;
  }
  return salida;
}

export function PedidoFormDialog({
  open,
  onOpenChange,
  tiendaId,
  pedido,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tiendaId: string;
  pedido?: PedidoFila;
  onSaved: () => void;
}) {
  const esEdicion = !!pedido;
  const [cliente, setCliente] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [pago, setPago] = useState<string>("Transferencia bancaria directa");
  const [envio, setEnvio] = useState<number>(0);
  const [notas, setNotas] = useState("");
  const [facturacion, setFacturacion] = useState<DireccionForm>(DIRECCION_VACIA);
  const [entrega, setEntrega] = useState<DireccionForm>(DIRECCION_VACIA);
  const [envioIgual, setEnvioIgual] = useState(true);
  const [lineas, setLineas] = useState<Linea[]>([
    { descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 },
  ]);

  useEffect(() => {
    if (!open) return;
    if (pedido) {
      setCliente(pedido.cliente_nombre ?? "");
      setEmail(pedido.cliente_email ?? "");
      setTelefono(pedido.cliente_telefono ?? "");
      setPago(pedido.metodo_pago ?? "Transferencia bancaria directa");
      setEnvio(Number(pedido.envio ?? 0));
      setNotas(pedido.notas ?? "");
      setFacturacion(aFormulario(pedido.direccion_facturacion));
      setEntrega(aFormulario(pedido.direccion_envio));
      // Se marca «la misma» cuando de verdad lo es, y también cuando no hay
      // dirección de envío pero sí de facturación: es lo que quiere decir un
      // pedido con una sola dirección.
      setEnvioIgual(
        mismaDireccion(pedido.direccion_envio, pedido.direccion_facturacion) ||
          !pedido.direccion_envio,
      );
      setLineas(
        pedido.items.length
          ? pedido.items.map((it) => ({
              descripcion: it.descripcion,
              cantidad: Number(it.cantidad),
              precio_unitario: Number(it.precio_unitario),
              iva_rate: 21,
            }))
          : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 }],
      );
    } else {
      setCliente("");
      setEmail("");
      setTelefono("");
      setPago("Transferencia bancaria directa");
      setEnvio(0);
      setNotas("");
      setFacturacion(DIRECCION_VACIA);
      setEntrega(DIRECCION_VACIA);
      setEnvioIgual(true);
      setLineas([{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 }]);
    }
  }, [open, pedido]);

  const createFn = useServerFn(createPedidoManual);
  const updateFn = useServerFn(updatePedido);

  /**
   * Las dos direcciones tal como se van a guardar.
   *
   * Si el bloque de facturación está entero en blanco, se guarda `null`: un
   * pedido sin dirección es un pedido sin dirección, y la pantalla lo dice.
   * Antes de este `if` se heredaba el nombre del cliente igualmente, así que
   * cualquier pedido acababa con una «dirección» que era solo un nombre y
   * parecía tener datos de envío que no tenía.
   *
   * En cuanto hay algo escrito, el nombre y el correo sí se heredan de los
   * datos del cliente: es la misma persona y obligar a teclearlo dos veces solo
   * consigue etiquetas de envío sin destinatario. No se hereda nada más: una
   * ciudad no se adivina.
   */
  const direcciones = useMemo(() => {
    const escrita = normalizarDireccion(facturacion);
    const fact = escrita
      ? normalizarDireccion({
          ...escrita,
          nombre: escrita.nombre ?? cliente,
          email: escrita.email ?? email,
        })
      : null;
    const env = envioIgual ? fact : normalizarDireccion(entrega);
    return { facturacion: fact, envio: env };
  }, [facturacion, entrega, envioIgual, cliente, email]);

  const mut = useMutation({
    mutationFn: async () => {
      const itemsValidos = lineas.filter((l) => l.descripcion.trim() && l.cantidad > 0);
      if (itemsValidos.length === 0) throw new Error("Añade al menos una línea");
      const comunes = {
        cliente_nombre: cliente,
        cliente_email: email || null,
        cliente_telefono: telefono || null,
        direccion_facturacion: direcciones.facturacion,
        direccion_envio: direcciones.envio,
        metodo_pago: pago,
        envio,
        notas: notas || null,
        items: itemsValidos,
      };
      if (esEdicion && pedido) {
        return updateFn({ data: { id: pedido.id, ...comunes } });
      }
      if (!cliente.trim()) throw new Error("Indica el nombre del cliente");
      return createFn({ data: { tiendaId, ...comunes } });
    },
    onSuccess: () => {
      toast.success(esEdicion ? "Pedido actualizado" : "Pedido creado");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message || "Error al guardar"),
  });

  function setLinea(i: number, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // El envío entra en la base imponible y tributa, que es lo que dice el
  // artículo 78 de la Ley del IVA: los gastos de transporte repercutidos al
  // cliente forman parte de la contraprestación. Antes se sumaba DESPUÉS del
  // IVA, o sea que no tributaba.
  const totales = calcularTotales(lineas, { envio });
  const total = totales.total;

  // El resumen que se lee con el bloque plegado, para no tener que abrirlo solo
  // para comprobar si hay dirección. Quién y dónde, que es lo que se comprueba
  // de un vistazo; la calle entera no cabe y se cortaría a la mitad.
  const resumenDirecciones = (() => {
    if (!direcciones.facturacion && !direcciones.envio) return "Sin dirección";
    const corta = (d: Direccion | null) =>
      d ? [d.nombre || d.empresa, d.ciudad].filter(Boolean).join(" · ") || "Sin nombre" : "—";
    if (envioIgual || mismaDireccion(direcciones.envio, direcciones.facturacion)) {
      return corta(direcciones.facturacion);
    }
    return `Factura a ${corta(direcciones.facturacion)} · Envía a ${corta(direcciones.envio)}`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar pedido" : "Nuevo pedido manual"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cliente</Label>
              <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Método de pago</Label>
              <Select value={pago} onValueChange={setPago}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGOS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Gastos de envío (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={envio}
                onChange={(e) => setEnvio(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <Accordion type="single" collapsible className="border rounded-md px-3">
            <AccordionItem value="direcciones" className="border-none">
              <AccordionTrigger className="hover:no-underline py-3">
                <div className="flex flex-col items-start text-left min-w-0 flex-1">
                  <span className="text-sm font-medium">Direcciones</span>
                  <span className="text-xs text-muted-foreground font-normal truncate max-w-full">
                    {resumenDirecciones}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <BloqueDireccion
                  titulo="Facturación"
                  nota={`El nombre y el email se toman de los datos del cliente si se dejan en blanco.`}
                  valores={facturacion}
                  onChange={setFacturacion}
                />

                <div className="flex items-center gap-2 pt-1 border-t">
                  <Checkbox
                    id="envio-igual"
                    checked={envioIgual}
                    onCheckedChange={(v) => setEnvioIgual(v === true)}
                    className="mt-3"
                  />
                  <Label htmlFor="envio-igual" className="font-normal mt-3 cursor-pointer">
                    El envío va a la misma dirección
                  </Label>
                </div>

                {!envioIgual && (
                  <BloqueDireccion titulo="Envío" valores={entrega} onChange={setEntrega} />
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Líneas</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLineas([
                    ...lineas,
                    { descripcion: "", cantidad: 1, precio_unitario: 0, iva_rate: 21 },
                  ])
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Añadir línea
              </Button>
            </div>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Producto</Label>
                    <Input
                      value={l.descripcion}
                      onChange={(e) => setLinea(i, { descripcion: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={l.cantidad}
                      onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Precio</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={l.precio_unitario}
                      onChange={(e) =>
                        setLinea(i, { precio_unitario: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">IVA %</Label>
                    <Input
                      type="number"
                      step="1"
                      value={l.iva_rate}
                      onChange={(e) => setLinea(i, { iva_rate: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLineas(lineas.filter((_, idx) => idx !== i))}
                      disabled={lineas.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm pt-2 border-t">
            <div>
              Subtotal: <span className="font-medium">{eur(totales.base_imponible)}</span>
            </div>
            <div>
              IVA: <span className="font-medium">{eur(totales.iva_total)}</span>
            </div>
            <div>
              Total: <span className="font-semibold">{eur(total)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notas</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BloqueDireccion({
  titulo,
  nota,
  valores,
  onChange,
}: {
  titulo: string;
  nota?: string;
  valores: DireccionForm;
  onChange: (d: DireccionForm) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </div>
        {nota && <div className="text-xs text-muted-foreground">{nota}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {CAMPOS.map(({ clave, etiqueta, ancho }) => (
          <div key={clave} className={ancho === "entero" ? "col-span-2 space-y-1" : "space-y-1"}>
            <Label className="text-xs">{etiqueta}</Label>
            <Input
              value={valores[clave]}
              onChange={(e) => onChange({ ...valores, [clave]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
