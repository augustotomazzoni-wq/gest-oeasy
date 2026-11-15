import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type OpcaoCliente = { id: string; nome: string; quantos: number };

/**
 * Escolher uma cliente numa lista com busca. Com duzentas clientes, uma
 * lista suspensa comum obriga a rolar até achar; aqui se digita parte do
 * nome. O número ao lado é quantos registros dela há na tela.
 */
export function FiltroCliente({
  opcoes,
  valor,
  onChange,
  rotuloVazio = "Todas as clientes",
}: {
  opcoes: OpcaoCliente[];
  valor: string;
  onChange: (id: string) => void;
  rotuloVazio?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const escolhida = opcoes.find((o) => o.id === valor);

  return (
    <div className="flex items-center gap-1">
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={aberto}
            className="w-64 justify-between font-normal"
          >
            <span className="truncate">{escolhida ? escolhida.nome : rotuloVazio}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Digite parte do nome…" />
            <CommandList>
              <CommandEmpty>Nenhuma cliente com esse nome.</CommandEmpty>
              <CommandGroup>
                {opcoes.map((o) => (
                  <CommandItem
                    key={o.id}
                    // O valor de busca inclui o id para duas homônimas não
                    // virarem uma só dentro da lista.
                    value={`${o.nome} ${o.id}`}
                    onSelect={() => {
                      onChange(o.id === valor ? "" : o.id);
                      setAberto(false);
                    }}
                  >
                    <Check className={cn("size-4", o.id === valor ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{o.nome}</span>
                    <span className="text-xs text-muted-foreground">{o.quantos}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {valor && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          aria-label="Mostrar todas as clientes"
          onClick={() => onChange("")}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
