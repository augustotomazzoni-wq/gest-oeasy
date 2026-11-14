import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { BLOCOS_DASHBOARD, GRUPOS, useDashboardPrefs } from "@/lib/dashboard-prefs";

/**
 * Escolha do que aparece no dashboard.
 *
 * A marcação vale só para quem está logado e só neste navegador — é
 * preferência de tela, não configuração do escritório. Por isso não exige
 * permissão nenhuma: cada um arruma a própria tela.
 */
export function DashboardPrefsPanel() {
  const { profile } = useAuth();
  const { ocultos, alternar, mostrar, mostrarTudo } = useDashboardPrefs(profile?.id);

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <div>
          <h2 className="font-display text-sm font-semibold">O que aparece no Dashboard</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Desmarque o que você não usa. Vale só para o seu acesso, neste computador.
          </p>
        </div>
        {ocultos.length > 0 && (
          <Button size="sm" variant="outline" onClick={mostrarTudo}>
            Mostrar tudo
          </Button>
        )}
      </div>

      <div className="space-y-5 p-4">
        {GRUPOS.map((grupo) => {
          const itens = BLOCOS_DASHBOARD.filter((b) => b.grupo === grupo);
          if (!itens.length) return null;
          return (
            <div key={grupo}>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {grupo}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {itens.map((b) => (
                  <div key={b.key} className="flex items-start gap-2">
                    <Checkbox
                      id={`bloco-${b.key}`}
                      checked={mostrar(b.key)}
                      onCheckedChange={() => alternar(b.key)}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={`bloco-${b.key}`}
                      className="cursor-pointer text-sm font-normal leading-tight"
                    >
                      {b.label}
                      {b.nota && (
                        <span className="block text-xs text-muted-foreground">{b.nota}</span>
                      )}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground">
          {ocultos.length === 0
            ? "Tudo visível."
            : `${ocultos.length} bloco(s) escondido(s) no seu dashboard.`}
        </p>
      </div>
    </div>
  );
}
