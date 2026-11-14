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

/** Los textos de la pregunta, si no valen los de siempre. */
export type TextosCerrarSinPerder = {
  titulo?: string;
  descripcion?: string;
  /** El botón que descarta y cierra. */
  descartar?: string;
};

/**
 * Cerrar un formulario sin perder lo escrito por un toque fuera o un Escape.
 *
 * Con cambios sin guardar, cerrar (la X, Escape, el clic fuera o «Cancelar»)
 * pregunta antes «¿Descartar los cambios?». Sin cambios, se cierra como
 * siempre. Lo usan los formularios de pedido, cliente, producto, inversión y
 * el panel de tareas de la agenda; los textos se pueden cambiar (`textos`).
 *
 *   const { pedirCierre, aviso } = useCerrarSinPerder(cambiado, () => onOpenChange(false));
 *   <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : pedirCierre())}>
 *     …
 *     {aviso}
 *   </Dialog>
 */
export function useCerrarSinPerder(
  cambiado: boolean,
  cerrar: () => void,
  textos: TextosCerrarSinPerder = {},
) {
  const {
    titulo = "¿Descartar los cambios?",
    descripcion = "Hay cambios sin guardar. Si cierras, lo que has escrito se perderá.",
    descartar = "Descartar cambios",
  } = textos;
  const [preguntando, setPreguntando] = useState(false);
  const pedirCierre = () => {
    if (cambiado) setPreguntando(true);
    else cerrar();
  };
  const aviso = (
    <AlertDialog open={preguntando} onOpenChange={setPreguntando}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descripcion}</AlertDialogDescription>
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
            {descartar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { pedirCierre, aviso };
}
