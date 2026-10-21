import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  FileUp,
  ImagePlus,
  Loader2,
  MessageSquareText,
  PencilLine,
  Plus,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  hayIaPresupuestos,
  proponerPresupuesto,
  type PropuestaPresupuesto,
} from "@/lib/presupuestos-ia.functions";
import {
  MAXIMO_BYTES_IMAGEN,
  MAXIMO_IMAGENES_PRESUPUESTO,
  TIPOS_IMAGEN_PRESUPUESTO,
  esTipoImagenPresupuesto,
  recortarImagenes,
} from "@/dominio/imagenes-presupuesto";
import { MAXIMO_BYTES_DOCUMENTO_IA, MAXIMO_BYTES_IMAGEN_IA } from "@/dominio/presupuesto-ia";
import { SiPuede } from "@/components/SiPuede";
import { avisarError } from "@/lib/errores";

export type ModoIa = "documento" | "texto";

/** Lo que sale de la IA: el borrador y las imágenes que se guardarán con él si se guarda. */
export type ResultadoIa = { propuesta: PropuestaPresupuesto; imagenes: File[] };

/**
 * El botón «Nuevo presupuesto» con sus tres formas: a mano (como siempre),
 * desde un documento con IA y escribiéndolo con IA. Sin clave de IA, las dos
 * últimas salen desactivadas y lo dicen.
 */
