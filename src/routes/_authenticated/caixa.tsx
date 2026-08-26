import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { money, num, dateBR, todayISO, TX_TYPE_LABEL } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Livro-caixa do escritório com entradas, saídas, valores de terceiros e saldo por conta bancária.",
      },
      { property: "og:title", content: "Fluxo de caixa" },
      {
        property: "og:description",
        content: "Movimentações financeiras e saldos das contas do escritório.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CaixaPage,
});

const EMPTY = {
  type: "saida",
  description: "",
  amount: "",
  paid_on: todayISO(),
  bank_account_id: "",
  category_id: "",
  notes: "",
};

const THIRD_PARTY = new Set(["entrada_de_terceiros", "repasse_de_terceiros"]);

function CaixaPage() {
  const { profile, canWrite, roles } = useAuth();
  // O Lançador Financeiro também pode registrar entradas e saídas de caixa.
  const canLaunch = canWrite || roles.includes("lancador");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));

  const { data, isLoading } = useQuery({
    queryKey: ["caixa", month],
    queryFn: async () => {
      const start = `${month}-01`;
      const [y, m] = month.split("-").map(Number);
      const end = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
      const [tx, banks, cats, balances] = await Promise.all([
        supabase
          .from("financial_transactions")
          .select("*, bank_accounts(name), categories(name)")
          .gte("paid_on", start)
          .lt("paid_on", end)
          .order("paid_on", { ascending: false }),
        supabase.from("bank_accounts").select("id, name").eq("active", true).order("name"),
        supabase.from("categories").select("id, name, type").eq("active", true).order("name"),
        supabase.from("v_bank_balances").select("*"),
      ]);
      if (tx.error) throw tx.error;
      return {
        transactions: tx.data ?? [],
        banks: banks.data ?? [],
        categories: cats.data ?? [],
        balances: (balances.data ?? []) as unknown as {
          bank_account_id: string;
          name: string;
          balance: number;
        }[],
      };
    },
  });

  const totals = useMemo(() => {
    const t = { in: 0, out: 0, thirdIn: 0, thirdOut: 0 };
    for (const r of data?.transactions ?? []) {
      const v = num(r.amount);
      if (r.type === "entrada") t.in += v;
      else if (r.type === "saida") t.out += v;
      else if (r.type === "entrada_de_terceiros") t.thirdIn += v;
      else if (r.type === "repasse_de_terceiros") t.thirdOut += v;
    }
    return t;
  }, [data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.description.trim()) throw new Error("Informe a descrição");
      const amount = num(Number(form.amount));
      if (amount <= 0) throw new Error("Informe um valor válido");
      if (!form.bank_account_id) throw new Error("Selecione a conta bancária");
      const { error } = await supabase.from("financial_transactions").insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        type: form.type as never,
        status: "pago" as never,
        description: form.description.trim(),
        amount,
        paid_on: form.paid_on,
        competence_date: form.paid_on,
        bank_account_id: form.bank_account_id || null,
        category_id: form.category_id || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento registrado.");
      setForm(EMPTY);
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  return (
    <>
      <PageHeader
        title="Fluxo de Caixa"
        description="Movimentações do escritório separadas dos valores de terceiros."
        action={
          canLaunch && (
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                // Limpa ao fechar: sem isto o próximo "Novo lançamento" abre
                // com o valor e a descrição do lançamento abandonado.
                if (!v) setForm(EMPTY);
              }}
            >
              <DialogTrigger asChild>
                <Button>Novo lançamento</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo lançamento manual</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrada">Entrada</SelectItem>
                        <SelectItem value="saida">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="val">Valor</Label>
                    <Input
                      id="val"
                      type="number"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="dsc">Descrição</Label>
                    <Input
                      id="dsc"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dt">Data</Label>
                    <Input
                      id="dt"
                      type="date"
                      value={form.paid_on}
                      onChange={(e) => setForm({ ...form, paid_on: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Conta *</Label>
                    <Select
                      value={form.bank_account_id}
                      onValueChange={(v) => setForm({ ...form, bank_account_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a conta" />
                      </SelectTrigger>
                      <SelectContent>
                        {(data?.banks ?? []).map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Categoria</Label>
                    <Select
                      value={form.category_id}
                      onValueChange={(v) => setForm({ ...form, category_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {(data?.categories ?? [])
                          .filter((c) =>
                            form.type === "entrada" ? c.type === "receita" : c.type === "despesa",
                          )
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ob">Observações</Label>
                    <Textarea
                      id="ob"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={() => create.mutate()} disabled={create.isPending}>
                    {create.isPending ? "Salvando…" : "Salvar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Label htmlFor="mes" className="text-sm">
          Competência
        </Label>
        <Input
          id="mes"
          type="month"
          className="w-44"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Receitas do escritório</p>
          <p className="num mt-1 text-xl font-semibold text-success">{money(totals.in)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Despesas</p>
          <p className="num mt-1 text-xl font-semibold text-destructive">{money(totals.out)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Resultado do mês</p>
          <p className="num mt-1 text-xl font-semibold">{money(totals.in - totals.out)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Terceiros (entrada / repasse)</p>
          <p className="num mt-1 text-xl font-semibold">
            {money(totals.thirdIn)} / {money(totals.thirdOut)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="p-3">Data</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Conta</th>
                <th className="p-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!isLoading && (data?.transactions.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nenhuma movimentação no período.
                  </td>
                </tr>
              )}
              {(data?.transactions ?? []).map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">{dateBR(t.paid_on)}</td>
                  <td>
                    <span className="font-medium">{t.description}</span>
                    {(t.categories as { name: string } | null)?.name && (
                      <span className="block text-xs text-muted-foreground">
                        {(t.categories as { name: string }).name}
                      </span>
                    )}
                  </td>
                  <td>
                    <Tag
                      tone={
                        THIRD_PARTY.has(t.type)
                          ? "info"
                          : t.type === "entrada"
                            ? "success"
                            : "danger"
                      }
                    >
                      {TX_TYPE_LABEL[t.type] ?? t.type}
                    </Tag>
                  </td>
                  <td>{(t.bank_accounts as { name: string } | null)?.name ?? "—"}</td>
                  <td className="num p-3 text-right">{money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel overflow-x-auto">
          <div className="border-b border-border p-3">
            <h2 className="font-display text-sm font-semibold">Saldo por conta</h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(data?.balances ?? []).map((b) => (
                <tr key={b.bank_account_id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">{b.name}</td>
                  <td className="num p-3 text-right font-medium">{money(b.balance)}</td>
                </tr>
              ))}
              {(data?.balances.length ?? 0) === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground">
                    Cadastre uma conta bancária para acompanhar os saldos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
