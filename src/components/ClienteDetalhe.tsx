import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, num, dateBR } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

/**
 * Extrato de uma cliente, aberto pelo nome dela em qualquer tela.
 *
 * Junta o que está espalhado em quatro tabelas para responder as perguntas que
 * sempre aparecem no balcão: quanto era dela, quanto é do escritório, quanto
 * ela já recebeu de fato e o que ainda falta — com as datas de cada parcela
 * que ainda vai vencer.
 */
function useExtratoDaCliente(clientId: string | null) {
  return useQuery({
    queryKey: ["cliente-extrato", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const [inst, recv, transfers] = await Promise.all([
        supabase
          .from("v_installments")
          .select("id, due_date, status, label, client_amount, paid_client, balance")
          .eq("client_id", clientId!)
          .is("canceled_at", null)
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase
          .from("legal_receivables")
          .select("id, expected_client_amount, expected_firm_amount")
          .eq("client_id", clientId!)
          .neq("status", "cancelado")
          .is("deleted_at", null),
        supabase
          .from("client_transfers")
          .select("id, amount, paid_on, status")
          .eq("client_id", clientId!)
          .eq("status", "pago")
          .order("paid_on", { ascending: false }),
      ]);
      if (inst.error) throw inst.error;
      if (recv.error) throw recv.error;
      if (transfers.error) throw transfers.error;

      const ids = (inst.data ?? []).map((i) => i.id as string);
      const rec = ids.length
        ? await supabase
            .from("receipts")
            .select(
              "id, received_on, total_amount, client_amount, client_amount_received_by_firm, client_amount_received_direct",
            )
            .in("installment_id", ids)
            .is("reversed_at", null)
            .order("received_on", { ascending: false })
        : { data: [], error: null };
      if (rec.error) throw rec.error;

      return {
        installments: (inst.data ?? []) as unknown as {
          id: string;
          due_date: string | null;
          status: string;
          label: string | null;
          client_amount: number | null;
          paid_client: number | null;
          balance: number | null;
        }[],
        receivables: (recv.data ?? []) as unknown as {
          id: string;
          expected_client_amount: number | null;
          expected_firm_amount: number | null;
        }[],
        transfers: (transfers.data ?? []) as unknown as {
          id: string;
          amount: number;
          paid_on: string | null;
        }[],
        receipts: (rec.data ?? []) as unknown as {
          id: string;
          received_on: string;
          total_amount: number;
          client_amount: number | null;
          client_amount_received_by_firm: number | null;
          client_amount_received_direct: number | null;
        }[],
      };
    },
  });
}

