import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  money,
  num,
  dateBR,
  todayISO,
  daysBetween,
  addDaysISO,
  addMonthsISO,
  startOfWeekISO,
  endOfWeekISO,
  startOfMonthISO,
  endOfMonthISO,
  startOfYearISO,
  endOfYearISO,
} from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { PeriodFilter } from "@/components/PeriodFilter";
import { periodLabel, periodRange, type PeriodType } from "@/lib/period";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard financeiro | Escritório" },
      {
        name: "description",
        content:
          "Saldos, receita realizada, valores a repassar, parcelas atrasadas e previsão de recebimentos do escritório.",
      },
      { property: "og:title", content: "Dashboard financeiro do escritório" },
      {
        property: "og:description",
        content: "Indicadores de caixa, recebíveis e repasses em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type InstallmentRow = {
  id: string;
  due_date: string | null;
  gross_amount: number;
  fee_amount: number;
  success_fee_amount: number;
  paid_total: number;
  paid_fee: number;
  paid_success_fee: number;
  paid_client: number;
  balance: number;
  status: string;
  is_estimated: boolean;
  receivable_id: string;
};

function useDashboardData() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [inst, balances, banks, txs, receivables, activeCases, receipts] =
        await Promise.all([
        supabase.from("v_installments").select("*"),
        supabase.from("v_client_balances").select("*"),
        supabase.from("v_bank_balances").select("*"),
        supabase
          .from("financial_transactions")
          .select("id, type, amount, paid_on, status, description, is_financing")
          .eq("status", "pago"),
        supabase
          .from("legal_receivables")
          .select("id, status, is_estimated, expected_firm_amount, description, client_id")
          .is("deleted_at", null),
        supabase
          .from("cases")
          .select("id", { count: "exact", head: true })
          .eq("status", "ativo")
          .is("deleted_at", null),
        // O dinheiro de terceiros precisa vir do recebimento, não da parcela:
        // a parcela só sabe quanto é da cliente, não se passou pela conta do
        // escritório ou se ela recebeu direto da empresa.
        supabase
          .from("receipts")
          .select(
            "fee_amount, success_fee_amount, client_amount_received_by_firm, client_amount_received_direct",
          )
          .is("reversed_at", null),
      ]);
      if (inst.error) throw inst.error;
      return {
        installments: (inst.data ?? []) as unknown as InstallmentRow[],
        balances: balances.data ?? [],
        banks: banks.data ?? [],
        txs: txs.data ?? [],
        receivables: receivables.data ?? [],
        activeCasesCount: activeCases.count ?? 0,
        receipts: receipts.data ?? [],
      };
    },
  });
}

/**
 * Números do período escolhido (dia/semana/mês/ano). Busca separada da consulta
 * principal para não recarregar o dashboard inteiro a cada troca de filtro.
 */
function usePeriodData(start: string, end: string) {
  return useQuery({
    queryKey: ["dashboard-period", start, end],
    queryFn: async () => {
      const [receipts, txs] = await Promise.all([
        // O cliente vem junto (recebimento → parcela → acordo) para dar a
        // contagem de clientes que efetivamente pagaram algo no período.
        supabase
          .from("receipts")
          .select(
            "fee_amount, success_fee_amount, cost_reimbursement, client_amount_received_by_firm, received_on, installments!inner(legal_receivables!inner(client_id))",
          )
          .is("reversed_at", null)
          .gte("received_on", start)
          .lte("received_on", end),
        supabase
          .from("financial_transactions")
          .select("type, amount, paid_on, is_financing")
          .eq("status", "pago")
          .gte("paid_on", start)
          .lte("paid_on", end),
      ]);
      if (receipts.error) throw receipts.error;
      if (txs.error) throw txs.error;
      return { receipts: receipts.data ?? [], txs: txs.data ?? [] };
    },
  });
}

/**
 * Recebimentos de um intervalo, para o gráfico "escritório x terceiros".
 * Ele tem filtro próprio porque a pergunta que responde é outra: não é o
 * resultado do mês, é quanto do dinheiro que passou pelas mãos do escritório
 * era dele e quanto era das clientes, no recorte que se quiser olhar.
 */
