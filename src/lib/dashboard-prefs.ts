import { useCallback, useEffect, useState } from "react";

/**
 * O que cada pessoa quer ver no dashboard.
 *
 * A tela tem vinte blocos entre indicadores, gráficos e listas, e ninguém usa
 * os vinte: a cobrança olha atraso e vencimento, a sócia olha resultado e
 * lucro. Aqui cada um esconde o que não usa.
 *
 * Guarda o que está ESCONDIDO, não o que está visível. É de propósito: bloco
 * novo nasce aparecendo para todo mundo, em vez de ficar invisível para quem
 * já tinha preferência salva.
 *
 * Fica no navegador, separado por usuário — é preferência de tela, não dado
 * do escritório. Quem entrar de outro computador vê o dashboard completo e
 * ajusta de novo se quiser.
 */

export type GrupoBloco = "Indicadores" | "Gráficos" | "Blocos";

export type BlocoDashboard = {
  key: string;
  label: string;
  grupo: GrupoBloco;
  /** Explica o bloco quando o nome não basta. */
  nota?: string;
};

export const BLOCOS_DASHBOARD: BlocoDashboard[] = [
  // ---- blocos inteiros ----
  {
    key: "periodo",
    label: "Resultado do período",
    grupo: "Blocos",
    nota: "O painel de cima, com filtro de data e as métricas por cliente",
  },
  { key: "alertas", label: "Alertas", grupo: "Blocos" },
  { key: "proximos", label: "Próximos vencimentos", grupo: "Blocos" },

  // ---- indicadores ----
  { key: "saldo", label: "Saldo em contas", grupo: "Indicadores" },
  { key: "receita", label: "Receita realizada do escritório (acumulado)", grupo: "Indicadores" },
  { key: "despesas", label: "Despesas pagas (acumulado)", grupo: "Indicadores" },
  { key: "resultado", label: "Resultado da operação (acumulado)", grupo: "Indicadores" },
  { key: "aguardando", label: "Aguardando repasse", grupo: "Indicadores" },
  { key: "repassado", label: "Já repassado", grupo: "Indicadores" },
  { key: "confirmados", label: "Recebíveis confirmados", grupo: "Indicadores" },
  { key: "estimados", label: "Recebíveis estimados", grupo: "Indicadores" },
  { key: "atrasadas", label: "Parcelas atrasadas", grupo: "Indicadores" },
  { key: "vence7", label: "Vencem em 7 dias", grupo: "Indicadores" },
  { key: "vence30", label: "Vencem em 30 dias", grupo: "Indicadores" },
  { key: "terceiros", label: "Terceiros recebidos", grupo: "Indicadores" },

  // ---- gráficos ----
  { key: "g_previsao", label: "Previsão de recebimentos", grupo: "Gráficos" },
  { key: "g_atrasos", label: "Envelhecimento dos atrasos", grupo: "Gráficos" },
  {
    key: "g_mix",
    label: "Receita do escritório x valores de terceiros",
    grupo: "Gráficos",
  },
  { key: "g_honorarios", label: "Honorários do escritório por mês", grupo: "Gráficos" },
  { key: "g_situacao", label: "Parcelas por situação", grupo: "Gráficos" },
];

export const GRUPOS: GrupoBloco[] = ["Blocos", "Indicadores", "Gráficos"];

const chave = (userId: string | null | undefined) => `dashboard-ocultos:${userId ?? "anonimo"}`;

function ler(userId: string | null | undefined): string[] {
  try {
    const bruto = localStorage.getItem(chave(userId));
    const lista = bruto ? (JSON.parse(bruto) as unknown) : [];
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Navegador sem armazenamento ou dado corrompido: mostra tudo.
    return [];
  }
}

/**
 * Devolve quem está escondido e como alternar. `mostrar` é o que as telas
 * usam: `mostrar("saldo") && <Card .../>`.
 */
export function useDashboardPrefs(userId: string | null | undefined) {
  const [ocultos, setOcultos] = useState<string[]>(() => ler(userId));

  // Trocar de usuário no mesmo navegador recarrega a preferência certa.
  useEffect(() => setOcultos(ler(userId)), [userId]);

  const gravar = useCallback(
    (lista: string[]) => {
      setOcultos(lista);
      try {
        localStorage.setItem(chave(userId), JSON.stringify(lista));
      } catch {
        // Sem armazenamento: vale só nesta sessão.
      }
    },
    [userId],
  );

  const alternar = useCallback(
    (key: string) =>
      gravar(ocultos.includes(key) ? ocultos.filter((k) => k !== key) : [...ocultos, key]),
    [gravar, ocultos],
  );

  const mostrar = useCallback((key: string) => !ocultos.includes(key), [ocultos]);

  const mostrarTudo = useCallback(() => gravar([]), [gravar]);

  return { ocultos, alternar, mostrar, mostrarTudo };
}
