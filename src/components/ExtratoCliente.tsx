import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, num, dateBR, todayISO } from "@/lib/format";
import { friendlyError, throwFirstError } from "@/lib/errors";

/**
 * Extrato da cliente, feito para ser fotografado e enviado a ela.
 *
 * O escritório mandava esses números a mão, montando a conta no WhatsApp a
 * cada pergunta. A tela responde as três perguntas que a cliente sempre faz,
 * nesta ordem: o que já entrou, quanto disso é meu, e o que ainda falta.
 *
 * Tudo em linguagem de cliente: nada de "sucumbência", "parcela PARCIAL" ou
 * nome de tabela. E o dinheiro do escritório fica sempre separado e rotulado
 * do dinheiro dela, porque é daí que nasce a desconfiança.
 */

type Parcela = {
  id: string;
  label: string | null;
  due_date: string | null;
  gross_amount: number;
  fee_amount: number;
  success_fee_amount: number;
  client_amount: number;
  paid_total: number;
  paid_client: number;
  balance: number;
  status: string;
};

type Recebimento = {
  installment_id: string;
  received_on: string;
  total_amount: number;
  client_amount_received_by_firm: number;
  client_amount_received_direct: number;
};

type Repasse = {
  id: string;
  amount: number;
  scheduled_for: string | null;
  paid_on: string | null;
  status: string;
};