export function NuevoPresupuestoMenu({
  disabled,
  onManual,
  onIa,
}: {
  disabled?: boolean;
  onManual: () => void;
  onIa: (modo: ModoIa) => void;
}) {
  const hayIa = useServerFn(hayIaPresupuestos);
  const { data } = useQuery({
    queryKey: ["ia-presupuestos-disponible"],
    queryFn: () => hayIa(),
    staleTime: 5 * 60_000,
  });
  const iaLista = data?.disponible === true;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SiPuede accion="escribir">
          <Button disabled={disabled}>
            <Plus className="h-4 w-4 mr-2" /> Nuevo presupuesto
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </SiPuede>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={onManual}>
          <PencilLine className="h-4 w-4 mr-2" />
          <div>
            <div>Rellenarlo a mano</div>
            <div className="text-xs text-muted-foreground">Como siempre.</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Con IA: propone y tú revisas antes de guardar
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={!iaLista} onClick={() => onIa("documento")}>
          <FileUp className="h-4 w-4 mr-2" />
          <div>
            <div>Desde un documento</div>
            <div className="text-xs text-muted-foreground">PDF o imagen, con sus fotos.</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!iaLista} onClick={() => onIa("texto")}>
          <MessageSquareText className="h-4 w-4 mr-2" />
          <div>
            <div>Escribiéndolo</div>
            <div className="text-xs text-muted-foreground">Como en un chat.</div>
          </div>
        </DropdownMenuItem>
        {data && !iaLista && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Falta la clave de la IA (la del lector de facturas).
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ACEPTA_DOCUMENTO = ["application/pdf", ...TIPOS_IMAGEN_PRESUPUESTO].join(",");

/** base64 → File, para tratar las fotos del PDF igual que las que se suben. */
function ficheroDeBase64(base64: string, nombre: string, tipo: string): File {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new File([bytes], nombre, { type: tipo });
}

/**
 * El diálogo que manda a la IA un documento o un texto y devuelve el borrador.
 * No guarda nada: `onBorrador` abre el editor de siempre, relleno.
 */
export function PresupuestoIaDialog({
  modo,
  ambito,
  tiendaId,
  onCerrar,
  onBorrador,
}: {
  modo: ModoIa | null;
  ambito: "tienda" | "textil";
  tiendaId?: string;
  onCerrar: () => void;
  onBorrador: (r: ResultadoIa) => void;
}) {
  const proponer = useServerFn(proponerPresupuesto);
  const [documento, setDocumento] = useState<File | null>(null);
  const [texto, setTexto] = useState("");
  const [imagenes, setImagenes] = useState<File[]>([]);
  const entradaDocumento = useRef<HTMLInputElement>(null);
  const entradaImagenes = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!modo) return;
    setDocumento(null);
    setTexto("");
    setImagenes([]);
  }, [modo]);

  const montar = useMutation({
    meta: { invalida: false }, // no escribe nada: no recarga
    mutationFn: async () => {
      if (modo === "documento" && !documento) throw new Error("Elige el documento.");
      if (modo === "texto" && !texto.trim()) throw new Error("Escribe el presupuesto.");
      if (modo === "documento" && documento) {
        const esFoto = esTipoImagenPresupuesto(documento.type);
        if (esFoto && documento.size > MAXIMO_BYTES_IMAGEN_IA) {
          throw new Error(
            "La foto pesa más de 5 MB: la IA no la admite. Redúcela o guárdala en JPG.",
          );
        }
        if (!esFoto && documento.size > MAXIMO_BYTES_DOCUMENTO_IA) {
          throw new Error("El PDF pesa más de 10 MB. Baja la resolución o divídelo.");
        }
      }
      const fd = new FormData();
      fd.set("ambito", ambito);
      if (tiendaId) fd.set("tiendaId", tiendaId);
      fd.set("texto", texto);
      if (modo === "documento" && documento) fd.set("fichero", documento);
      return proponer({ data: fd });
    },
    onSuccess: (propuesta) => {
      // Las imágenes del presupuesto, por preferencia: las añadidas a mano,
      // el documento si es una foto y las sacadas del PDF. Como mucho, el
      // máximo; las demás se avisan. Se pueden quitar en el editor.
      const delDocumento: File[] = [];
      if (modo === "documento" && documento && esTipoImagenPresupuesto(documento.type)) {
        if (documento.size <= MAXIMO_BYTES_IMAGEN) delDocumento.push(documento);
        else
          toast.warning("El documento pesa más de 5 MB: no se guarda como imagen del presupuesto.");
      }
      const extraidas = propuesta.extraidas.map((e) =>
        ficheroDeBase64(e.base64, e.nombre, "image/jpeg"),
      );
      const { elegidas, fuera } = recortarImagenes([imagenes, delDocumento, extraidas]);
      if (fuera > 0) {
        toast.warning(
          `Como mucho, ${MAXIMO_IMAGENES_PRESUPUESTO} imágenes por presupuesto: ${fuera} ${
            fuera === 1
              ? "imagen sacada del documento se queda"
              : "imágenes sacadas del documento se quedan"
          } fuera.`,
        );
      }
      onBorrador({ propuesta, imagenes: elegidas });
    },
    onError: (e: Error) => avisarError(e, "La IA no ha podido montar el presupuesto"),
  });

  const elegirImagenes = (lista: FileList) => {
    const buenas: File[] = [];
    for (const f of Array.from(lista)) {
      if (!esTipoImagenPresupuesto(f.type))
        toast.error(`«${f.name}» no es un JPG, un PNG ni un WEBP.`);
      else if (f.size > MAXIMO_BYTES_IMAGEN) toast.error(`«${f.name}» pesa más de 5 MB.`);
      else buenas.push(f);
    }
    const { elegidas, fuera } = recortarImagenes([imagenes, buenas]);
    if (fuera > 0) {
      toast.error(`Como mucho, ${MAXIMO_IMAGENES_PRESUPUESTO} imágenes por presupuesto.`);
    }
    setImagenes(elegidas);
  };

  return (
    <Dialog open={!!modo} onOpenChange={(o) => !o && !montar.isPending && onCerrar()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {modo === "documento" ? "Presupuesto desde un documento" : "Presupuesto escrito"}
          </DialogTitle>
          <DialogDescription>
            La IA monta un borrador con el catálogo
            {ambito === "textil" ? " y el stock" : " de la tienda"}. Se abre en el editor de siempre
            para revisarlo: no se guarda nada hasta que pulses Guardar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {modo === "documento" && (
            <div className="space-y-1">
              <Label>Documento (PDF de hasta 10 MB, o JPG, PNG o WEBP de hasta 5 MB)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => entradaDocumento.current?.click()}
                >
                  <FileUp className="h-4 w-4 mr-2" /> {documento ? "Cambiar" : "Elegir"} documento
                </Button>
                <span className="text-sm text-muted-foreground truncate max-w-full">
                  {documento?.name ?? "Ninguno elegido"}
                </span>
              </div>
              <input
                ref={entradaDocumento}
                type="file"
                accept={ACEPTA_DOCUMENTO}
                className="hidden"
                onChange={(e) => {
                  setDocumento(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">
                Si es una foto, se guarda también como imagen del presupuesto. De un PDF se lee el
                contenido y se proponen las fotos que lleve dentro.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label>
              {modo === "documento" ? "Indicaciones para la IA (opcional)" : "El presupuesto"}
            </Label>
            <Textarea
              rows={modo === "documento" ? 3 : 8}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={
                modo === "documento"
                  ? "Por ejemplo: «es para Pepe SL; sin IVA»"
                  : ambito === "textil"
                    ? "50 camisetas Gildan negras talla M con logo en pecho, 10 € cada una, para Pepe SL"
                    : "20 metros de DTF a 9 € el metro, envío 6 €, para Pepe SL (compras@pepe.es)"
              }
            />
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Imágenes para el presupuesto (opcional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => entradaImagenes.current?.click()}
              >
                <ImagePlus className="h-4 w-4 mr-1" /> Añadir imágenes
              </Button>
            </div>
            <input
              ref={entradaImagenes}
              type="file"
              multiple
              accept={TIPOS_IMAGEN_PRESUPUESTO.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) elegirImagenes(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              {imagenes.length
                ? imagenes.map((i) => i.name).join(" · ")
                : "Diseños o prendas que saldrán en el PDF. Se pueden añadir o quitar luego en el editor."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={montar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => montar.mutate()} disabled={montar.isPending}>
            {montar.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> La IA está montando el
                presupuesto…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" /> Montar el borrador
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Las dudas de la IA y lo que hay que mirar, arriba del editor. */
export function AvisosIa({ avisos }: { avisos: readonly string[] }) {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4 !text-amber-600" />
      <AlertTitle>Borrador de la IA: revísalo antes de guardar</AlertTitle>
      <AlertDescription>
        {avisos.length ? (
          <ul className="list-disc pl-4 space-y-0.5 text-sm">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : (
          <span className="text-sm">
            La IA no tiene dudas, pero comprueba cliente, líneas y precios.
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
