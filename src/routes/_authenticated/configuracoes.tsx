import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { money, num, maskAccount, todayISO } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Cadastro de contas bancárias e categorias de receitas e despesas do escritório.",
      },
      { property: "og:title", content: "Configurações financeiras" },
      {
        property: "og:description",
        content: "Contas bancárias e plano de categorias do escritório.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [bankOpen, setBankOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [bank, setBank] = useState({
    name: "",
    bank: "",
    branch: "",
    account: "",
    initial_balance: "0",
    initial_balance_date: todayISO(),
  });
  const [cat, setCat] = useState({ name: "", type: "despesa" });

  const { data } = useQuery({
    queryKey: ["configuracoes"],
    queryFn: async () => {
      const [banks, cats, balances] = await Promise.all([
        supabase.from("bank_accounts").select("*").order("name"),
        supabase.from("categories").select("*").order("type").order("name"),
        supabase.from("v_bank_balances").select("*"),
      ]);
      if (banks.error) throw banks.error;
      return {
        banks: banks.data ?? [],
        categories: cats.data ?? [],
        balances: new Map(
          ((balances.data ?? []) as unknown as {
            bank_account_id: string;
            balance: number;
          }[]).map((b) => [b.bank_account_id, num(b.balance)]),
        ),
      };
    },
  });

  const addBank = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!bank.name.trim()) throw new Error("Informe o nome da conta");
      const { error } = await supabase.from("bank_accounts").insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        name: bank.name.trim(),
        bank: bank.bank.trim() || null,
        branch: bank.branch.trim() || null,
        account: bank.account.trim() || null,
        initial_balance: num(Number(bank.initial_balance)),
        initial_balance_date: bank.initial_balance_date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta cadastrada.");
      setBank({
        name: "",
        bank: "",
        branch: "",
        account: "",
        initial_balance: "0",
        initial_balance_date: todayISO(),
      });
      setBankOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const addCat = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!cat.name.trim()) throw new Error("Informe o nome da categoria");
      const { error } = await supabase.from("categories").insert({
        organization_id: profile.organization_id,
        name: cat.name.trim(),
        type: cat.type as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria cadastrada.");
      setCat({ name: "", type: "despesa" });
      setCatOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Contas bancárias e categorias usadas nos lançamentos financeiros."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="flex items-center justify-between border-b border-border p-3">
            <h2 className="font-display text-sm font-semibold">Contas bancárias</h2>
            {canWrite && (
              <Dialog open={bankOpen} onOpenChange={setBankOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Nova conta</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nova conta bancária</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="bn">Nome de exibição</Label>
                      <Input
                        id="bn"
                        value={bank.name}
                        onChange={(e) => setBank({ ...bank, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bb">Banco</Label>
                      <Input
                        id="bb"
                        value={bank.bank}
                        onChange={(e) => setBank({ ...bank, bank: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="br">Agência</Label>
                      <Input
                        id="br"
                        value={bank.branch}
                        onChange={(e) => setBank({ ...bank, branch: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ba">Conta</Label>
                      <Input
                        id="ba"
                        value={bank.account}
                        onChange={(e) => setBank({ ...bank, account: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bi">Saldo inicial</Label>
                      <Input
                        id="bi"
                        type="number"
                        step="0.01"
                        value={bank.initial_balance}
                        onChange={(e) =>
                          setBank({ ...bank, initial_balance: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="bd">Data do saldo inicial</Label>
                      <Input
                        id="bd"
                        type="date"
                        value={bank.initial_balance_date}
                        onChange={(e) =>
                          setBank({ ...bank, initial_balance_date: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setBankOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={() => addBank.mutate()} disabled={addBank.isPending}>
                      Salvar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(data?.banks ?? []).map((b) => (
                <tr key={b.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <span className="font-medium">{b.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.bank ?? "—"} · ag. {b.branch ?? "—"} · cc.{" "}
                      {maskAccount(b.account)}
                    </span>
                  </td>
                  <td className="num p-3 text-right font-medium">
                    {money(data?.balances.get(b.id) ?? b.initial_balance)}
                  </td>
                </tr>
              ))}
              {(data?.banks.length ?? 0) === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground">
                    Nenhuma conta cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="flex items-center justify-between border-b border-border p-3">
            <h2 className="font-display text-sm font-semibold">Categorias</h2>
            {canWrite && (
              <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Nova categoria</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nova categoria</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="cn">Nome</Label>
                      <Input
                        id="cn"
                        value={cat.name}
                        onChange={(e) => setCat({ ...cat, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select
                        value={cat.type}
                        onValueChange={(v) => setCat({ ...cat, type: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="receita">Receita</SelectItem>
                          <SelectItem value="despesa">Despesa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCatOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={() => addCat.mutate()} disabled={addCat.isPending}>
                      Salvar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(data?.categories ?? []).map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3 text-right">
                    <Tag tone={c.type === "receita" ? "success" : "danger"}>
                      {c.type === "receita" ? "Receita" : "Despesa"}
                    </Tag>
                  </td>
                </tr>
              ))}
              {(data?.categories.length ?? 0) === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground">
                    Nenhuma categoria cadastrada.
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
