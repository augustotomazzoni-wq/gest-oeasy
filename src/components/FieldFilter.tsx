import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterField<T> = {
  /** Chave estável, usada só para identificar o campo escolhido. */
  key: string;
  /** Como o campo aparece na lista para o usuário. */
  label: string;
  /** Texto pesquisável da linha para esse campo (já sem acento, se for o caso). */
  get: (row: T) => string;
};

export const ALL_FIELDS = "__todos__";

/** Remove acento para "Sao" achar "São" e vice-versa. */
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtra uma lista por um campo escolhido (ou por todos de uma vez).
 * Devolve a função de teste para usar direto no .filter().
 */
export function makeFieldMatcher<T>(
  fields: FilterField<T>[],
  fieldKey: string,
  term: string,
): (row: T) => boolean {
  const needle = normalize(term);
  if (!needle) return () => true;
  const selected =
    fieldKey === ALL_FIELDS ? fields : fields.filter((f) => f.key === fieldKey);
  return (row: T) => selected.some((f) => normalize(f.get(row)).includes(needle));
}

export function FieldFilter<T>({
  fields,
  fieldKey,
  onFieldChange,
  term,
  onTermChange,
  placeholder,
}: {
  fields: FilterField<T>[];
  fieldKey: string;
  onFieldChange: (key: string) => void;
  term: string;
  onTermChange: (term: string) => void;
  placeholder?: string;
}) {
  const current = fields.find((f) => f.key === fieldKey);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select value={fieldKey} onValueChange={onFieldChange}>
        <SelectTrigger className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL_FIELDS}>Todos os campos</SelectItem>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="max-w-sm"
        placeholder={
          current ? `Buscar em ${current.label.toLowerCase()}…` : (placeholder ?? "Buscar…")
        }
        value={term}
        onChange={(e) => onTermChange(e.target.value)}
      />
      {(term || fieldKey !== ALL_FIELDS) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onTermChange("");
            onFieldChange(ALL_FIELDS);
          }}
        >
          Limpar
        </Button>
      )}
    </div>
  );
}