/** Linha de valor, com o rótulo à esquerda e o número à direita. */
function Linha({
  texto,
  valor,
  forte,
  cor,
}: {
  texto: string;
  valor: number;
  forte?: boolean;
  cor?: "cliente" | "escritorio";
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        forte ? "border-t border-border font-semibold" : ""
      }`}
    >
      <span className={forte ? "text-foreground" : "text-muted-foreground"}>{texto}</span>
      <span
        className={`num tabular-nums ${
          cor === "cliente" ? "text-success" : cor === "escritorio" ? "text-info" : ""
        }`}
      >
        {money(valor)}
      </span>
    </div>
  );
}

export function ExtratoCliente({
  clientId,
  nome,
  onClose,
}: {
  clientId: string | null;
  nome: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["extrato-cliente", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const [parcelas, repasses] = await Promise.all([
        supabase
          .from("v_installments")
          .select(
            "id, label, due_date, gross_amount, fee_amount, success_fee_amount, client_amount, paid_total, paid_client, balance, status",
          )
          .eq("client_id", clientId!),
        supabase
          .from("client_transfers")
          .select("id, amount, scheduled_for, paid_on, status")
          .eq("client_id", clientId!)
          .order("paid_on", { ascending: true }),
      ]);
      throwFirstError(parcelas, repasses);

      const linhas = (parcelas.data ?? []) as unknown as Parcela[];
      // Os recebimentos vêm pelas parcelas dela: é o que dá a data em que
      // cada dinheiro entrou.
      const ids = linhas.map((p) => p.id);
      const recebimentos = ids.length
        ? await supabase
            .from("receipts")
            .select(
              "installment_id, received_on, total_amount, client_amount_received_by_firm, client_amount_received_direct",
            )
            .in("installment_id", ids)
            .is("reversed_at", null)
            .order("received_on", { ascending: true })
        : { data: [], error: null };
      throwFirstError(recebimentos);

      return {
        parcelas: linhas,
        recebimentos: (recebimentos.data ?? []) as unknown as Recebimento[],
        repasses: (repasses.data ?? []) as unknown as Repasse[],
      };
    },
  });

  const p = data?.parcelas ?? [];
  const r = data?.recebimentos ?? [];
  const t = data?.repasses ?? [];

  // ---- o que já entrou ----
  const totalEntrou = r.reduce((s, x) => s + num(x.total_amount), 0);
  // O que é dela do que entrou — some o que passou pela conta do escritório e
  // o que a empresa pagou direto a ela.
  const dela = r.reduce(
    (s, x) => s + num(x.client_amount_received_by_firm) + num(x.client_amount_received_direct),
    0,
  );
  const doEscritorio = Math.max(totalEntrou - dela, 0);

  // ---- repasses ----
  const repassado = t
    .filter((x) => x.status === "pago")
    .reduce((s, x) => s + num(x.amount), 0);
  // O que ela recebeu direto da empresa não passa por repasse: já está com ela.
  const direto = r.reduce((s, x) => s + num(x.client_amount_received_direct), 0);
  const peloEscritorio = r.reduce((s, x) => s + num(x.client_amount_received_by_firm), 0);
  const faltaRepassar = Math.max(peloEscritorio - repassado, 0);

  // ---- o que ainda vai entrar ----
  const emAberto = p.filter((x) => x.status !== "PAGA" && x.status !== "CANCELADA");
  const aEntrar = emAberto.reduce((s, x) => s + num(x.balance), 0);
  // Quanto do que falta entrar é dela.
  const aEntrarDela = emAberto.reduce(
    (s, x) => s + Math.max(num(x.client_amount) - num(x.paid_client), 0),
    0,
  );
  const aEntrarEscritorio = Math.max(aEntrar - aEntrarDela, 0);

  // O total que ela ainda tem para receber: o que está parado aqui mais o que
  // ainda vai entrar e é dela.
  const totalDelaAinda = faltaRepassar + aEntrarDela;

  return (
    <Dialog open={!!clientId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Extrato de {nome}</DialogTitle>
          <DialogDescription>
            Posição em {dateBR(todayISO())}. Esta tela foi feita para você mandar para a cliente.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-8 text-center text-muted-foreground">Carregando…</p>}
        {error && (
          <p className="py-8 text-center text-destructive">
            Não foi possível montar o extrato: {friendlyError(error)}
          </p>
        )}

        {!isLoading && !error && (
          <div className="space-y-6 text-sm">
            {/* ---------- o que já entrou ---------- */}
            <section>
              <h3 className="mb-1 font-display text-sm font-semibold">O que já foi recebido</h3>
              {r.length === 0 ? (
                <p className="py-2 text-muted-foreground">Nenhum valor recebido até agora.</p>
              ) : (
                <>
                  <div className="rounded-md border border-border">
                    {r.map((x, i) => (
                      <div
                        key={`${x.installment_id}-${i}`}
                        className="flex items-baseline justify-between gap-4 border-b border-border/60 px-3 py-2 last:border-0"
                      >
                        <span className="text-muted-foreground">{dateBR(x.received_on)}</span>
                        <span className="num tabular-nums">{money(x.total_amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1">
                    <Linha texto="Total recebido" valor={totalEntrou} forte />
                    <Linha texto="Parte sua" valor={dela} cor="cliente" />
                    <Linha texto="Honorários do escritório" valor={doEscritorio} cor="escritorio" />
                  </div>
                </>
              )}
            </section>

            {/* ---------- o que é dela ---------- */}
            <section>
              <h3 className="mb-1 font-display text-sm font-semibold">O seu dinheiro</h3>
              {direto > 0.01 && (
                <Linha texto="Recebido direto da empresa, já com você" valor={direto} />
              )}
              <Linha texto="Que passou pela conta do escritório" valor={peloEscritorio} />
              <Linha texto="Já repassado a você" valor={repassado} />
              <Linha texto="Falta repassar" valor={faltaRepassar} forte cor="cliente" />

              {t.length > 0 && (
                <div className="mt-2 rounded-md border border-border">
                  {t.map((x) => (
                    <div
                      key={x.id}
                      className="flex items-baseline justify-between gap-4 border-b border-border/60 px-3 py-2 text-xs last:border-0"
                    >
                      <span className="text-muted-foreground">
                        {x.status === "pago"
                          ? `Pago em ${dateBR(x.paid_on)}`
                          : x.status === "cancelado"
                            ? "Cancelado"
                            : `Previsto para ${dateBR(x.scheduled_for)}`}
                      </span>
                      <span
                        className={`num tabular-nums ${
                          x.status === "cancelado" ? "text-muted-foreground line-through" : ""
                        }`}
                      >
                        {money(x.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ---------- o que ainda vai entrar ---------- */}
            <section>
              <h3 className="mb-1 font-display text-sm font-semibold">O que ainda vai entrar</h3>
              {emAberto.length === 0 ? (
                <p className="py-2 text-muted-foreground">
                  Nada em aberto — todas as parcelas já foram pagas.
                </p>
              ) : (
                <>
                  <div className="rounded-md border border-border">
                    {emAberto
                      .slice()
                      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
                      .map((x) => (
                        <div
                          key={x.id}
                          className="flex items-baseline justify-between gap-4 border-b border-border/60 px-3 py-2 last:border-0"
                        >
                          <span className="text-muted-foreground">
                            {x.due_date ? dateBR(x.due_date) : "Sem data definida"}
                          </span>
                          <span className="num tabular-nums">{money(x.balance)}</span>
                        </div>
                      ))}
                  </div>
                  <div className="mt-1">
                    <Linha texto="Total a entrar" valor={aEntrar} forte />
                    <Linha texto="Parte sua" valor={aEntrarDela} cor="cliente" />
                    <Linha
                      texto="Honorários do escritório"
                      valor={aEntrarEscritorio}
                      cor="escritorio"
                    />
                  </div>
                </>
              )}
            </section>

            {/* ---------- o resumo ---------- */}
            <section className="rounded-md border-2 border-primary/30 bg-accent/30 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-display font-semibold">Você ainda tem a receber</span>
                <span className="num text-xl font-bold tabular-nums text-success">
                  {money(totalDelaAinda)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {money(faltaRepassar)} já estão com o escritório e serão repassados
                {aEntrarDela > 0.01 ? `, mais ${money(aEntrarDela)} que ainda vão entrar` : ""}.
              </p>
            </section>

            <p className="text-xs text-muted-foreground">
              Valores conferidos nesta data. Parcelas futuras dependem do pagamento pela outra
              parte.
            </p>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
