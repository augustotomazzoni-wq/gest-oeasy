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
          <Input
            type="date"
            className="w-40"
            aria-label="Data de referência do período"
            value={anchor}
            onChange={(e) => onAnchorChange(e.target.value || anchor)}
          />
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