function useMixData(start: string, end: string) {
  return useQuery({
    queryKey: ["dashboard-mix", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receipts")
        .select(
          "fee_amount, success_fee_amount, client_amount_received_by_firm, client_amount_received_direct",
        )
        .is("reversed_at", null)
        .gte("received_on", start)
        .lte("received_on", end);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Extrai o id do cliente da estrutura aninhada que o PostgREST devolve. */
function clientIdOf(row: unknown): string | null {
  const inst = (row as { installments?: unknown }).installments;
  const one = Array.isArray(inst) ? inst[0] : inst;
  const recv = (one as { legal_receivables?: unknown } | undefined)?.legal_receivables;
  const rec = Array.isArray(recv) ? recv[0] : recv;
  return (rec as { client_id?: string } | undefined)?.client_id ?? null;
}

type DashboardLink = "/caixa" | "/repasses" | "/parcelas" | "/acordos";

function Card({
  label,
  value,
  hint,
  tone = "default",
  to,
  search,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "success";
  to?: DashboardLink;
  search?: { filtro?: string };
}) {
  const body = (
    <div className="panel h-full p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={`num mt-2 font-display text-2xl font-semibold ${
          tone === "danger" ? "text-destructive" : tone === "success" ? "text-success" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return to ? (
    <Link
      to={to}
      {...(search ? { search } : {})}
      className="block transition-opacity hover:opacity-80"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function Dashboard() {
  const { data, isLoading, error } = useDashboardData();
  const today = todayISO();

  const [periodType, setPeriodType] = useState<PeriodType>("mes");
  const [anchor, setAnchor] = useState(today);
  const [customStart, setCustomStart] = useState(startOfMonthISO(today));
  const [customEnd, setCustomEnd] = useState(today);
  const custom = { start: customStart, end: customEnd };
  const { start: periodStart, end: periodEnd } = periodRange(periodType, anchor, custom);
  const { data: periodData, isLoading: periodLoading } = usePeriodData(periodStart, periodEnd);

  // Filtro exclusivo do gráfico "escritório x terceiros".
  const [mixType, setMixType] = useState<PeriodType>("ano");
  const [mixAnchor, setMixAnchor] = useState(today);
  const [mixStart, setMixStart] = useState(startOfYearISO(today));
  const [mixEnd, setMixEnd] = useState(today);
  const mixCustom = { start: mixStart, end: mixEnd };
  const mixRange = periodRange(mixType, mixAnchor, mixCustom);
  const { data: mixData, isLoading: mixLoading } = useMixData(mixRange.start, mixRange.end);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando indicadores…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os indicadores: {friendlyError(error)}
      </p>
    );
  }
  const d = data!;

  // Lucro do período conta só a parte do escritório (honorários + sucumbência)
  // recebida no intervalo, menos as despesas pagas no mesmo intervalo. O valor
  // que pertence à cliente fica de fora: entra no caixa como dinheiro de
  // terceiros, mas não é receita nem lucro do escritório.
  const periodFirmRevenue = (periodData?.receipts ?? []).reduce(
    (s, r) => s + num(r.fee_amount) + num(r.success_fee_amount),
    0,
  );
  // Só o que passou pela conta do escritório vira obrigação de repasse. O que
  // a cliente recebeu direto nunca entra no caixa nem gera repasse.
  const periodClientReceived = (periodData?.receipts ?? []).reduce(
    (s, r) => s + num(r.client_amount_received_by_firm),
    0,
  );
  // Parcela de empréstimo não é custo de operação: é devolução de dinheiro
  // que já entrou. Deixá-la aqui derrubaria o lucro e o custo por cliente de
  // todo mês por algo que não tem a ver com atender cliente.
  const periodExpenses = (periodData?.txs ?? [])
    .filter((t) => t.type === "saida" && !t.is_financing)
    .reduce((s, t) => s + num(t.amount), 0);
  const periodFinancingOut = (periodData?.txs ?? [])
    .filter((t) => t.type === "saida" && t.is_financing)
    .reduce((s, t) => s + num(t.amount), 0);
  const periodFinancingIn = (periodData?.txs ?? [])
    .filter((t) => t.type === "entrada" && t.is_financing)
    .reduce((s, t) => s + num(t.amount), 0);
  // Tudo que entrou de fato na conta como dinheiro do escritório: honorários e
  // sucumbência somados a empréstimos, aportes de sócio e qualquer outra
  // entrada lançada no caixa.
  //
  // O desconto do dinheiro das clientes no fim é o que conserta o indicador.
  // Num recebimento misto — parte honorário, parte da cliente — o caixa
  // registra o valor cheio que caiu na conta, com o tipo "entrada". Somar
  // essas entradas sem descontar fazia a parte da cliente ser contada como
  // dinheiro do escritório, e ainda aparecer no rodapé como se fosse
  // empréstimo ou aporte.
  const periodEntradas = (periodData?.txs ?? [])
    .filter((t) => t.type === "entrada")
    .reduce((s, t) => s + num(t.amount), 0);
  // Só desconta o dinheiro da cliente que veio grudado numa entrada do
  // escritório. Recebimento que é puro dinheiro de terceiro já entra no caixa
  // com o tipo "entrada_de_terceiros" e nunca foi somado acima — descontar
  // esse também tiraria duas vezes.
  const periodClientDentroDeEntrada = (periodData?.receipts ?? [])
    .filter(
      (r) =>
        num(r.fee_amount) + num(r.success_fee_amount) + num(r.cost_reimbursement) > 0.01,
    )
    .reduce((s, r) => s + num(r.client_amount_received_by_firm), 0);
  const periodCashIn = Math.max(periodEntradas - periodClientDentroDeEntrada, 0);
  // Só para saber se a frase sobre empréstimo deve aparecer — o valor em si
  // não vai para a tela.
  const periodTemEmprestimo = periodFinancingIn > 0.01;
  const periodProfit = periodFirmRevenue - periodExpenses;
  const activeCases = d.activeCasesCount;
  const profitPerCase = activeCases > 0 ? periodProfit / activeCases : 0;

  // Quantos clientes distintos efetivamente pagaram alguma coisa no período —
  // é a base tanto do custo por cliente quanto da receita média por cliente.
  // Conta o cliente uma vez só, mesmo que ele tenha pago cinco parcelas.
  const payingClients = new Set<string>();
  for (const r of periodData?.receipts ?? []) {
    const id = clientIdOf(r);
    if (id) payingClients.add(id);
  }
  const payingCount = payingClients.size;
  // Custo de captação: quanto o escritório gastou para cada cliente que pagou.
  const costPerClient = payingCount > 0 ? periodExpenses / payingCount : 0;
  // Ticket médio: quanto o escritório faturou, em média, por cliente pagante.
  const revenuePerClient = payingCount > 0 ? periodFirmRevenue / payingCount : 0;
  // O que sobra por cliente: receita menos despesa, rateada pelos pagantes.
  const profitPerClient = revenuePerClient - costPerClient;

  const totalBank = d.banks.reduce((s, b) => s + num(b.balance as number), 0);
  const firmRevenue = d.installments.reduce(
    (s, i) => s + num(i.paid_fee) + num(i.paid_success_fee),
    0,
  );
  // Terceiros que passaram pelo caixa é só o que caiu na conta do escritório.
  // A parcela guarda o valor da cliente inteiro, inclusive o que ela recebeu
  // direto da empresa e nunca chegou perto do nosso banco — por isso o número
  // vem do recebimento, não da parcela.
  const thirdPartyReceived = d.receipts.reduce(
    (s, r) => s + num(r.client_amount_received_by_firm as number),
    0,
  );
  const thirdPartyDirect = d.receipts.reduce(
    (s, r) => s + num(r.client_amount_received_direct as number),
    0,
  );
  // Parcela de empréstimo sai daqui pelo mesmo motivo que sai do lucro do
  // período: é devolução de dinheiro emprestado, não custo de operação.
  // Somá-la aqui deixava esta despesa maior que a do card de cima.
  const expenses = d.txs
    .filter((t) => t.type === "saida" && !t.is_financing)
    .reduce((s, t) => s + num(t.amount as number), 0);
  const transferred = d.balances.reduce((s, b) => s + num(b.transferred as number), 0);
  const pendingTransfer = d.balances.reduce((s, b) => s + num(b.pending_transfer as number), 0);

  const openFirmExpected = d.installments
    .filter((i) => i.status !== "PAGA" && i.status !== "CANCELADA")
    .reduce(
      (s, i) =>
        s +
        num(i.fee_amount) +
        num(i.success_fee_amount) -
        num(i.paid_fee) -
        num(i.paid_success_fee),
      0,
    );
  const estimated = d.receivables
    .filter((r) => r.is_estimated)
    .reduce((s, r) => s + num(r.expected_firm_amount as number), 0);

  // Números do gráfico "escritório x terceiros", no recorte só dele.
  const mixFirm = (mixData ?? []).reduce(
    (s, r) => s + num(r.fee_amount as number) + num(r.success_fee_amount as number),
    0,
  );
  const mixThird = (mixData ?? []).reduce(
    (s, r) => s + num(r.client_amount_received_by_firm as number),
    0,
  );

  const late = d.installments.filter((i) => i.status === "ATRASADA");
  const next7 = d.installments.filter(
    (i) =>
      i.due_date &&
      ["A_VENCER", "VENCE_HOJE", "PARCIAL"].includes(i.status) &&
      daysBetween(today, i.due_date) >= 0 &&
      daysBetween(today, i.due_date) <= 7,
  );
  const next30 = d.installments.filter(
    (i) =>
      i.due_date &&
      ["A_VENCER", "VENCE_HOJE", "PARCIAL"].includes(i.status) &&
      daysBetween(today, i.due_date) >= 0 &&
      daysBetween(today, i.due_date) <= 30,
  );

  const sumBalance = (rows: InstallmentRow[]) => rows.reduce((s, i) => s + num(i.balance), 0);

  // Envelhecimento dos atrasos
  const aging = [
    { faixa: "1–7 dias", valor: 0 },
    { faixa: "8–30 dias", valor: 0 },
    { faixa: "31–60 dias", valor: 0 },
    { faixa: "60+ dias", valor: 0 },
  ];
  for (const i of late) {
    const dd = daysBetween(i.due_date!, today);
    const idx = dd <= 7 ? 0 : dd <= 30 ? 1 : dd <= 60 ? 2 : 3;
    aging[idx]!.valor += num(i.balance);
  }

  // Previsão por mês (próximos 6 meses) — só a parte do escritório.
  // O saldo cheio da parcela inclui o dinheiro da cliente, que entra e sai
  // para o repasse: prever com ele dava um gráfico de recebimento maior do
  // que qualquer coisa que o escritório vai realmente ficar.
  const firmBalanceOf = (i: InstallmentRow) =>
    Math.max(
      num(i.fee_amount) + num(i.success_fee_amount) - num(i.paid_fee) - num(i.paid_success_fee),
      0,
    );
  const forecastMap = new Map<string, number>();
  for (const i of d.installments) {
    if (!i.due_date || ["PAGA", "CANCELADA"].includes(i.status)) continue;
    if (daysBetween(today, i.due_date) < 0) continue;
    const firmDue = firmBalanceOf(i);
    if (firmDue <= 0.01) continue;
    const key = i.due_date.slice(0, 7);
    forecastMap.set(key, (forecastMap.get(key) ?? 0) + firmDue);
  }
  const forecast = [...forecastMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 6)
    .map(([mes, valor]) => ({ mes: mes.split("-").reverse().join("/"), valor }));

  // Distribuição por situação
  const byStatus = new Map<string, number>();
  for (const i of d.installments) {
    byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + num(i.gross_amount));
  }
  const statusData = [...byStatus.entries()].map(([name, value]) => ({ name, value }));
  const COLORS = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
  ];

  const alerts: { text: string; to: DashboardLink; search?: { filtro?: string } }[] = [];
  if (late.length)
    alerts.push({
      text: `${late.length} parcela(s) atrasada(s), somando ${money(sumBalance(late))}`,
      to: "/parcelas",
      search: { filtro: "ATRASADA" },
    });
  if (pendingTransfer > 0.01)
    alerts.push({
      text: `${money(pendingTransfer)} de clientes recebidos e ainda não repassados`,
      to: "/repasses",
    });
  const noSchedule = d.receivables.filter(
    (r) =>
      r.status === "confirmado" &&
      !d.installments.some((i) => i.receivable_id === (r.id as string)),
  );
  if (noSchedule.length)
    alerts.push({
      text: `${noSchedule.length} recebível(is) confirmado(s) sem cronograma de parcelas`,
      to: "/acordos",
    });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão consolidada do caixa, dos recebíveis e dos valores de clientes."
      />

      <div className="panel mb-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold">Resultado do período</h2>
            <p className="text-xs text-muted-foreground">
              Só a parte do escritório — o valor que pertence à cliente fica de fora.
            </p>
          </div>
          <PeriodFilter
            type={periodType}
            onTypeChange={setPeriodType}
            anchor={anchor}
            onAnchorChange={setAnchor}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </div>

        <p className="num mt-3 text-sm text-muted-foreground">
          {periodLabel(periodType, anchor, custom)}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Receita do escritório</p>
            <p className="num mt-1 text-xl font-semibold text-success">
              {periodLoading ? "…" : money(periodFirmRevenue)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Honorários + sucumbência</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Total que entrou no caixa</p>
            <p className="num mt-1 text-xl font-semibold text-success">
              {periodLoading ? "…" : money(periodCashIn)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {periodTemEmprestimo
                ? "Tem dinheiro de empréstimo somado aqui. Sem o dinheiro das clientes."
                : "Empréstimos e aportes entram aqui. Sem o dinheiro das clientes."}
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Despesas pagas</p>
            <p className="num mt-1 text-xl font-semibold text-destructive">
              {periodLoading ? "…" : money(periodExpenses)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sem as parcelas de empréstimo
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Lucro do período</p>
            <p
              className={`num mt-1 text-xl font-semibold ${
                periodProfit >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {periodLoading ? "…" : money(periodProfit)}
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Lucro por processo ativo</p>
            <p className="num mt-1 text-xl font-semibold">
              {periodLoading ? "…" : money(profitPerCase)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{activeCases} processo(s) ativo(s)</p>
          </div>
        </div>

        {/* Indicadores por cliente pagante: a base dos dois é a mesma — quantos
            clientes distintos colocaram dinheiro no escritório no período. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Clientes que pagaram</p>
            <p className="num mt-1 text-xl font-semibold">{periodLoading ? "…" : payingCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Clientes distintos com recebimento no período
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Custo por cliente</p>
            <p className="num mt-1 text-xl font-semibold text-destructive">
              {periodLoading ? "…" : payingCount > 0 ? money(costPerClient) : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Despesas do período ÷ clientes que pagaram
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Receita média por cliente</p>
            <p className="num mt-1 text-xl font-semibold text-success">
              {periodLoading ? "…" : payingCount > 0 ? money(revenuePerClient) : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Receita do escritório ÷ clientes que pagaram
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Lucro por cliente</p>
            <p
              className={`num mt-1 text-xl font-semibold ${
                profitPerClient >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {periodLoading ? "…" : payingCount > 0 ? money(profitPerClient) : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Receita por cliente − custo por cliente
            </p>
          </div>
        </div>

        {(periodFinancingIn > 0.01 || periodFinancingOut > 0.01) && (
          <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Empréstimos no período: entrou{" "}
            <strong className="num text-foreground">{money(periodFinancingIn)}</strong> e saiu{" "}
            <strong className="num text-foreground">{money(periodFinancingOut)}</strong>. Isso mexe
            no saldo das contas, mas fica de fora do lucro e do custo por cliente — empréstimo não
            é receita nem custo de operação, é dinheiro emprestado indo e voltando.
          </div>
        )}

        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Neste período,{" "}
          <strong className="num text-foreground">{money(periodClientReceived)}</strong> pertencem
          às clientes e não entram nas contas acima — é dinheiro de terceiros que ainda vai (ou já
          foi) para{" "}
          <Link to="/repasses" className="underline underline-offset-2">
            Repasses a Clientes
          </Link>
          .
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Saldo em contas" value={money(totalBank)} to="/caixa" />
        <Card
          label="Receita realizada do escritório"
          value={money(firmRevenue)}
          hint="Honorários + sucumbência recebidos"
          tone="success"
        />
        <Card
          label="Despesas pagas"
          value={money(expenses)}
          hint="Sem as parcelas de empréstimo"
          to="/caixa"
        />
        <Card
          label="Resultado de caixa"
          value={money(firmRevenue - expenses)}
          tone={firmRevenue - expenses >= 0 ? "success" : "danger"}
        />
        <Card
          label="Aguardando repasse"
          value={money(pendingTransfer)}
          hint="Dinheiro de clientes — não é receita"
          to="/repasses"
        />
        <Card label="Já repassado" value={money(transferred)} to="/repasses" />
        <Card
          label="Recebíveis confirmados"
          value={money(openFirmExpected)}
          hint="Parte do escritório em aberto"
          to="/parcelas"
        />
        <Card
          label="Recebíveis estimados"
          value={money(estimated)}
          hint="A confirmar — fora do caixa"
          to="/acordos"
        />
        <Card
          label="Parcelas atrasadas"
          value={`${late.length} · ${money(sumBalance(late))}`}
          tone={late.length ? "danger" : "default"}
          to="/parcelas"
          search={{ filtro: "ATRASADA" }}
        />
        <Card
          label="Vencem em 7 dias"
          value={money(sumBalance(next7))}
          to="/parcelas"
          search={{ filtro: "VENCE_7" }}
        />
        <Card
          label="Vencem em 30 dias"
          value={money(sumBalance(next30))}
          to="/parcelas"
          search={{ filtro: "VENCE_30" }}
        />
        <Card
          label="Terceiros recebidos"
          value={money(thirdPartyReceived)}
          hint={
            thirdPartyDirect > 0.01
              ? `Passaram pelo caixa — outros ${money(thirdPartyDirect)} foram direto às clientes`
              : "Valores de clientes que passaram pelo caixa"
          }
        />
      </div>

      {alerts.length > 0 && (
        <div className="panel mt-6 p-4">
          <h2 className="font-display text-sm font-semibold">Alertas</h2>
          <ul className="mt-3 space-y-2">
            {alerts.map((a) => (
              <li key={a.text}>
                <Link
                  to={a.to}
                  {...(a.search ? { search: a.search } : {})}
                  className="text-sm text-foreground underline-offset-4 hover:underline"
                >
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Previsão de recebimentos</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Só a parte do escritório — honorários e sucumbência ainda em aberto.
          </p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={forecast}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => money(v as number)} width={90} />
                <Tooltip formatter={(v) => money(v as number)} />
                <Bar dataKey="valor" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Envelhecimento dos atrasos</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aging}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="faixa" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => money(v as number)} width={90} />
                <Tooltip formatter={(v) => money(v as number)} />
                <Bar dataKey="valor" fill="var(--color-chart-5)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold">
                Receita do escritório x valores de terceiros
              </h2>
              <p className="num mt-1 text-xs text-muted-foreground">
                {periodLabel(mixType, mixAnchor, mixCustom)}
              </p>
            </div>
            <PeriodFilter
              type={mixType}
              onTypeChange={setMixType}
              anchor={mixAnchor}
              onAnchorChange={setMixAnchor}
              customStart={mixStart}
              customEnd={mixEnd}
              onCustomStartChange={setMixStart}
              onCustomEndChange={setMixEnd}
            />
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { nome: "Escritório", valor: mixFirm },
                  { nome: "Terceiros (clientes)", valor: mixThird },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="nome" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => money(v as number)} width={90} />
                <Tooltip formatter={(v) => money(v as number)} />
                <Bar dataKey="valor" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {mixLoading
              ? "Carregando…"
              : "Terceiros conta só o que passou pela conta do escritório e ainda vai para repasse."}
          </p>
        </div>

        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Parcelas por situação</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90}>
                  {statusData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip formatter={(v) => money(v as number)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel mt-6 overflow-x-auto p-4">
        <h2 className="font-display text-sm font-semibold">Próximos vencimentos</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="py-2">Vencimento</th>
              <th>Situação</th>
              <th className="text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {next30
              .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
              .slice(0, 8)
              .map((i) => (
                <tr key={i.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2">{dateBR(i.due_date)}</td>
                  <td>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="num text-right">{money(i.balance)}</td>
                </tr>
              ))}
            {next30.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-muted-foreground">
                  Nenhum vencimento nos próximos 30 dias.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
