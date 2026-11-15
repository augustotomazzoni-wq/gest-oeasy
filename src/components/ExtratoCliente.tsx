import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todas } from "@/lib/paginar";
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
      className={`flex items-baseline justify-between gap-4 py-1 ${
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
        todas(
          supabase
            .from("v_installments")
            .select(
              "id, label, due_date, gross_amount, fee_amount, success_fee_amount, client_amount, paid_total, paid_client, balance, status",
            )
            .eq("client_id", clientId!)
            .order("id"),
        ),
        todas(
          supabase
            .from("client_transfers")
            .select("id, amount, scheduled_for, paid_on, status")
            .eq("client_id", clientId!)
            .order("paid_on", { ascending: true })
            .order("id"),
        ),
      ]);
      throwFirstError(parcelas, repasses);

      const linhas = (parcelas.data ?? []) as unknown as Parcela[];
      // Os recebimentos vêm pelas parcelas dela: é o que dá a data em que
      // cada dinheiro entrou.
      const ids = linhas.map((p) => p.id);
      const recebimentos = ids.length
        ? await todas(
            supabase
              .from("receipts")
              .select(
                "installment_id, received_on, total_amount, client_amount_received_by_firm, client_amount_received_direct",
              )
              .in("installment_id", ids)
              .is("reversed_at", null)
              .order("received_on", { ascending: true })
              .order("id"),
          )
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
  const repassado = t.filter((x) => x.status === "pago").reduce((s, x) => s + num(x.amount), 0);
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

  const ordenarPorData = <T,>(lista: T[], data: (x: T) => string | null) =>
    lista.slice().sort((a, b) => (data(a) ?? "9999").localeCompare(data(b) ?? "9999"));

  return (
    <Dialog open={!!clientId} onOpenChange={(v) => !v && onClose()}>
      {/* Uma tela só, para dar o print e mandar. As três partes ficam lado a
          lado e, se a lista for longa demais, o conteúdo inteiro encolhe para
          caber — nada fica escondido embaixo da dobra. */}
      <DialogContent className="flex max-h-[96vh] w-[97vw] max-w-[1200px] flex-col gap-3 overflow-hidden p-5 sm:max-w-[1200px]">
        <DialogHeader className="pr-8">
          <DialogTitle>Extrato de {nome}</DialogTitle>
          <DialogDescription>Posição em {dateBR(todayISO())}.</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-8 text-center text-muted-foreground">Carregando…</p>}
        {error && (
          <p className="py-8 text-center text-destructive">
            Não foi possível montar o extrato: {friendlyError(error)}
          </p>
        )}

        {!isLoading && !error && (
          <CabeNaTela>
            <div className="space-y-3 text-sm">
              {/* ---------- a resposta que ela quer, primeiro ---------- */}
              <section className="grid gap-3 rounded-md border-2 border-primary/30 bg-accent/30 p-3 sm:grid-cols-[1.5fr_1fr_1fr_1fr]">
                <div>
                  <p className="font-display font-semibold">Você ainda tem a receber</p>
                  <p className="num text-2xl font-bold tabular-nums text-success">
                    {money(totalDelaAinda)}
                  </p>
                </div>
                <Destaque texto="Já está com você" valor={repassado + direto} />
                <Destaque texto="Com o escritório, a repassar" valor={faltaRepassar} />
                <Destaque texto="Ainda vai entrar (sua parte)" valor={aEntrarDela} />
              </section>

              <div className="grid gap-3 md:grid-cols-3">
                {/* ---------- o que já entrou ---------- */}
                <Coluna titulo="O que já foi recebido">
                  {r.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">
                      Nenhum valor recebido até agora.
                    </p>
                  ) : (
                    <Lista
                      itens={ordenarPorData(r, (x) => x.received_on).map((x, i) => ({
                        chave: `${x.installment_id}-${i}`,
                        rotulo: dateBR(x.received_on),
                        valor: money(x.total_amount),
                      }))}
                    />
                  )}
                  <div className="mt-1">
                    <Linha texto="Total recebido" valor={totalEntrou} forte />
                    <Linha texto="Parte sua" valor={dela} cor="cliente" />
                    <Linha texto="Honorários do escritório" valor={doEscritorio} cor="escritorio" />
                  </div>
                </Coluna>

                {/* ---------- o que é dela ---------- */}
                <Coluna titulo="O seu dinheiro">
                  {direto > 0.01 && (
                    <Linha texto="Recebido direto da empresa, já com você" valor={direto} />
                  )}
                  <Linha texto="Passou pela conta do escritório" valor={peloEscritorio} />
                  <Linha texto="Já repassado a você" valor={repassado} />
                  <Linha texto="Falta repassar" valor={faltaRepassar} forte cor="cliente" />
                  {t.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium text-muted-foreground">
                        Repasses feitos a você (data do pagamento)
                      </p>
                      <Lista
                        itens={ordenarPorData(t, (x) => x.paid_on ?? x.scheduled_for).map((x) => ({
                          chave: x.id,
                          rotulo:
                            // Curto de propósito: com a lista em duas colunas, "Pago
                            // em" cortava a data, que é o que importa.
                            x.status === "pago"
                              ? dateBR(x.paid_on)
                              : x.status === "cancelado"
                                ? "Cancelado"
                                : `Prev. ${dateBR(x.scheduled_for)}`,
                          valor: money(x.amount),
                          riscado: x.status === "cancelado",
                        }))}
                      />
                    </>
                  )}
                </Coluna>

                {/* ---------- o que ainda vai entrar ---------- */}
                <Coluna titulo="O que ainda vai entrar">
                  {emAberto.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">
                      Nada em aberto — todas as parcelas já foram pagas.
                    </p>
                  ) : (
                    <>
                      <Lista
                        itens={ordenarPorData(emAberto, (x) => x.due_date).map((x) => ({
                          chave: x.id,
                          rotulo: x.due_date ? dateBR(x.due_date) : "Sem data definida",
                          valor: money(x.balance),
                        }))}
                      />
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
                </Coluna>
              </div>

              <p className="text-xs text-muted-foreground">
                Valores conferidos em {dateBR(todayISO())}. Parcelas futuras dependem do pagamento
                pela outra parte.
              </p>
            </div>
          </CabeNaTela>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Um número de apoio do quadro de cima. */
function Destaque({ texto, valor }: { texto: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{texto}</p>
      <p className="num text-lg font-semibold tabular-nums">{money(valor)}</p>
    </div>
  );
}

/** Uma das três partes do extrato. */
function Coluna({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="mb-1 font-display text-sm font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * Lista de datas e valores. Com muitas linhas, vira duas colunas — cabe o
 * dobro na mesma altura e o extrato continua numa tela só.
 */
function Lista({
  itens,
}: {
  itens: { chave: string; rotulo: string; valor: string; riscado?: boolean }[];
}) {
  return (
    <div
      className={`rounded-md border border-border text-xs ${
        itens.length > 8 ? "grid grid-cols-2 gap-x-3" : ""
      }`}
    >
      {itens.map((x) => (
        <div
          key={x.chave}
          className="flex items-baseline justify-between gap-2 border-b border-border/60 px-2 py-1"
        >
          <span className="truncate text-muted-foreground">{x.rotulo}</span>
          <span
            className={`num shrink-0 tabular-nums ${
              x.riscado ? "text-muted-foreground line-through" : ""
            }`}
          >
            {x.valor}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Abaixo disto o texto fica pequeno demais para ler: aí é melhor rolar. */
const ESCALA_MINIMA = 0.55;

/**
 * Encolhe o conteúdo, por igual, até ele caber na altura da tela.
 *
 * O extrato é para ser fotografado. Uma cliente com vinte parcelas deixava
 * metade da conta embaixo da dobra, e o print saía cortado. Aqui o que não
 * cabe é reduzido em vez de escondido; só se ficar pequeno demais para ler
 * é que volta a rolar.
 */
function CabeNaTela({ children }: { children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  useLayoutEffect(() => {
    const medir = () => {
      const c = caixa.current;
      const k = conteudo.current;
      if (!c || !k) return;
      // A escala não muda a altura de layout do conteúdo, então a medida
      // não entra em ciclo.
      const necessario = k.offsetHeight;
      const disponivel = c.clientHeight;
      if (!necessario || !disponivel) return;
      setEscala(Math.max(Math.min(1, disponivel / necessario), ESCALA_MINIMA));
    };
    medir();
    const obs = new ResizeObserver(medir);
    if (caixa.current) obs.observe(caixa.current);
    if (conteudo.current) obs.observe(conteudo.current);
    return () => obs.disconnect();
  }, []);

  const rola = escala <= ESCALA_MINIMA;
  return (
    <div ref={caixa} className={`min-h-0 flex-1 ${rola ? "overflow-y-auto" : "overflow-hidden"}`}>
      <div
        ref={conteudo}
        style={
          escala < 1 && !rola
            ? { transform: `scale(${escala})`, transformOrigin: "top center" }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * O nome da cliente como botão. Onde aparecer — Clientes, Acordos, Parcelas
 * ou Repasses — clicar abre o mesmo extrato. Antes havia duas janelas
 * diferentes para a mesma pergunta, cada uma com a sua conta.
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
        <ExtratoCliente clientId={clientId} nome={nome} onClose={() => setAberto(false)} />
      )}
    </>
  );
}
