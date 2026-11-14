import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * El tema de los avisos emergentes sigue a la clase `dark` de <html>, que es la
 * que pone el selector de tema (src/lib/tema.ts). No se usa «system» de sonner:
 * quien elige «Oscuro» con el ordenador en claro debe verlos en oscuro.
 */
function useTemaDocumento(): "light" | "dark" {
  const [tema, setTema] = useState<"light" | "dark">("light");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const raiz = document.documentElement;
    const leer = () => setTema(raiz.classList.contains("dark") ? "dark" : "light");
    leer();
    const observador = new MutationObserver(leer);
    observador.observe(raiz, { attributes: true, attributeFilter: ["class"] });
    return () => observador.disconnect();
  }, []);
  return tema;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const tema = useTemaDocumento();
  return (
    <Sonner
      theme={tema}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
