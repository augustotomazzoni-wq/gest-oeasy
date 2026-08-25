import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { money, num, dateBR, todayISO, daysBetween } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

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
      const [inst, balances, banks, txs, receivables] = await Promise.all([
        supabase.from("v_installments").select("*"),
        supabase.from("v_client_balances").select("*"),
        supabase.from("v_bank_balances").select("*"),
        supabase
          .from("financial_transactions")
          .select("id, type, amount, paid_on, status, description")
          .eq("status", "pago"),
        supabase
          .from("legal_receivables")
          .select("id, status, is_estimated, expected_firm_amount, description, client_id")
          .is("deleted_at", null),
      ]);
      if (inst.error) throw inst.error;
      return {
        installments: (inst.data ?? []) as unknown as InstallmentRow[],
        balances: balances.data ?? [],
        banks: banks.data ?? [],
        txs: txs.data ?? [],
        receivables: receivables.data ?? [],
      };
    },
  });
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

  const totalBank = d.banks.reduce((s, b) => s + num(b.balance as number), 0);
  const firmRevenue = d.installments.reduce(
    (s, i) => s + num(i.paid_fee) + num(i.paid_success_fee),
    0,
  );
  const thirdPartyReceived = d.installments.reduce((s, i) => s + num(i.paid_client), 0);
  const expenses = d.txs
    .filter((t) => t.type === "saida")
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

  // Previsão por mês (próximos 6 meses)
  const forecastMap = new Map<string, number>();
  for (const i of d.installments) {
    if (!i.due_date || ["PAGA", "CANCELADA"].includes(i.status)) continue;
    if (daysBetween(today, i.due_date) < 0) continue;
    const key = i.due_date.slice(0, 7);
    forecastMap.set(key, (forecastMap.get(key) ?? 0) + num(i.balance));
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Saldo em contas" value={money(totalBank)} to="/caixa" />
        <Card
          label="Receita realizada do escritório"
          value={money(firmRevenue)}
          hint="Honorários + sucumbência recebidos"
          tone="success"
        />
        <Card label="Despesas pagas" value={money(expenses)} to="/caixa" />
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
          hint="Valores de clientes que passaram pelo caixa"
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
          <h2 className="font-display text-sm font-semibold">
            Receita do escritório x valores de terceiros
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { nome: "Escritório", valor: firmRevenue },
                  { nome: "Terceiros (clientes)", valor: thirdPartyReceived },
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
