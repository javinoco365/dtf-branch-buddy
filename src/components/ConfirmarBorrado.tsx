import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  /** Qué se borra, en una línea: «el cliente Pepe Pérez». */
  que: string;
  /** Lo que se lleva por delante. Una línea por cosa. */
  consecuencias?: string[];
  /**
   * Si viene, hay que escribir ese texto para poder confirmar. Reservado a lo
   * que arrastra datos de verdad: una tienda entera, no un presupuesto.
   */
  escribirParaConfirmar?: string;
  /** Si viene, no se puede borrar y se explica por qué. */
  impedimento?: string | null;
  abierto: boolean;
  onCerrar: () => void;
  onConfirmar: () => void;
  cargando?: boolean;
};

/**
 * El aviso antes de borrar.
 *
 * `confirm()` del navegador no deja decir QUÉ se lleva por delante, y un
 * «¿seguro?» a secas se contesta que sí sin leerlo. Esto enseña los números
 * y, cuando la cosa es gorda, obliga a escribir el nombre: te da el segundo
 * que hace falta para darte cuenta de que te has equivocado de fila.
 */
export function ConfirmarBorrado({
  que,
  consecuencias = [],
  escribirParaConfirmar,
  impedimento,
  abierto,
  onCerrar,
  onConfirmar,
  cargando = false,
}: Props) {
  const [escrito, setEscrito] = useState("");

  useEffect(() => {
    if (abierto) setEscrito("");
  }, [abierto]);

  const bloqueado =
    !!impedimento ||
    cargando ||
    (!!escribirParaConfirmar && escrito.trim() !== escribirParaConfirmar.trim());

  return (
    <AlertDialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {impedimento ? `No se puede borrar ${que}` : `¿Borrar ${que}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {impedimento ? <p>{impedimento}</p> : <p>Esto no se puede deshacer.</p>}
              {consecuencias.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5">
                  {consecuencias.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!impedimento && escribirParaConfirmar && (
          <div className="space-y-2">
            <Label htmlFor="confirmar-borrado">
              Escribe <span className="font-mono font-semibold">{escribirParaConfirmar}</span> para
              confirmar
            </Label>
            <Input
              id="confirmar-borrado"
              value={escrito}
              autoComplete="off"
              onChange={(e) => setEscrito(e.target.value)}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{impedimento ? "Cerrar" : "Cancelar"}</AlertDialogCancel>
          {!impedimento && (
            <AlertDialogAction
              disabled={bloqueado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (!bloqueado) onConfirmar();
              }}
            >
              {cargando ? "Borrando…" : "Borrar"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
