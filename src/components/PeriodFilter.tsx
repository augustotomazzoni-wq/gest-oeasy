import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_OPTIONS, shiftAnchor, type PeriodType } from "@/lib/period";

/**
 * Seletor de período Dia / Semana / Mês / Ano / Personalizado.
 * Usado igual no Dashboard e no Fluxo de Caixa para que os dois nunca
 * mostrem recortes de tempo diferentes.
 */
export function PeriodFilter({
  type,
  onTypeChange,
  anchor,
  onAnchorChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: {
  type: PeriodType;
  onTypeChange: (type: PeriodType) => void;
  anchor: string;
  onAnchorChange: (anchor: string) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIOD_OPTIONS.map(([key, label]) => (
        <Button
          key={key}
          size="sm"
          variant={type === key ? "default" : "outline"}
          onClick={() => onTypeChange(key)}
        >
          {label}
        </Button>
      ))}

      {type === "personalizado" ? (
        <div className="flex flex-wrap items-center gap-1">
          <Input
            type="date"
            className="w-40"
            aria-label="Data inicial"
            value={customStart}
            onChange={(e) => onCustomStartChange(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">até</span>
          <Input
            type="date"
            className="w-40"
            aria-label="Data final"
            value={customEnd}
            onChange={(e) => onCustomEndChange(e.target.value)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            aria-label="Período anterior"
            onClick={() => onAnchorChange(shiftAnchor(type, anchor, -1))}
          >
            ‹
          </Button>
          {/* O campo acompanha o recorte escolhido. Com "Mês" selecionado, um
              seletor de dia fazia parecer que as setas andavam um dia de cada
              vez — elas sempre andaram um mês, mas a tela dizia outra coisa.
              Ancorar no dia 1º também evita a deriva de quem começa em 31/03,
              volta para 28/02 e não consegue mais voltar ao dia 31. */}
          {type === "mes" ? (
            <Input
              type="month"
              className="w-40"
              aria-label="Mês de referência"
              value={anchor.slice(0, 7)}
              onChange={(e) => onAnchorChange(e.target.value ? `${e.target.value}-01` : anchor)}
            />
          ) : type === "ano" ? (
            <Input
              type="number"
              className="w-28"
              aria-label="Ano de referência"
              min="2000"
              max="2100"
              value={anchor.slice(0, 4)}
              onChange={(e) =>
                onAnchorChange(e.target.value.length === 4 ? `${e.target.value}-01-01` : anchor)
              }
            />
          ) : (
            <Input
              type="date"
              className="w-40"
              aria-label="Data de referência do período"
              value={anchor}
              onChange={(e) => onAnchorChange(e.target.value || anchor)}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            aria-label="Próximo período"
            onClick={() => onAnchorChange(shiftAnchor(type, anchor, 1))}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}
