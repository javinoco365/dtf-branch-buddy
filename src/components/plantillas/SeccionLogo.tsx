import { useRef, useState } from "react";
import { ImageUp, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MAXIMOS, MINIMOS } from "./limites";
import { conElemento, deLaBase, useEditor } from "./editor";
import { CampoInterruptor, CampoNumero } from "./Campos";
import { useMaquetaCabecera } from "./use-maqueta-cabecera";

const TIPOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * El logo del PDF: el de la tienda (o el de la marca, en el textil) o uno
 * propio solo para los presupuestos, y la caja donde se encaja.
 *
 * Cada logo que se sube es un fichero nuevo con la hora en el nombre, igual
 * que el de la tienda: nunca se sobrescribe uno que ya pueda estar en un
 * documento.
 */
export function SeccionLogo() {
  const { plantilla, cambiar, logoPropio, fijarLogoPropio, clave, ambito, base, puedeGuardar } =
    useEditor();
  const logo = plantilla.cabecera.logo;
  const [subiendo, setSubiendo] = useState(false);
  const fichero = useRef<HTMLInputElement>(null);
  const de = deLaBase(ambito);
  const visto = logoPropio || base.logo_url;
  // Con la caja del logo dentro del papel, como al arrastrarla o estirarla.
  const { limites, anchoMax } = useMaquetaCabecera();
  const l = limites("logo");

  async function subir(archivo: File) {
    const ext = TIPOS[archivo.type];
    if (!ext) {
      toast.error("El logo tiene que ser PNG, JPG o WebP");
      return;
    }
    if (archivo.size > 2 * 1024 * 1024) {
      toast.error("El logo no puede pasar de 2 MB");
      return;
    }
    setSubiendo(true);
    try {
      const ruta = `plantillas/${clave.replace(/:/g, "-")}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("logos")
        .upload(ruta, archivo, { contentType: archivo.type });
      if (error) throw error;
      const { data } = supabase.storage.from("logos").getPublicUrl(ruta);
      fijarLogoPropio(data.publicUrl);
      toast.success("Logo subido. Pulsa «Guardar» para quedarte con él.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir el logo");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="space-y-4">
      <CampoInterruptor
        etiqueta="Poner el logo en el PDF"
        ayuda="Sin logo, la cabecera lleva el nombre comercial (si está en «Solo si no hay logo»)."
        valor={logo.mostrar}
        onChange={(mostrar) => cambiar(conElemento("logo", { mostrar }))}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex h-20 w-full shrink-0 items-center justify-center rounded-lg border bg-white p-2 sm:w-44">
          {visto ? (
            // Con `key`, cada logo empieza visible: el que falló antes no esconde al siguiente.
            <img
              key={visto}
              src={visto}
              alt={logoPropio ? "Logo propio de la plantilla" : `Logo ${de}`}
              className="max-h-full max-w-full object-contain"
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
            />
          ) : (
            <span className="text-xs text-muted-foreground">Sin logo</span>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm">
            {logoPropio ? (
              <>Ahora: un logo propio, solo para estos presupuestos.</>
            ) : base.logo_url ? (
              <>Ahora: el logo {de}.</>
            ) : (
              <>
                {ambito === "tienda"
                  ? "La tienda no tiene logo (se pone en los ajustes de la tienda)."
                  : "La marca no tiene logo."}{" "}
                Puedes subir uno solo para los presupuestos.
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fichero}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                e.target.value = "";
                if (archivo) void subir(archivo);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!puedeGuardar || subiendo}
              onClick={() => fichero.current?.click()}
            >
              <ImageUp />{" "}
              {subiendo ? "Subiendo…" : logoPropio ? "Cambiar el logo" : "Subir un logo"}
            </Button>
            {logoPropio && (
              <Button type="button" variant="ghost" size="sm" onClick={() => fijarLogoPropio(null)}>
                <Undo2 /> Usar el logo {de}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG o WebP, hasta 2 MB.
            {!puedeGuardar && " Para subir un logo hace falta poder guardar la plantilla."}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          La caja del logo (se encaja dentro sin deformarse)
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CampoNumero
            etiqueta="X"
            valor={logo.x}
            min={l.minX}
            max={l.maxX}
            onChange={(x) => cambiar(conElemento("logo", { x }))}
          />
          <CampoNumero
            etiqueta="Y"
            valor={logo.y}
            min={l.minY}
            max={l.maxY}
            onChange={(y) => cambiar(conElemento("logo", { y }))}
          />
          <CampoNumero
            etiqueta="Ancho"
            valor={logo.ancho}
            min={MINIMOS.cabecera.logo.ancho}
            max={anchoMax("logo")}
            onChange={(ancho) => cambiar(conElemento("logo", { ancho }))}
          />
          <CampoNumero
            etiqueta="Alto"
            valor={logo.alto}
            min={MINIMOS.cabecera.logo.alto}
            max={MAXIMOS.cabecera.logo.alto}
            onChange={(alto) => cambiar(conElemento("logo", { alto }))}
          />
        </div>
      </div>
    </div>
  );
}
