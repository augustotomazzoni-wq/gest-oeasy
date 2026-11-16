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
 * cada pergunta. A tela conta a história do dinheiro em passos, na ordem em
 * que a cliente pensa: quanto é o acordo e quanto dele é dela; onde está a
 * parte dela agora; e o detalhe de cada pagamento e de cada repasse.
 *
 * Tudo em linguagem de cliente: nada de "sucumbência", "parcela PARCIAL" ou
 * nome de tabela. E o dinheiro do escritório fica sempre separado e rotulado
 * do dinheiro dela, com a mesma cor em todo lugar, porque é daí que nasce a
 * desconfiança.
 */

type Parcela = {
  id: string;
  receivable_id: string | null;
  label: string | null;
  due_date: string | null;
  gross_amount: number;
  client_amount: number;
  cost_reimbursement: number;
  paid_total: number;
  paid_client: number;
  paid_cost_reimbursement: number;
  balance: number;
  status: string;
};

type Recebimento = {
  installment_id: string;
  received_on: string;
  total_amount: number;
  cost_reimbursement: number;
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

/** As cores combinadas: verde é da cliente, azul é do escritório. */
const COR = {
  cliente: { texto: "text-success", fundo: "bg-success" },
  escritorio: { texto: "text-info", fundo: "bg-info" },
  reembolso: { texto: "text-warning", fundo: "bg-warning" },
} as const;
type Cor = keyof typeof COR;

/** Linha de valor, com o rótulo à esquerda e o número à direita. */
function Linha({
  texto,
  valor,
  forte,
  cor,
  ajuda,
}: {
  texto: string;
  valor: number;
  forte?: boolean;
  cor?: Cor;
  ajuda?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1 ${
        forte ? "border-t border-border font-semibold" : ""
      }`}
    >
      <span className={`flex items-baseline gap-2 ${forte ? "text-foreground" : ""}`}>
        {cor && (
          <span
            aria-hidden
            className={`inline-block size-2.5 shrink-0 translate-y-px rounded-full ${COR[cor].fundo}`}
          />
        )}
        <span>
          {texto}
          {ajuda && (
            <span className="block text-xs font-normal text-muted-foreground">{ajuda}</span>
          )}
        </span>
      </span>
      <span className={`num shrink-0 tabular-nums ${cor ? COR[cor].texto : ""}`}>
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
              "id, receivable_id, label, due_date, gross_amount, client_amount, cost_reimbursement, paid_total, paid_client, paid_cost_reimbursement, balance, status",
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
                "installment_id, received_on, total_amount, cost_reimbursement, client_amount_received_by_firm, client_amount_received_direct",
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
  const direto = r.reduce((s, x) => s + num(x.client_amount_received_direct), 0);
  const peloEscritorio = r.reduce((s, x) => s + num(x.client_amount_received_by_firm), 0);
  const dela = direto + peloEscritorio;
  // Custas que o escritório adiantou e a empresa devolveu: não é honorário.
  const reembolsoEntrou = r.reduce((s, x) => s + num(x.cost_reimbursement), 0);
  const honorariosEntrou = Math.max(totalEntrou - dela - reembolsoEntrou, 0);

  // ---- repasses ----
  const repassado = t.filter((x) => x.status === "pago").reduce((s, x) => s + num(x.amount), 0);
  const faltaRepassar = Math.max(peloEscritorio - repassado, 0);
  // O que ela recebeu direto da empresa não passa por repasse: já está com ela.
  const jaComEla = repassado + direto;

  // ---- o que ainda vai entrar ----
  const emAberto = p.filter((x) => x.status !== "PAGA" && x.status !== "CANCELADA");
  const aEntrar = emAberto.reduce((s, x) => s + num(x.balance), 0);
  const aEntrarDela = emAberto.reduce(
    (s, x) => s + Math.max(num(x.client_amount) - num(x.paid_client), 0),
    0,
  );
  const aEntrarReembolso = emAberto.reduce(
    (s, x) => s + Math.max(num(x.cost_reimbursement) - num(x.paid_cost_reimbursement), 0),
    0,
  );
  const aEntrarHonorarios = Math.max(aEntrar - aEntrarDela - aEntrarReembolso, 0);

  // ---- o acordo inteiro ----
  // Somado a partir do que entrou e do que falta, e não do valor original:
  // assim a conta de cima fecha, centavo por centavo, com as de baixo.
  const totalAcordo = totalEntrou + aEntrar;
  const parteCliente = dela + aEntrarDela;
  const reembolso = reembolsoEntrou + aEntrarReembolso;
  const honorarios = honorariosEntrou + aEntrarHonorarios;
  const pct = (v: number) => (totalAcordo > 0.01 ? Math.round((v / totalAcordo) * 100) : 0);
  const quantosAcordos = new Set(
    p.filter((x) => x.status !== "CANCELADA").map((x) => x.receivable_id),
  ).size;
  const quantasParcelas = p.filter((x) => x.status !== "CANCELADA").length;

  // O total que ela ainda tem para receber: o que está parado aqui mais o que
  // ainda vai entrar e é dela.
  const totalDelaAinda = faltaRepassar + aEntrarDela;

  const ordenarPorData = <T,>(lista: T[], data: (x: T) => string | null) =>
    lista.slice().sort((a, b) => (data(a) ?? "9999").localeCompare(data(b) ?? "9999"));

  const semAcordo = p.length === 0 && t.length === 0;

  return (
    <Dialog open={!!clientId} onOpenChange={(v) => !v && onClose()}>
      {/* Uma tela só, para dar o print e mandar. Se a lista for longa demais,
          o conteúdo inteiro encolhe para caber — nada fica embaixo da dobra. */}
      <DialogContent className="flex max-h-[96vh] w-[97vw] max-w-[1200px] flex-col gap-3 overflow-hidden p-5 sm:max-w-[1200px]">
        <DialogHeader className="pr-8">
          <DialogTitle>Extrato de {nome}</DialogTitle>
          <DialogDescription>
            Posição em {dateBR(todayISO())}. Verde é a parte da cliente; azul, os honorários do
            escritório.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-8 text-center text-muted-foreground">Carregando…</p>}
        {error && (
          <p className="py-8 text-center text-destructive">
            Não foi possível montar o extrato: {friendlyError(error)}
          </p>
        )}
        {!isLoading && !error && semAcordo && (
          <p className="py-8 text-center text-muted-foreground">
            Nenhum acordo com valores cadastrado para esta cliente.
          </p>
        )}

        {!isLoading && !error && !semAcordo && (
          <CabeNaTela>
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                {/* ---------- 1. o acordo ---------- */}
                <Etapa
                  n={1}
                  titulo={quantosAcordos > 1 ? `Os ${quantosAcordos} acordos` : "O acordo"}
                  explica={`Quanto a empresa vai pagar no total${
                    quantasParcelas > 1 ? `, em ${quantasParcelas} parcelas,` : ""
                  } e como esse valor se divide.`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">
                      Valor total {quantosAcordos > 1 ? "dos acordos" : "do acordo"}
                    </span>
                    <span className="num text-2xl font-bold tabular-nums">
                      {money(totalAcordo)}
                    </span>
                  </div>
                  <Barra
                    partes={[
                      { valor: parteCliente, cor: "cliente" },
                      { valor: honorarios, cor: "escritorio" },
                      { valor: reembolso, cor: "reembolso" },
                    ]}
                  />
                  <Linha
                    texto={`Parte da cliente (${pct(parteCliente)}%)`}
                    valor={parteCliente}
                    cor="cliente"
                  />
                  <Linha
                    texto={`Honorários do escritório (${pct(honorarios)}%)`}
                    valor={honorarios}
                    cor="escritorio"
                  />
                  {reembolso > 0.01 && (
                    <Linha
                      texto="Devolução de despesas do processo"
                      ajuda="Custas que o escritório pagou e a empresa devolve"
                      valor={reembolso}
                      cor="reembolso"
                    />
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {direto > 0.01
                      ? "Quando a empresa paga ao escritório, ele separa os honorários e repassa a parte da cliente. Alguns pagamentos a empresa fez direto à cliente."
                      : "A empresa paga ao escritório. O escritório separa os honorários e repassa a parte da cliente."}
                  </p>
                </Etapa>

                {/* ---------- 2. onde está o dinheiro dela ---------- */}
                <Etapa
                  n={2}
                  titulo="Onde está a parte da cliente"
                  explica={`Dos ${money(parteCliente)} que são da cliente, quanto já chegou e quanto falta.`}
                >
                  <Barra
                    partes={[
                      { valor: jaComEla, cor: "cliente" },
                      { valor: faltaRepassar, cor: "escritorio" },
                      { valor: aEntrarDela, cor: null },
                    ]}
                  />
                  <Linha
                    texto="Já está com a cliente"
                    ajuda={
                      direto > 0.01
                        ? "Repassado pelo escritório ou pago direto pela empresa"
                        : "Já repassado pelo escritório"
                    }
                    valor={jaComEla}
                    cor="cliente"
                  />
                  <Linha
                    texto="Com o escritório, aguardando repasse"
                    ajuda="A empresa já pagou; falta o escritório repassar"
                    valor={faltaRepassar}
                    cor="escritorio"
                  />
                  <Linha
                    texto="Ainda vai ser pago pela empresa"
                    ajuda="Parcelas que ainda não venceram ou não foram pagas"
                    valor={aEntrarDela}
                  />
                  <div className="mt-2 flex items-baseline justify-between gap-4 rounded-md border-2 border-success/40 bg-success/10 px-3 py-2">
                    <span>
                      <span className="block font-display font-semibold">
                        A cliente ainda tem a receber
                      </span>
                      <span className="text-xs text-muted-foreground">
                        O que está com o escritório + o que a empresa ainda vai pagar
                      </span>
                    </span>
                    <span className="num text-2xl font-bold tabular-nums text-success">
                      {money(totalDelaAinda)}
                    </span>
                  </div>
                </Etapa>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {/* ---------- 3. o que a empresa já pagou ---------- */}
                <Etapa
                  n={3}
                  titulo="O que a empresa já pagou"
                  explica="Cada pagamento recebido, pela data em que entrou."
                >
                  {r.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">
                      Nenhum pagamento recebido até agora.
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
                    <Linha texto="Total já pago" valor={totalEntrou} forte />
                    <Linha texto="Parte da cliente" valor={dela} cor="cliente" />
                    <Linha
                      texto="Honorários do escritório"
                      valor={honorariosEntrou}
                      cor="escritorio"
                    />
                    {reembolsoEntrou > 0.01 && (
                      <Linha
                        texto="Devolução de despesas"
                        valor={reembolsoEntrou}
                        cor="reembolso"
                      />
                    )}
                  </div>
                </Etapa>

                {/* ---------- 4. o que ainda falta pagar ---------- */}
                <Etapa
                  n={4}
                  titulo="O que a empresa ainda vai pagar"
                  explica="As próximas parcelas, pela data de vencimento."
                >
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
                        <Linha texto="Total a pagar" valor={aEntrar} forte />
                        <Linha texto="Parte da cliente" valor={aEntrarDela} cor="cliente" />
                        <Linha
                          texto="Honorários do escritório"
                          valor={aEntrarHonorarios}
                          cor="escritorio"
                        />
                        {aEntrarReembolso > 0.01 && (
                          <Linha
                            texto="Devolução de despesas"
                            valor={aEntrarReembolso}
                            cor="reembolso"
                          />
                        )}
                      </div>
                    </>
                  )}
                </Etapa>

                {/* ---------- 5. os repasses ---------- */}
                <Etapa
                  n={5}
                  titulo="O que o escritório já repassou"
                  explica="Cada valor transferido à cliente, pela data do pagamento."
                >
                  {t.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">
                      Nenhum repasse feito até agora.
                    </p>
                  ) : (
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
                  )}
                  <div className="mt-1">
                    <Linha texto="Total repassado" valor={repassado} forte cor="cliente" />
                    {direto > 0.01 && (
                      <Linha
                        texto="Pago direto pela empresa à cliente"
                        valor={direto}
                        cor="cliente"
                      />
                    )}
                  </div>
                </Etapa>
              </div>

              <p className="text-xs text-muted-foreground">
                Valores conferidos em {dateBR(todayISO())}. As parcelas futuras dependem do
                pagamento pela empresa.
              </p>
            </div>
          </CabeNaTela>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Um passo do extrato: número, título e uma frase dizendo o que ele mostra.
 * A numeração dá a ordem de leitura para quem não está acostumada com conta.
 */
function Etapa({
  n,
  titulo,
  explica,
  children,
}: {
  n: number;
  titulo: string;
  explica: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-start gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
        >
          {n}
        </span>
        <div>
          <h3 className="font-display text-sm font-semibold leading-6">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{explica}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Uma barra dividida na proporção de cada parte. Mostra de relance o que os
 * números dizem: quanto é dela e quanto é do escritório.
 */
function Barra({ partes }: { partes: { valor: number; cor: Cor | null }[] }) {
  const total = partes.reduce((s, x) => s + Math.max(x.valor, 0), 0);
  if (total <= 0.01) return null;
  return (
    <div className="my-2 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
      {partes
        .filter((x) => x.valor > 0.01)
        .map((x, i) => (
          <div
            key={i}
            className={x.cor ? COR[x.cor].fundo : "bg-muted-foreground/25"}
            style={{ width: `${(x.valor / total) * 100}%` }}
          />
        ))}
    </div>
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
