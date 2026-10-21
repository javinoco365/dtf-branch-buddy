import { Component, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Si la tabla de pedidos falla al pintarse, lo dice con el error y un botón
 * para reintentar, en vez de dejar la pantalla en blanco.
 */
export class PedidosErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[PedidosTable] render error", error);
  }
  render() {
    if (this.state.error) {
      return (
        <Card>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm font-medium">No se pudo cargar la tabla de pedidos.</p>
            <p className="text-xs text-muted-foreground">{this.state.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
