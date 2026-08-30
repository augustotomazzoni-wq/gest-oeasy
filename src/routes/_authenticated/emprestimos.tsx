import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { money, num, dateBR, todayISO, addMonthsISO } from "@/lib/format";
import { friendlyError, throwFirstError } from "@/lib/errors";
import { dropUndefined } from "@/lib/utils";
import { downloadXlsxSheets } from "@/lib/export-xlsx";
import { parseLoanWorkbook, loanTemplateRows } from "@/lib/loan-import";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/emprestimos")({
  head: () => ({
    meta: [
      { title: "Empréstimos | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Empréstimos e financiamentos do escritório, com o cronograma completo de parcelas gerado automaticamente.",
      },
      { property: "og:title", content: "Empréstimos do escritório" },
      {
        property: "og:description",
        content: "Controle de financiamentos separado do resultado operacional.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EmprestimosPage,
});

type LoanRow = {
  id: string;
  lender: string;
  contract_number: string | null;
  amount_received: number;
  received_on: string | null;
  notes: string | null;
};

type Parcela = { due_date: string; amount: number };

/** Uma parcela do empréstimo, do jeito que ela vive no fluxo de caixa. */
type ParcelaTx = {
  id: string;
  loan_id: string;
  type: string;
  status: string;
  amount: number;
  due_date: string | null;
  paid_on: string | null;
  recurrence_index: number | null;
  recurrence_total: number | null;
  description: string;
};

const EMPTY = {
  lender: "",
  contract_number: "",
  amount_received: "",
  received_on: todayISO(),
  bank_account_id: "",
  category_id: "",
  notes: "",
  // Modo simples: N parcelas iguais a partir de uma data.
  parcels: "12",
  first_due: addMonthsISO(todayISO(), 1),
  parcel_amount: "",
  // Modo colado: a tabela do contrato, uma parcela por linha.
  pasted: "",
};

/**
 * Lê a tabela de parcelas colada do contrato. Aceita a linha inteira do PDF
 * ("1 R$ 2.498,31 R$ 472,18 ... R$ 3.775,18") e fica com o ÚLTIMO valor da
 * linha, que é o total mensal — é ele que sai da conta. Também aceita o
 * formato simples "1  3775,18" ou "01/09/2026  3775,18".
 */
export function parseParcelasColadas(texto: string, primeiroVencimento: string): Parcela[] {
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const parcelas: Parcela[] = [];
  for (const linha of linhas) {
    const dataBR = linha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    // Todos os números da linha, no formato brasileiro.
    const numeros = linha.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (!numeros || !numeros.length) continue;

    const ultimo = numeros[numeros.length - 1]!;
    const valor = Number(ultimo.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) continue;

    const vencimento = dataBR
      ? `${dataBR[3]}-${dataBR[2]}-${dataBR[1]}`
      : addMonthsISO(primeiroVencimento, parcelas.length);

    parcelas.push({ due_date: vencimento, amount: valor });
  }
  return parcelas;
}

function EmprestimosPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [modo, setModo] = useState<"iguais" | "colar" | "arquivo">("iguais");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importado, setImportado] = useState<Parcela[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<LoanRow | null>(null);
  // Detalhe das parcelas: a data de baixa fica por parcela, porque cada uma
  // pode ter sido paga num dia diferente do vencimento.
  const [detalheDe, setDetalheDe] = useState<LoanRow | null>(null);
  const [datasBaixa, setDatasBaixa] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["emprestimos"],
    queryFn: async () => {
      const [loans, txs, banks, cats] = await Promise.all([
        supabase.from("loans").select("*").order("received_on", { ascending: false }),
        supabase
          .from("financial_transactions")
          .select("id, loan_id, type, status, amount, due_date, paid_on, recurrence_index, recurrence_total, description")
          .not("loan_id", "is", null),
        supabase.from("bank_accounts").select("id, name").eq("active", true).order("name"),
        supabase
          .from("categories")
          .select("id, name, type")
          .eq("active", true)
          .eq("type", "despesa")
          .order("name"),
      ]);
      throwFirstError(loans, txs, banks, cats);
      return {
        loans: (loans.data ?? []) as unknown as LoanRow[],
        txs: (txs.data ?? []) as unknown as ParcelaTx[],
        banks: banks.data ?? [],
        categories: cats.data ?? [],
      };
    },
  });

  /** As parcelas que serão criadas, conforme o modo escolhido. */
  const parcelas = useMemo<Parcela[]>(() => {
    if (modo === "arquivo") {
      // A planilha do banco costuma vir sem as datas (definidas no depósito):
      // nesse caso os vencimentos seguem mês a mês do 1º informado na tela.
      return (importado ?? []).map((p, i) => ({
        due_date: p.due_date || addMonthsISO(form.first_due, i),
        amount: p.amount,
      }));
    }
    if (modo === "colar") return parseParcelasColadas(form.pasted, form.first_due);
    const n = Math.max(1, Math.floor(num(Number(form.parcels))));
    const valor = num(Number(form.parcel_amount));
    if (valor <= 0) return [];
    return Array.from({ length: n }, (_, i) => ({
      due_date: addMonthsISO(form.first_due, i),
      amount: valor,
    }));
  }, [modo, form.pasted, form.first_due, form.parcels, form.parcel_amount, importado]);

  const totalParcelas = parcelas.reduce((s, p) => s + p.amount, 0);
  const recebido = num(Number(form.amount_received));
  const custoDoDinheiro = totalParcelas - recebido;

  /** Lê a planilha do empréstimo e já preenche o que veio nela. */
  async function lerArquivo(file: File) {
    try {
      const r = parseLoanWorkbook(await file.arrayBuffer());
      setImportado(r.parcels.map((p) => ({ due_date: p.due_date ?? "", amount: p.amount })));
      setAvisos(r.warnings);
      setForm((f) => ({
        ...f,
        lender: r.lender ?? f.lender,
        contract_number: r.contract_number ?? f.contract_number,
        amount_received: r.amount_received ? String(r.amount_received) : f.amount_received,
        received_on: r.received_on ?? f.received_on,
        notes: r.notes ?? f.notes,
      }));
      toast.success(`${r.parcels.length} parcela(s) lida(s) da planilha.`);
    } catch (e) {
      setImportado(null);
      setAvisos([]);
      if (fileRef.current) fileRef.current.value = "";
      toast.error("Não foi possível ler a planilha", { description: (e as Error).message });
    }
  }

  /** Baixa o modelo em branco para o escritório preencher. */
  function baixarModelo() {
    const t = loanTemplateRows();
    downloadXlsxSheets("modelo_emprestimo.xlsx", [
      { name: "Emprestimo", rows: t.emprestimo },
      { name: "Parcelas", rows: t.parcelas },
    ]);
    toast.success("Modelo baixado.");
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.lender.trim()) throw new Error("Informe quem concedeu o empréstimo");
      if (recebido <= 0) throw new Error("Informe o valor recebido");
      if (!parcelas.length) throw new Error("Informe as parcelas de devolução");
      const { error } = await supabase.rpc(
        "create_loan",
        dropUndefined({
          _lender: form.lender.trim(),
          _amount_received: recebido,
          _received_on: form.received_on,
          _installments: parcelas as never,
          _contract_number: form.contract_number.trim() || undefined,
          _bank_account_id: form.bank_account_id || undefined,
          _category_id: form.category_id || undefined,
          _notes: form.notes.trim() || undefined,
        }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Empréstimo cadastrado com ${parcelas.length} parcela(s) a pagar.`);
      setForm(EMPTY);
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao cadastrar", { description: friendlyError(e) }),
  });

  const marcarPaga = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: string }) => {
      if (!data) throw new Error("Informe a data em que a parcela foi paga");
      const { error } = await supabase
        .from("financial_transactions")
        .update({ status: "pago" as never, paid_on: data })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela paga — já entrou no caixa e no saldo da conta.");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao dar baixa", { description: friendlyError(e) }),
  });

  const desfazerBaixa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("financial_transactions")
        .update({ status: "previsto" as never, paid_on: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa desfeita — a parcela voltou para a lista a pagar.");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao desfazer", { description: friendlyError(e) }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Empréstimo inválido");
      const { data: resumo, error } = await supabase.rpc("delete_loan", {
        _loan_id: deleteTarget.id,
      });
      if (error) throw error;
      return resumo as unknown as {
        pagos: number;
        previstos: number;
        entrou: number;
        saiu: number;
      } | null;
    },
    onSuccess: (r) => {
      const mexeuNoCaixa = num(r?.entrou) + num(r?.saiu);
      toast.success("Empréstimo apagado com todos os lançamentos dele.", {
        description:
          mexeuNoCaixa > 0.01
            ? `${money(num(r?.entrou))} de entrada e ${money(num(r?.saiu))} de parcelas pagas saíram do fluxo de caixa.`
            : undefined,
      });
      setDeleteTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao apagar", { description: friendlyError(e) }),
  });

  /** Quanto falta pagar de cada empréstimo. */
  const resumoDe = (loanId: string) => {
    const linhas = (data?.txs ?? []).filter((t) => t.loan_id === loanId && t.type === "saida");
    const pago = linhas.filter((t) => t.status === "pago").reduce((s, t) => s + num(t.amount), 0);
    const aPagar = linhas
      .filter((t) => t.status !== "pago")
      .reduce((s, t) => s + num(t.amount), 0);
    const proxima = linhas
      .filter((t) => t.status !== "pago" && t.due_date)
      .map((t) => t.due_date!)
      .sort()[0];
    return { total: pago + aPagar, pago, aPagar, parcelas: linhas.length, proxima };
  };

  /** Parcelas do empréstimo aberto no detalhe, na ordem do vencimento. */
  const parcelasDoDetalhe = useMemo(() => {
    if (!detalheDe) return [] as ParcelaTx[];
    return (data?.txs ?? [])
      .filter((t) => t.loan_id === detalheDe.id && t.type === "saida")
      .sort(
        (a, b) =>
          (a.recurrence_index ?? 0) - (b.recurrence_index ?? 0) ||
          String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")),
      );
  }, [data, detalheDe]);

  const totalEmAberto = (data?.loans ?? []).reduce((s, l) => s + resumoDe(l.id).aPagar, 0);

  return (
    <>
      <PageHeader
        title="Empréstimos"
        description="Financiamentos do escritório. Entram e saem do caixa, mas ficam fora do lucro e do custo por cliente."
        action={canWrite && <Button onClick={() => setOpen(true)}>Novo empréstimo</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Empréstimos ativos</p>
          <p className="num mt-1 text-2xl font-semibold">{data?.loans.length ?? 0}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Ainda a pagar</p>
          <p className="num mt-1 text-xl font-semibold text-warning">{money(totalEmAberto)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Total já recebido</p>
          <p className="num mt-1 text-xl font-semibold">
            {money((data?.loans ?? []).reduce((s, l) => s + num(l.amount_received), 0))}
          </p>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Credor</th>
              <th>Contrato</th>
              <th>Recebido em</th>
              <th className="text-right">Valor recebido</th>
              <th className="text-right">Total a devolver</th>
              <th className="text-right">Falta pagar</th>
              <th>Próxima</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && (data?.loans.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Nenhum empréstimo cadastrado.
                </td>
              </tr>
            )}
            {(data?.loans ?? []).map((l) => {
              const r = resumoDe(l.id);
              return (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-medium">{l.lender}</td>
                  <td className="num text-xs">{l.contract_number ?? "—"}</td>
                  <td className="whitespace-nowrap">{dateBR(l.received_on)}</td>
                  <td className="num text-right">{money(l.amount_received)}</td>
                  <td className="num text-right">
                    {money(r.total)}
                    <span className="block text-xs text-muted-foreground">
                      {r.parcelas} parcela(s)
                    </span>
                  </td>
                  <td className="num text-right font-medium">{money(r.aPagar)}</td>
                  <td className="whitespace-nowrap">{dateBR(r.proxima)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => setDetalheDe(l)}>
                      Parcelas
                    </Button>
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setDeleteTarget(l)}
                      >
                        Apagar
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setForm(EMPTY);
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo empréstimo</DialogTitle>
            <DialogDescription>
              O valor recebido entra no caixa e as parcelas viram contas a pagar — tudo marcado
              como financiamento, fora do lucro e do custo por cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cred">Credor</Label>
              <Input
                id="cred"
                placeholder="Ex.: Mútua, Banco do Brasil, sócio"
                value={form.lender}
                onChange={(e) => setForm({ ...form, lender: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ctr">Nº do contrato</Label>
              <Input
                id="ctr"
                value={form.contract_number}
                onChange={(e) => setForm({ ...form, contract_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vrec">Valor recebido</Label>
              <Input
                id="vrec"
                type="number"
                step="0.01"
                value={form.amount_received}
                onChange={(e) => setForm({ ...form, amount_received: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drec">Recebido em</Label>
              <Input
                id="drec"
                type="date"
                value={form.received_on}
                onChange={(e) => setForm({ ...form, received_on: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Conta que recebeu</Label>
              <Select
                value={form.bank_account_id}
                onValueChange={(v) => setForm({ ...form, bank_account_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
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
            <div className="space-y-2">
              <Label>Categoria das parcelas</Label>
              <Select
                value={form.category_id}
                onValueChange={(v) => setForm({ ...form, category_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-2 space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={modo === "iguais" ? "default" : "outline"}
                onClick={() => setModo("iguais")}
              >
                Parcelas iguais
              </Button>
              <Button
                size="sm"
                variant={modo === "colar" ? "default" : "outline"}
                onClick={() => setModo("colar")}
              >
                Colar tabela do contrato
              </Button>
              <Button
                size="sm"
                variant={modo === "arquivo" ? "default" : "outline"}
                onClick={() => setModo("arquivo")}
              >
                Importar planilha
              </Button>
            </div>

            {modo === "arquivo" ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="arq">Planilha do empréstimo</Label>
                    <Input
                      id="arq"
                      ref={fileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void lerArquivo(f);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pv3">1º vencimento</Label>
                    <Input
                      id="pv3"
                      type="date"
                      value={form.first_due}
                      onChange={(e) => setForm({ ...form, first_due: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Usado só nas parcelas que vierem sem data.
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={baixarModelo}>
                  Baixar modelo em branco
                </Button>
                {avisos.length > 0 && (
                  <ul className="list-disc space-y-1 rounded-md border border-warning/40 p-3 pl-7 text-xs text-muted-foreground">
                    {avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  A planilha tem duas abas: <strong>Emprestimo</strong> (credor, contrato, valor
                  recebido e data) e <strong>Parcelas</strong> (nº, vencimento e valor). O que
                  vier preenchido na primeira aba já cai nos campos acima.
                </p>
              </div>
            ) : modo === "iguais" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="np">Nº de parcelas</Label>
                  <Input
                    id="np"
                    type="number"
                    min="1"
                    value={form.parcels}
                    onChange={(e) => setForm({ ...form, parcels: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vp">Valor de cada</Label>
                  <Input
                    id="vp"
                    type="number"
                    step="0.01"
                    value={form.parcel_amount}
                    onChange={(e) => setForm({ ...form, parcel_amount: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pv">1º vencimento</Label>
                  <Input
                    id="pv"
                    type="date"
                    value={form.first_due}
                    onChange={(e) => setForm({ ...form, first_due: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pv2">1º vencimento</Label>
                    <Input
                      id="pv2"
                      type="date"
                      value={form.first_due}
                      onChange={(e) => setForm({ ...form, first_due: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Usado quando as linhas coladas não trazem a data.
                    </p>
                  </div>
                </div>
                <Label htmlFor="col">Cole aqui a tabela de parcelas do contrato</Label>
                <Textarea
                  id="col"
                  className="min-h-40 font-mono text-xs"
                  placeholder={
                    "1 R$ 2.498,31 R$ 472,18 R$ 674,54 R$ 130,15 R$ 3.775,18\n" +
                    "2 R$ 2.498,31 R$ 463,44 R$ 662,05 R$ 130,15 R$ 3.753,95"
                  }
                  value={form.pasted}
                  onChange={(e) => setForm({ ...form, pasted: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Uma parcela por linha. De cada linha é usado o <strong>último valor</strong> —
                  que na tabela do contrato é o total mensal, o que realmente sai da conta. Se a
                  linha tiver data (dd/mm/aaaa), ela é respeitada; senão os vencimentos seguem
                  mês a mês a partir do 1º vencimento.
                </p>
              </div>
            )}

            {parcelas.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                <p>
                  <strong className="num">{parcelas.length}</strong> parcela(s) — total a devolver{" "}
                  <strong className="num">{money(totalParcelas)}</strong>
                  {recebido > 0 && custoDoDinheiro > 0 && (
                    <>
                      {" "}
                      · custo do dinheiro{" "}
                      <strong className="num text-destructive">{money(custoDoDinheiro)}</strong>
                    </>
                  )}
                </p>
                <p className="mt-1 text-muted-foreground">
                  De {dateBR(parcelas[0]?.due_date)} a {dateBR(parcelas[parcelas.length - 1]?.due_date)}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="obs">Observações</Label>
            <Textarea
              id="obs"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !parcelas.length}
            >
              {create.isPending ? "Criando…" : `Criar com ${parcelas.length} parcela(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhe das parcelas: dar baixa aqui é a mesma coisa que dar baixa no
          Fluxo de Caixa — a parcela vira despesa paga na data informada. */}
      <Dialog
        open={!!detalheDe}
        onOpenChange={(v) => {
          if (!v) {
            setDetalheDe(null);
            setDatasBaixa({});
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Parcelas — {detalheDe?.lender}</DialogTitle>
            <DialogDescription>
              {detalheDe?.contract_number ? `Contrato ${detalheDe.contract_number}. ` : ""}
              Ao dar baixa, a parcela vira despesa paga na data informada e sai do saldo da conta.
            </DialogDescription>
          </DialogHeader>

          {detalheDe &&
            (() => {
              const r = resumoDe(detalheDe.id);
              return (
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="panel p-3">
                    <p className="text-xs text-muted-foreground uppercase">Parcelas</p>
                    <p className="num mt-1 text-lg font-semibold">{r.parcelas}</p>
                  </div>
                  <div className="panel p-3">
                    <p className="text-xs text-muted-foreground uppercase">Já pago</p>
                    <p className="num mt-1 text-lg font-semibold text-success">{money(r.pago)}</p>
                  </div>
                  <div className="panel p-3">
                    <p className="text-xs text-muted-foreground uppercase">Falta pagar</p>
                    <p className="num mt-1 text-lg font-semibold text-warning">{money(r.aPagar)}</p>
                  </div>
                  <div className="panel p-3">
                    <p className="text-xs text-muted-foreground uppercase">Próximo vencimento</p>
                    <p className="mt-1 text-lg font-semibold">{dateBR(r.proxima)}</p>
                  </div>
                </div>
              );
            })()}

          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="p-2">Parcela</th>
                  <th>Vencimento</th>
                  <th className="text-right">Valor</th>
                  <th>Situação</th>
                  <th className="p-2">Baixa</th>
                </tr>
              </thead>
              <tbody>
                {parcelasDoDetalhe.map((t) => {
                  const pago = t.status === "pago";
                  return (
                    <tr key={t.id} className="border-b border-border/60 last:border-0">
                      <td className="p-2 whitespace-nowrap">
                        {t.recurrence_index ?? "—"}
                        {t.recurrence_total ? `/${t.recurrence_total}` : ""}
                      </td>
                      <td className="whitespace-nowrap">{dateBR(t.due_date)}</td>
                      <td className="num text-right">{money(t.amount)}</td>
                      <td>
                        {pago ? (
                          <span className="text-xs text-success">
                            Paga em {dateBR(t.paid_on)}
                          </span>
                        ) : (
                          <span className="text-xs text-warning">A pagar</span>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {pago ? (
                          canWrite && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={desfazerBaixa.isPending}
                              onClick={() => desfazerBaixa.mutate(t.id)}
                            >
                              Desfazer
                            </Button>
                          )
                        ) : (
                          canWrite && (
                            <div className="flex items-center gap-1">
                              <Input
                                type="date"
                                className="w-36"
                                aria-label={`Data do pagamento da parcela ${t.recurrence_index ?? ""}`}
                                value={datasBaixa[t.id] ?? t.due_date ?? todayISO()}
                                onChange={(e) =>
                                  setDatasBaixa((d) => ({ ...d, [t.id]: e.target.value }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={marcarPaga.isPending}
                                onClick={() =>
                                  marcarPaga.mutate({
                                    id: t.id,
                                    data: datasBaixa[t.id] ?? t.due_date ?? todayISO(),
                                  })
                                }
                              >
                                OK
                              </Button>
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
                {parcelasDoDetalhe.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      Este empréstimo não tem parcelas cadastradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            A data vem preenchida com o vencimento. Se pagou em outro dia, troque antes de clicar
            em OK — é essa data que entra no caixa.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetalheDe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o empréstimo de {deleteTarget?.lender}?</AlertDialogTitle>
            <AlertDialogDescription>
              Some tudo o que nasceu deste empréstimo: a entrada do dinheiro recebido e todas as
              parcelas, pagas ou não. O saldo das contas muda na hora. Fica registrado no log de
              auditoria o que foi apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Apagando…" : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
