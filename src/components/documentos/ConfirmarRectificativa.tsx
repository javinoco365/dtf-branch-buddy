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

/**
 * El aviso antes de anular una factura o un ticket con una rectificativa.
 *
 * Antes era un `window.confirm` que no decía lo importante: emitir una
 * rectificativa gasta un número de la serie y no tiene vuelta atrás. Aquí se
 * dice, y el diálogo no se cierra hasta que termina.
 */
export function ConfirmarRectificativa({
  que,
  abierto,
  cargando = false,
  onCerrar,
  onConfirmar,
}: {
  /** Lo que se anula: «el ticket T-2026-12», «la factura A-2026-00034». */
  que: string;
  abierto: boolean;
  cargando?: boolean;
  onCerrar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog open={abierto} onOpenChange={(o) => !o && !cargando && onCerrar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular {que} con una rectificativa?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <ul className="list-disc space-y-0.5 pl-5">
                <li>Se emite una rectificativa nueva que deja {que} a cero.</li>
                <li>
                  Gasta el siguiente número de la serie y no tiene vuelta atrás: una vez emitida no
                  se edita ni se borra.
                </li>
                <li>{que.charAt(0).toUpperCase() + que.slice(1)} no se borra ni se modifica.</li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cargando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={cargando}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              if (!cargando) onConfirmar();
            }}
          >
            {cargando ? "Emitiendo…" : "Emitir la rectificativa"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
