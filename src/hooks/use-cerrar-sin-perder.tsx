import { useState } from "react";
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
 * Cerrar un formulario sin perder lo escrito por un toque fuera o un Escape.
 *
 * Con cambios sin guardar, cerrar (la X, Escape, el clic fuera o «Cancelar»)
 * pregunta antes «¿Descartar los cambios?». Sin cambios, se cierra como
 * siempre. Es lo que hace el panel de tareas de la agenda.
 *
 *   const { pedirCierre, aviso } = useCerrarSinPerder(cambiado, () => onOpenChange(false));
 *   <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : pedirCierre())}>
 *     …
 *     {aviso}
 *   </Dialog>
 */
export function useCerrarSinPerder(cambiado: boolean, cerrar: () => void) {
  const [preguntando, setPreguntando] = useState(false);
  const pedirCierre = () => {
    if (cambiado) setPreguntando(true);
    else cerrar();
  };
  const aviso = (
    <AlertDialog open={preguntando} onOpenChange={setPreguntando}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Descartar los cambios?</AlertDialogTitle>
          <AlertDialogDescription>
            Hay cambios sin guardar. Si cierras, lo que has escrito se perderá.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Seguir editando</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              setPreguntando(false);
              cerrar();
            }}
          >
            Descartar cambios
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { pedirCierre, aviso };
}
