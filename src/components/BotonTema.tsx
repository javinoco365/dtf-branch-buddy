import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aplicarTema, guardarTema, leerTema, type Tema } from "@/lib/tema";

const OPCIONES: { valor: Tema; etiqueta: string; Icono: typeof Sun }[] = [
  { valor: "claro", etiqueta: "Claro", Icono: Sun },
  { valor: "oscuro", etiqueta: "Oscuro", Icono: Moon },
  { valor: "sistema", etiqueta: "El del sistema", Icono: Monitor },
];

/**
 * El selector de tema de la cabecera.
 *
 * Arranca siempre en «sistema» y lee lo guardado en el primer efecto, no en el
 * estado inicial: en el servidor no hay `localStorage`, y si el primer render
 * del cliente no coincidiera con el del servidor, React descartaría el árbol
 * entero. La clase ya está puesta por el guion de `__root.tsx` antes de que
 * esto se monte, así que no hay parpadeo.
 */
export function BotonTema() {
  const [tema, setTema] = useState<Tema>("sistema");

  useEffect(() => setTema(leerTema()), []);

  // Con «sistema» hay que seguir escuchando: el ordenador puede cambiar de
  // tema con la aplicación abierta, de noche o al cambiar de perfil.
  useEffect(() => {
    if (tema !== "sistema" || typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const alCambiar = () => aplicarTema("sistema");
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, [tema]);

  const actual = OPCIONES.find((o) => o.valor === tema) ?? OPCIONES[2];
  const Icono = actual.Icono;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Tema: ${actual.etiqueta}`}>
          <Icono className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPCIONES.map(({ valor, etiqueta, Icono: I }) => (
          <DropdownMenuItem
            key={valor}
            onClick={() => {
              setTema(valor);
              guardarTema(valor);
            }}
            className={valor === tema ? "font-semibold" : undefined}
          >
            <I className="h-4 w-4 mr-2" />
            {etiqueta}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
