import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Só ajusta o tipo (não filtra em tempo de execução): `exactOptionalPropertyTypes`
 * rejeita passar `undefined` explicitamente para uma propriedade opcional, mas
 * `JSON.stringify` — usado pelo Supabase ao enviar o payload de um RPC — já
 * remove essas chaves normalmente. Use para satisfazer o TypeScript em objetos
 * de argumentos com vários campos opcionais construídos com `valor || undefined`.
 */
export function dropUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return obj as never;
}