export function ClienteDetalheDialog({
  clientId,
  name,
  onClose,
}: {
  clientId: string | null;
  name: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useExtratoDaCliente(clientId);
  // "Quanto falta receber" abre as datas — é a pergunta que sempre vem depois.
  const [mostrarDatas, setMostrarDatas] = useState(false);

  const resumo = useMemo(() => {
    if (!data) return null;
    const cabeAEla = data.receivables.reduce((s, r) => s + num(r.expected_client_amount), 0);
    const doEscritorio = data.receivables.reduce((s, r) => s + num(r.expected_firm_amount), 0);
    const repassado = data.transfers.reduce((s, t) => s + num(t.amount), 0);
    const direto = data.receipts.reduce(
      (s, r) => s + num(r.client_amount_received_direct),
      0,
    );
    const peloEscritorio = data.receipts.reduce(
      (s, r) => s + num(r.client_amount_received_by_firm),
      0,
    );
    // Dinheiro que chegou na mão dela: o que já foi repassado mais o que ela
    // recebeu direto da empresa. O que está com o escritório ainda não conta.
    const jaPagoAEla = repassado + direto;
    const emAberto = data.installments.filter(
      (i) => num(i.client_amount) - num(i.paid_client) > 0.01,
    );
    return {
      cabeAEla,
      doEscritorio,
      repassado,
      direto,
      jaPagoAEla,
      aguardandoRepasse: Math.max(peloEscritorio - repassado, 0),
      faltaReceber: Math.max(cabeAEla - jaPagoAEla, 0),
      emAberto,
    };
  }, [data]);

  return (
    <Dialog open={!!clientId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            Tudo o que é dela neste escritório: quanto foi conseguido, quanto já chegou nas mãos
            dela e o que ainda falta.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            Não foi possível carregar o extrato: {friendlyError(error)}
          </p>
        )}

        {!isLoading && !error && resumo && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="panel p-3">
                <p className="text-xs text-muted-foreground uppercase">Cabe a ela</p>
                <p className="num mt-1 text-lg font-semibold">{money(resumo.cabeAEla)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Somando os acordos, pagos ou não
                </p>
              </div>
              <div className="panel p-3">
                <p className="text-xs text-muted-foreground uppercase">Do escritório</p>
                <p className="num mt-1 text-lg font-semibold">{money(resumo.doEscritorio)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Honorários + sucumbência</p>
              </div>
              <div className="panel p-3">
                <p className="text-xs text-muted-foreground uppercase">Já pago a ela</p>
                <p className="num mt-1 text-lg font-semibold text-success">
                  {money(resumo.jaPagoAEla)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {money(resumo.repassado)} repassados, {money(resumo.direto)} direto
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMostrarDatas((v) => !v)}
                className="panel cursor-pointer p-3 text-left transition-colors hover:border-primary/50"
              >
                <p className="text-xs text-muted-foreground uppercase">Falta ela receber</p>
                <p className="num mt-1 text-lg font-semibold">{money(resumo.faltaReceber)}</p>
                <p className="mt-1 text-xs text-info underline underline-offset-2">
                  {mostrarDatas ? "Esconder as datas" : "Ver as datas"}
                </p>
              </button>
            </div>

            {resumo.aguardandoRepasse > 0.01 && (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                <strong className="num">{money(resumo.aguardandoRepasse)}</strong> já entraram na
                conta do escritório e ainda não foram repassados a ela.
              </p>
            )}

            {mostrarDatas && (
              <div>
                <h3 className="text-sm font-semibold">O que ainda vai vencer</h3>
                {resumo.emAberto.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Não há parcela em aberto com valor dela.
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[32rem] text-sm">
                      <thead className="bg-muted text-xs text-muted-foreground uppercase">
                        <tr>
                          <th className="p-2 text-left">Vencimento</th>
                          <th className="text-left">Parcela</th>
                          <th className="text-left">Situação</th>
                          <th className="p-2 text-right">Parte dela</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumo.emAberto.map((i) => (
                          <tr key={i.id} className="border-t border-border/60">
                            <td className="p-2">
                              {i.due_date ? dateBR(i.due_date) : "a definir"}
                            </td>
                            <td>{i.label || "—"}</td>
                            <td>
                              <StatusBadge status={i.status} />
                            </td>
                            <td className="num p-2 text-right font-medium">
                              {money(num(i.client_amount) - num(i.paid_client))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold">Recebimentos</h3>
              {data!.receipts.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhum recebimento registrado até agora.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead className="bg-muted text-xs text-muted-foreground uppercase">
                      <tr>
                        <th className="p-2 text-left">Data</th>
                        <th className="text-right">Recebimento</th>
                        <th className="text-right">Parte dela</th>
                        <th className="p-2 text-right">Como ela recebeu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.receipts.map((r) => (
                        <tr key={r.id} className="border-t border-border/60">
                          <td className="p-2">{dateBR(r.received_on)}</td>
                          <td className="num text-right">{money(r.total_amount)}</td>
                          <td className="num text-right font-medium">
                            {money(num(r.client_amount))}
                          </td>
                          <td className="p-2 text-right text-xs text-muted-foreground">
                            {num(r.client_amount_received_direct) > 0.01 &&
                            num(r.client_amount_received_by_firm) > 0.01
                              ? "Parte direto, parte pelo escritório"
                              : num(r.client_amount_received_direct) > 0.01
                                ? "Direto na conta dela"
                                : num(r.client_amount_received_by_firm) > 0.01
                                  ? "Pela conta do escritório"
                                  : "Sem parte dela"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {data!.transfers.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Repasses já pagos</h3>
                <div className="mt-2 overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[20rem] text-sm">
                    <thead className="bg-muted text-xs text-muted-foreground uppercase">
                      <tr>
                        <th className="p-2 text-left">Data</th>
                        <th className="p-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.transfers.map((t) => (
                        <tr key={t.id} className="border-t border-border/60">
                          <td className="p-2">{t.paid_on ? dateBR(t.paid_on) : "—"}</td>
                          <td className="num p-2 text-right">{money(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O nome da cliente como botão. Onde aparecer, clicar abre o extrato dela —
 * é a mesma peça em Clientes, Acordos, Parcelas e Repasses.
 */
export function ClienteLink({
  clientId,
  name,
  className = "",
}: {
  clientId: string | null | undefined;
  name: string | null | undefined;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const nome = name || "—";
  if (!clientId) return <span className={className}>{nome}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={`text-left underline decoration-dotted underline-offset-4 hover:text-info ${className}`}
      >
        {nome}
      </button>
      {aberto && (
        <ClienteDetalheDialog
          clientId={clientId}
          name={nome}
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}
