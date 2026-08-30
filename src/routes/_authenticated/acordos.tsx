import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag, ReceivableStatusTag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  money,
  num,
  todayISO,
  addMonthsISO,
  RECEIVABLE_TYPE_LABEL,
  RECEIVABLE_STATUS_LABEL,
  FLOW_LABEL,
} from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { dropUndefined } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/acordos")({
  head: () => ({
    meta: [
      { title: "Acordos e Sentenças | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Acordos, sentenças e execuções com divisão entre honorários do escritório, sucumbência, custos e valor do cliente.",
      },
      { property: "og:title", content: "Acordos e sentenças" },
      {
        property: "og:description",
        content: "Cadastro de recebíveis jurídicos com cronograma de parcelas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AcordosPage,
});

type Step = 1 | 2 | 3 | 4;

type DistributionMode =
  | "proporcional"
  | "escritorio_primeiro"
  | "meio_a_meio"
  | "manual";

/**
 * Uma parcela sendo editada no acordo pronto. Os campos de dinheiro e data são
 * texto porque vêm de inputs; `paid` e `canceled` não se editam — servem para
 * decidir o que pode ser mexido e o que precisa de autorização.
 */
type EditParcela = {
  id: string;
  label: string;
  due_date: string;
  gross_amount: string;
  /** Honorário + sucumbência juntos, que é como a tabela mostra. */
  firm_amount: string;
  client_amount: string;
  cost_reimbursement: string;
  /**
   * Como a parte do escritório estava dividida antes da edição. É por ela que
   * o valor digitado volta a se dividir entre honorário e sucumbência na hora
   * de salvar — uma parcela de sucumbência continua sendo sucumbência.
   */
  origFee: number;
  origSuccess: number;
  numero: number | null;
  stream: string | null;
  paid: number;
  canceled: boolean;
};

/** Divide a parte do escritório de volta entre honorário e sucumbência. */
function dividirParteDoEscritorio(parcela: EditParcela) {
  const firm = num(Number(parcela.firm_amount));
  const soma = round2(parcela.origFee + parcela.origSuccess);
  if (soma > 0.01) {
    const fee = round2((firm * parcela.origFee) / soma);
    return { fee_amount: fee, success_fee_amount: round2(firm - fee) };
  }
  // Parcela que ainda não tinha valor do escritório: vale a origem dela.
  return parcela.stream === "sucumbencia"
    ? { fee_amount: 0, success_fee_amount: firm }
    : { fee_amount: firm, success_fee_amount: 0 };
}

type ScheduleRow = {
  label: string;
  number: number;
  /**
   * Quem paga a parcela:
   * - `principal`   a cliente
   * - `empresa`     honorário que a parte contrária deposita direto aqui
   * - `sucumbencia` sucumbência, também paga pela parte contrária
   */
  stream: "principal" | "empresa" | "sucumbencia";
  due_date: string;
  gross_amount: number;
  firm_amount: number;
  client_amount: number;
  cost_reimbursement: number;
};

const cents = (value: number) => Math.max(0, Math.round(num(value) * 100));
const fromCents = (value: number) => value / 100;

/**
 * Tolerância de centavos.
 *
 * Dividir R$ 10.000,00 em 3 parcelas dá 3.333,33 + 3.333,33 + 3.333,34, e
 * repartir cada uma entre escritório e cliente por percentual gera mais
 * arredondamento ainda. Exigir fechamento exato ao centavo travava o cadastro
 * por uma diferença que ninguém consegue resolver na mão.
 *
 * O limite cresce com o número de parcelas porque cada uma pode contribuir com
 * um centavo de arredondamento.
 */
const TOLERANCIA_LINHA = 0.05;
const toleranciaTotal = (linhas: number) => Math.max(0.05, linhas * 0.01);

/**
 * Encosta os centavos que sobraram na parte do escritório, para o que é
 * gravado no banco fechar exato. Só mexe no que estiver dentro da tolerância —
 * diferença grande continua sendo erro, e o cadastro não passa.
 *
 * O escritório é quem absorve a sobra porque é a única parte que não vira
 * obrigação de repasse: um centavo a mais ou a menos na conta da cliente
 * viraria uma pendência de repasse que nunca fecha.
 */
function ajustarCentavos(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.map((row) => {
    const parts = row.firm_amount + row.client_amount + row.cost_reimbursement;
    const diff = round2(row.gross_amount - parts);
    if (diff === 0 || Math.abs(diff) > TOLERANCIA_LINHA) return row;

    // Some ao escritório, a menos que isso o deixe negativo — aí sobra para a
    // cliente, que é quem tem valor naquela linha.
    if (row.firm_amount + diff >= 0) {
      return { ...row, firm_amount: round2(row.firm_amount + diff) };
    }
    if (row.client_amount + diff >= 0) {
      return { ...row, client_amount: round2(row.client_amount + diff) };
    }
    return { ...row, gross_amount: round2(parts) };
  });
}

const round2 = (value: number) => Math.round(num(value) * 100) / 100;

/**
 * Bloco de parcelas que é inteiro do escritório, com datas próprias.
 *
 * Serve para os dois casos em que quem paga não é a cliente: a sucumbência e o
 * honorário que a empresa deposita direto na nossa conta. Divide o valor em
 * parcelas iguais e encosta o resto dos centavos na última.
 */
function parcelasDoEscritorio(opts: {
  total: number;
  count: number;
  firstDue: string;
  periodicity: number;
  label: string;
  stream: ScheduleRow["stream"];
  startNumber: number;
}): ScheduleRow[] {
  const totalCents = cents(opts.total);
  if (totalCents <= 0) return [];
  const count = Math.max(1, Math.floor(num(opts.count)));
  const period = Math.max(1, Math.floor(num(opts.periodicity)));
  const base = Math.floor(totalCents / count);
  const rows: ScheduleRow[] = [];
  let allocated = 0;
  for (let index = 0; index < count; index += 1) {
    const value = index === count - 1 ? totalCents - allocated : base;
    allocated += value;
    rows.push({
      label: count > 1 ? `${opts.label} ${index + 1}` : opts.label,
      number: opts.startNumber + index,
      stream: opts.stream,
      due_date: addMonthsISO(opts.firstDue, index * period),
      gross_amount: fromCents(value),
      firm_amount: fromCents(value),
      client_amount: 0,
      cost_reimbursement: 0,
    });
  }
  return rows;
}

/** "faltam R$ 0,02" / "sobram R$ 0,05" — o que o usuário precisa saber. */
function faltaOuSobra(atual: number, alvo: number): string {
  const diff = round2(alvo - atual);
  return diff > 0 ? `faltam ${money(diff)}` : `sobram ${money(-diff)}`;
}

function allocateByCapacity(
  capacities: number[],
  totals: { firm: number; client: number; costs: number },
  mode: DistributionMode,
) {
  let remaining = {
    firm: cents(totals.firm),
    client: cents(totals.client),
    costs: cents(totals.costs),
  };

  return capacities.map((capacityValue, index) => {
    const capacity = cents(capacityValue);
    const totalRemaining = remaining.firm + remaining.client + remaining.costs;
    let allocation = { firm: 0, client: 0, costs: 0 };

    if (index === capacities.length - 1 || capacity >= totalRemaining) {
      allocation = { ...remaining };
    } else if (mode === "meio_a_meio") {
      // Metade da parcela para o escritório (honorários e custas) e metade
      // para a cliente, até o escritório completar o que lhe cabe. A partir
      // daí a parcela inteira vai para a cliente — e, se a cliente terminar
      // antes, o que sobra fecha o lado do escritório.
      const metade = Math.floor(capacity / 2);
      let ladoEscritorio = Math.min(metade, remaining.firm + remaining.costs);
      allocation.firm = Math.min(ladoEscritorio, remaining.firm);
      ladoEscritorio -= allocation.firm;
      allocation.costs = Math.min(ladoEscritorio, remaining.costs);

      let sobra = capacity - allocation.firm - allocation.costs;
      allocation.client = Math.min(sobra, remaining.client);
      sobra -= allocation.client;

      if (sobra > 0) {
        const maisFirm = Math.min(sobra, remaining.firm - allocation.firm);
        allocation.firm += maisFirm;
        sobra -= maisFirm;
        allocation.costs += Math.min(sobra, remaining.costs - allocation.costs);
      }
    } else if (mode === "escritorio_primeiro") {
      let available = capacity;
      allocation.firm = Math.min(available, remaining.firm);
      available -= allocation.firm;
      allocation.costs = Math.min(available, remaining.costs);
      available -= allocation.costs;
      allocation.client = Math.min(available, remaining.client);
    } else {
      const keys = ["firm", "client", "costs"] as const;
      const shares = keys.map((key) => {
        const raw = totalRemaining ? (capacity * remaining[key]) / totalRemaining : 0;
        return { key, value: Math.floor(raw), fraction: raw - Math.floor(raw) };
      });
      let missing = capacity - shares.reduce((sum, share) => sum + share.value, 0);
      shares.sort((a, b) => b.fraction - a.fraction);
      for (const share of shares) {
        if (missing <= 0) break;
        if (share.value < remaining[share.key]) {
          share.value += 1;
          missing -= 1;
        }
      }
      allocation = Object.fromEntries(
        shares.map((share) => [share.key, share.value]),
      ) as typeof allocation;
    }

    remaining = {
      firm: remaining.firm - allocation.firm,
      client: remaining.client - allocation.client,
      costs: remaining.costs - allocation.costs,
    };

    return {
      gross_amount: fromCents(capacity),
      firm_amount: fromCents(allocation.firm),
      client_amount: fromCents(allocation.client),
      cost_reimbursement: fromCents(allocation.costs),
    };
  });
}

function splitFirmComponents(rows: ScheduleRow[], successTotal: number) {
  const firmCents = rows.map((row) => cents(row.firm_amount));
  const feeCents = rows.map(() => 0);
  const successCents = rows.map(() => 0);
  let successRemaining = cents(successTotal);

  // Quem paga a sucumbência é a parte contrária, então ela preenche primeiro
  // as parcelas que a parte contrária paga: a trilha da sucumbência e depois a
  // do honorário que a empresa deposita direto. Sem isso, um acordo em que a
  // empresa paga justamente o valor da sucumbência gravava a parcela dela como
  // honorário contratual e jogava a sucumbência na conta da cliente.
  for (const stream of ["sucumbencia", "empresa"] as const) {
    rows.forEach((row, index) => {
      if (row.stream !== stream) return;
      const rowFirm = firmCents[index] ?? 0;
      const success = Math.min(rowFirm, successRemaining);
      successRemaining -= success;
      successCents[index] = success;
      feeCents[index] = rowFirm - success;
    });
  }

  // Nas parcelas da cliente o honorário contratual continua vindo primeiro, e
  // a sucumbência que sobrou encosta nas últimas — como sempre foi.
  const principalFirm = rows.reduce(
    (total, row, index) => (row.stream === "principal" ? total + (firmCents[index] ?? 0) : total),
    0,
  );
  let feeRemaining = Math.max(principalFirm - successRemaining, 0);
  rows.forEach((row, index) => {
    if (row.stream !== "principal") return;
    const rowFirm = firmCents[index] ?? 0;
    const fee = Math.min(rowFirm, feeRemaining);
    feeRemaining -= fee;
    const success = Math.min(rowFirm - fee, successRemaining);
    successRemaining -= success;
    feeCents[index] = fee;
    successCents[index] = success;
  });

  return rows.map((_, index) => ({
    fee_amount: fromCents(feeCents[index] ?? 0),
    success_fee_amount: fromCents(successCents[index] ?? 0),
  }));
}

const EMPTY = {
  client_id: "",
  case_id: "",
  type: "acordo",
  status: "confirmado",
  description: "",
  gross_amount: "",
  fee_percent: "",
  fee_fixed_amount: "",
  // Fatia do valor bruto que a cliente já sacou sozinha (FGTS liberado na conta
  // vinculada, alvará). Abate do que ainda passa pela conta do escritório.
  fee_base_extra_amount: "",
  success_fee_amount: "",
  cost_reimbursement: "",
  expected_firm_amount: "",
  expected_client_amount: "",
  agreement_date: todayISO(),
  flow: "escritorio_recebe_total",
  is_estimated: false,
  override_reason: "",
  parcels: "1",
  first_due: todayISO(),
  periodicity: "1",
  // Sucumbência: sempre com cronograma próprio, porque a parte contrária paga
  // direto ao escritório e quase nunca nas mesmas datas do acordo da cliente.
  success_parcels: "1",
  success_first_due: todayISO(),
  success_periodicity: "1",
  // Recebimento dividido: quanto do honorário a empresa deposita direto na
  // conta do escritório. O resto o cronograma cobra da cliente.
  firm_direct_amount: "",
  firm_direct_parcels: "1",
  firm_direct_first_due: todayISO(),
  firm_direct_periodicity: "1",
  has_entry: false,
  entry_amount: "",
  entry_due: todayISO(),
  distribution_mode: "proporcional" as DistributionMode,
  no_schedule: false,
  notes: "",
};

function AcordosPage() {
  const { profile, canWrite, can, isMainAdmin } = useAuth();
  const canCancel = can("acordos", "cancel_or_reverse");
  // Editar acordo é permissão à parte: nasce só para o Administrador e pode
  // ser liberada por perfil na tela Usuários e Perfis de Acesso.
  const canEdit = can("acordos", "edit");
  // Excluir acordo apaga junto parcelas, recebimentos e repasses. Permissão
  // própria, ligada só para o Administrador e liberável por perfil.
  const canDelete = can("acordos", "delete");
  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);
  const [editForm, setEditForm] = useState({
    type: "acordo",
    status: "confirmado",
    description: "",
    notes: "",
    case_id: "",
    agreement_date: todayISO(),
    gross_amount: "",
    success_fee_amount: "",
    cost_reimbursement: "",
    expected_firm_amount: "",
    expected_client_amount: "",
    fee_percent: "",
    fee_fixed_amount: "",
    fee_base_extra_amount: "",
    firm_direct_amount: "",
    flow: "escritorio_recebe_total",
    is_estimated: false,
  });
  // O que já foi digitado por cima das parcelas, por id. As linhas em si vêm
  // sempre do banco: guardar uma cópia delas em estado fazia a tabela nascer
  // vazia ao reabrir o mesmo acordo, porque o cache devolve o mesmo objeto e o
  // efeito que preenchia a cópia não rodava de novo.
  const [parcelaEdits, setParcelaEdits] = useState<Record<string, Partial<EditParcela>>>({});
  // Parcela já recebida é histórico: só se mexe nela com autorização expressa,
  // e o motivo fica registrado na auditoria.
  const [allowPaidEdit, setAllowPaidEdit] = useState(false);
  const [paidEditReason, setPaidEditReason] = useState("");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(EMPTY);
  const [editedSchedule, setEditedSchedule] = useState<ScheduleRow[] | null>(null);
  // Campos que mudam o total do acordo. Ao alterar qualquer um deles, o
  // cronograma editado à mão deixa de valer — voltamos para a sugestão
  // recalculada, senão as parcelas continuariam somando o total antigo.
  const TOTALS_FIELDS = [
    "type",
    "gross_amount",
    "fee_percent",
    "fee_fixed_amount",
    "fee_base_extra_amount",
    "success_fee_amount",
    "cost_reimbursement",
    "expected_firm_amount",
    "expected_client_amount",
    "has_entry",
    "entry_amount",
    "entry_due",
    "parcels",
    "first_due",
    "periodicity",
    "distribution_mode",
    "no_schedule",
    "success_parcels",
    "success_first_due",
    "success_periodicity",
    "flow",
    "firm_direct_amount",
    "firm_direct_parcels",
    "firm_direct_first_due",
    "firm_direct_periodicity",
  ] as const;

  function updateForm(patch: Partial<typeof EMPTY>) {
    setForm((current) => ({ ...current, ...patch }));
    if (Object.keys(patch).some((k) => (TOTALS_FIELDS as readonly string[]).includes(k))) {
      setEditedSchedule(null);
    }
  }

  const [sortBy, setSortBy] = useState("recentes");
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    paid: number;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["acordos"],
    queryFn: async () => {
      const [recv, clients, cases, inst] = await Promise.all([
        supabase
          .from("legal_receivables")
          .select("*, clients(name), cases(case_number)")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("id, name").is("deleted_at", null).order("name"),
        supabase
          .from("cases")
          .select("id, client_id, case_number, opposing_party")
          .is("deleted_at", null),
        supabase.from("v_installments").select("receivable_id, gross_amount, paid_total"),
      ]);
      if (recv.error) throw recv.error;
      return {
        receivables: recv.data ?? [],
        clients: clients.data ?? [],
        cases: cases.data ?? [],
        installments: (inst.data ?? []) as unknown as {
          receivable_id: string;
          gross_amount: number;
          paid_total: number;
        }[],
      };
    },
  });

  const gross = num(Number(form.gross_amount));
  // Honorário de serviço: cobrança que não depende do valor de nenhuma ação
  // (consultoria, contrato, acompanhamento). O valor informado é inteiro do
  // escritório — a cliente não recebe nada dele, então não há rateio, não há
  // sucumbência e não há repasse. É o oposto do acordo, onde o valor bruto é
  // da cliente e o escritório fica com um percentual.
  const isServiceFee = form.type === "honorarios";
  // Fatia do valor bruto que a cliente já sacou sozinha — FGTS liberado na
  // conta vinculada, alvará sacado por ela. Os honorários continuam incidindo
  // sobre o bruto inteiro; o que este valor faz é abater do que ainda passa
  // pela conta do escritório, então ele não entra no cronograma, no caixa nem
  // no repasse.
  //
  // No banco a coluna se chama `fee_base_extra_amount`, nome herdado da
  // primeira versão desta ideia, em que o FGTS somava na base do percentual em
  // vez de abater do bruto.
  const recebidoDireto = isServiceFee ? 0 : num(Number(form.fee_base_extra_amount));
  const feePercentValue = form.fee_percent ? num(Number(form.fee_percent)) : 0;
  const feeFromPercent = form.fee_percent ? (gross * feePercentValue) / 100 : 0;
  const contractualFee = isServiceFee
    ? gross
    : form.fee_percent
      ? feeFromPercent
      : num(Number(form.fee_fixed_amount));
  const successFee = isServiceFee ? 0 : num(Number(form.success_fee_amount));
  const costs = isServiceFee ? 0 : num(Number(form.cost_reimbursement));
  // A sucumbência é sempre por fora e nunca participa da divisão do acordo: o
  // valor bruto é da cliente, e o percentual de honorários incide só sobre ele.
  // Ela entra apenas no total que o escritório tem a receber, com cronograma
  // próprio.
  const suggestedFirm = contractualFee + successFee;
  const suggestedClient = Math.max(gross - contractualFee - costs, 0);
  // A composição do acordo: o valor bruto se divide entre escritório, cliente e
  // reembolso, e a sucumbência entra por fora.
  const expectedGrossTotal = round2(suggestedFirm + suggestedClient + costs);
  const firm = form.expected_firm_amount ? num(Number(form.expected_firm_amount)) : suggestedFirm;
  const client = isServiceFee
    ? 0
    : form.expected_client_amount
      ? num(Number(form.expected_client_amount))
      : suggestedClient;
  const overridden =
    Math.abs(firm - suggestedFirm) > 0.01 || Math.abs(client - suggestedClient) > 0.01;

  // Quando a cliente recebe o dinheiro direto da empresa, o que ela guarda para
  // si nunca passa pelo escritório: as "parcelas a receber" são só o que ela
  // vai repassar para nós. Antes o cronograma cobrava o valor cheio do acordo,
  // e a lista de parcelas ficava com um valor que ninguém nunca ia receber.
  const clienteRecebeDireto = form.flow === "cliente_recebe_direto";
  // Recebimento dividido: a empresa deposita parte do honorário direto aqui e
  // manda o resto do acordo para a conta da cliente. O dinheiro dela também
  // não passa por nós — ela só nos paga o honorário que faltou.
  const recebimentoDividido = form.flow === "recebimento_dividido";
  const parteDaClienteForaDoCronograma = clienteRecebeDireto || recebimentoDividido;
  // O que a cliente já sacou (FGTS, alvará) abate do que ainda passa pela nossa
  // conta: o cronograma cobra só o que sobrou dela.
  const clientNoCronograma = parteDaClienteForaDoCronograma
    ? 0
    : Math.max(round2(client - recebidoDireto), 0);

  // A sucumbência sempre tem cronograma próprio: ela não participa da divisão
  // do acordo, serve para saber quanto ainda entra e em que datas.
  const successSeparated = successFee > 0.01 && !isServiceFee;
  // Com as trilhas separadas, o cronograma do acordo carrega só honorários
  // contratuais + parte da cliente; a sucumbência vira um bloco à parte.
  const mainFirm = successSeparated ? Math.max(firm - successFee, 0) : firm;
  // O que a empresa paga direto sai de dentro do honorário — não é dinheiro a
  // mais. Trava no teto para um valor digitado errado não gerar cronograma
  // negativo enquanto a pessoa ainda está digitando.
  const firmDirect = recebimentoDividido
    ? Math.min(num(Number(form.firm_direct_amount)), mainFirm)
    : 0;
  // Sobra para a trilha da cliente.
  const firmNoPrincipal = round2(mainFirm - firmDirect);

  const generatedSchedule = useMemo<ScheduleRow[]>(() => {
    if (form.no_schedule) return [];
    // Trilha da cliente: o honorário que sobrou depois do que a empresa paga
    // direto, mais a parte dela que passa pela nossa conta.
    const scheduleTotalCents = cents(firmNoPrincipal + clientNoCronograma + costs);

    const entryRequested = form.has_entry ? cents(Number(form.entry_amount)) : 0;
    const entryCents = Math.min(entryRequested, scheduleTotalCents);
    const remainingCents = scheduleTotalCents - entryCents;
    const remainingCount = remainingCents ? Math.max(1, Math.floor(num(Number(form.parcels)))) : 0;
    const period = Math.max(1, Math.floor(num(Number(form.periodicity))));
    const capacities: number[] = [];
    const labels: string[] = [];
    const dueDates: string[] = [];

    if (entryCents > 0) {
      capacities.push(fromCents(entryCents));
      labels.push("Entrada");
      dueDates.push(form.entry_due);
    }

    if (remainingCount > 0) {
      const base = Math.floor(remainingCents / remainingCount);
      let allocated = 0;
      for (let index = 0; index < remainingCount; index += 1) {
        const value = index === remainingCount - 1 ? remainingCents - allocated : base;
        allocated += value;
        capacities.push(fromCents(value));
        labels.push(`Parcela ${index + 1}`);
        dueDates.push(addMonthsISO(form.first_due, index * period));
      }
    }

    const allocations =
      scheduleTotalCents > 0
        ? allocateByCapacity(
            capacities,
            { firm: firmNoPrincipal, client: clientNoCronograma, costs },
            form.distribution_mode,
          )
        : [];

    const principal: ScheduleRow[] = allocations.map((allocation, index) => ({
      ...allocation,
      label: labels[index] ?? `Parcela ${index + 1}`,
      number: index + 1,
      stream: "principal" as const,
      due_date: dueDates[index] ?? form.first_due,
    }));

    // Blocos de quem não é a cliente. Cada um tem valor e datas próprios, e é
    // inteiro do escritório.
    const empresa = parcelasDoEscritorio({
      total: firmDirect,
      count: Number(form.firm_direct_parcels),
      firstDue: form.firm_direct_first_due,
      periodicity: Number(form.firm_direct_periodicity),
      // Rótulo neutro de propósito: dependendo da sucumbência, essa parcela
      // pode ser gravada como honorário contratual ou como sucumbência.
      label: "Empresa",
      stream: "empresa",
      startNumber: principal.length + 1,
    });

    const sucumbencia = successSeparated
      ? parcelasDoEscritorio({
          total: successFee,
          count: Number(form.success_parcels),
          firstDue: form.success_first_due,
          periodicity: Number(form.success_periodicity),
          label: "Sucumbência",
          stream: "sucumbencia",
          startNumber: principal.length + empresa.length + 1,
        })
      : [];

    return [...principal, ...empresa, ...sucumbencia];
  }, [form, firmDirect, firmNoPrincipal, clientNoCronograma, costs, successSeparated, successFee]);

  const schedule = editedSchedule ?? generatedSchedule;

  const scheduleTotals = useMemo(
    () =>
      schedule.reduce(
        (total, row) => ({
          gross: total.gross + num(row.gross_amount),
          firm: total.firm + num(row.firm_amount),
          client: total.client + num(row.client_amount),
          costs: total.costs + num(row.cost_reimbursement),
        }),
        { gross: 0, firm: 0, client: 0, costs: 0 },
      ),
    [schedule],
  );

  // Quanto de centavo ainda está solto no cronograma — é o que o ajuste
  // automático vai encostar no escritório na hora de gravar.
  const centavosPendentes = useMemo(() => {
    if (form.no_schedule) return 0;
    return schedule.reduce((maior, row) => {
      const parts = row.firm_amount + row.client_amount + row.cost_reimbursement;
      return Math.max(maior, Math.abs(round2(row.gross_amount - parts)));
    }, 0);
  }, [form.no_schedule, schedule]);

  const scheduleErrors = useMemo(() => {
    if (form.no_schedule) return [];
    const errors: string[] = [];
    // Duas contas diferentes, e confundir as duas já deu erro falso antes: o
    // cronograma cobra só o que ainda passa pela nossa conta, enquanto a
    // composição do acordo é o bolo inteiro, passe ele por onde passar.
    const totalNoCronograma = firm + clientNoCronograma + costs;
    const composicaoTotal = round2(firm + client + costs);
    const entry = num(Number(form.entry_amount));
    if (form.has_entry && entry <= 0) errors.push("Informe um valor de entrada maior que zero.");
    if (form.has_entry && entry - totalNoCronograma > 0.01)
      errors.push("A entrada não pode ser maior que o total a receber.");
    if (recebidoDireto - gross > 0.01)
      errors.push(
        `A cliente não pode ter recebido direto mais do que o valor bruto ` +
          `(${money(gross)}) — o FGTS já está dentro dele.`,
      );
    if (recebimentoDividido && num(Number(form.firm_direct_amount)) - mainFirm > 0.01)
      errors.push(
        `A empresa não pode pagar direto mais do que o escritório tem a receber ` +
          `(${money(mainFirm)}) — o que passar disso não sai de lugar nenhum.`,
      );
    if (!schedule.length) errors.push("Crie ao menos uma parcela para o cronograma.");

    const tolTotal = toleranciaTotal(schedule.length);

    schedule.forEach((row, index) => {
      const nome = row.label || `Parcela ${index + 1}`;
      const parts = row.firm_amount + row.client_amount + row.cost_reimbursement;
      if (!row.due_date) errors.push(`${nome}: informe a data.`);
      if (row.gross_amount <= 0) errors.push(`${nome}: informe um valor maior que zero.`);
      if (Math.abs(row.gross_amount - parts) > TOLERANCIA_LINHA)
        errors.push(
          `${nome}: escritório + cliente + reembolso somam ${money(parts)}, ` +
            `mas a parcela é de ${money(row.gross_amount)} — ${faltaOuSobra(parts, row.gross_amount)}.`,
        );
    });

    if (Math.abs(scheduleTotals.gross - totalNoCronograma) > tolTotal)
      errors.push(
        `As parcelas somam ${money(scheduleTotals.gross)} e o total a receber é ` +
          `${money(totalNoCronograma)} — ` +
          `${faltaOuSobra(scheduleTotals.gross, totalNoCronograma)} no cronograma.`,
      );
    if (Math.abs(scheduleTotals.firm - firm) > tolTotal)
      errors.push(
        `A coluna Escritório soma ${money(scheduleTotals.firm)} e o esperado é ${money(firm)} — ` +
          `${faltaOuSobra(scheduleTotals.firm, firm)}.`,
      );
    if (Math.abs(scheduleTotals.client - clientNoCronograma) > tolTotal)
      errors.push(
        `A coluna Cliente soma ${money(scheduleTotals.client)} e o esperado é ` +
          `${money(clientNoCronograma)} — ${faltaOuSobra(scheduleTotals.client, clientNoCronograma)}.`,
      );
    if (Math.abs(scheduleTotals.costs - costs) > tolTotal)
      errors.push(
        `A coluna Reembolso soma ${money(scheduleTotals.costs)} e o esperado é ${money(costs)} — ` +
          `${faltaOuSobra(scheduleTotals.costs, costs)}.`,
      );
    // Conferência da composição, não do cronograma: escritório + cliente +
    // reembolso têm de fechar com o valor bruto + sucumbência, independentemente
    // de o dinheiro passar ou não pela nossa conta.
    if (gross > 0 && Math.abs(composicaoTotal - expectedGrossTotal) > tolTotal)
      errors.push(
        `O total distribuído (${money(composicaoTotal)}) não fecha com o valor bruto + ` +
          `sucumbência (${money(expectedGrossTotal)}) — ` +
          `${faltaOuSobra(composicaoTotal, expectedGrossTotal)} na divisão entre escritório e cliente.`,
      );
    return [...new Set(errors)];
  }, [
    client,
    clientNoCronograma,
    costs,
    firm,
    gross,
    mainFirm,
    recebidoDireto,
    recebimentoDividido,
    expectedGrossTotal,
    form.firm_direct_amount,
    form.entry_amount,
    form.has_entry,
    form.no_schedule,
    schedule,
    scheduleTotals,
  ]);

  /**
   * Preenche sozinha a coluna que sobrou.
   *
   * Digitado o total da parcela, ao informar a parte do escritório a parte da
   * cliente já aparece com o que falta — e vice-versa. É sugestão: continua
   * dando para digitar por cima, e o campo que a pessoa acabou de mexer nunca
   * é alterado.
   *
   * Quando não existe parte da cliente no cronograma (honorário de serviço, ou
   * a cliente recebendo direto da empresa) tudo o que sobra é do escritório.
   */
  function completarLinha(row: ScheduleRow, patch: Partial<ScheduleRow>): ScheduleRow {
    const atualizada = { ...row, ...patch };
    const mexeuEmDinheiro =
      "gross_amount" in patch || "firm_amount" in patch || "client_amount" in patch ||
      "cost_reimbursement" in patch;
    if (!mexeuEmDinheiro) return atualizada;

    // Sucumbência e honorário pago pela empresa vão direto para o escritório:
    // não há o que repartir com a cliente.
    const semParteDaCliente = row.stream !== "principal" || clientNoCronograma <= 0.01;
    const sobra = (menos: number) => Math.max(round2(atualizada.gross_amount - menos), 0);

    if (semParteDaCliente) {
      return {
        ...atualizada,
        client_amount: 0,
        firm_amount: sobra(atualizada.cost_reimbursement),
      };
    }

    // Mexeu na parte da cliente → o escritório recebe o resto.
    if ("client_amount" in patch) {
      return {
        ...atualizada,
        firm_amount: sobra(atualizada.client_amount + atualizada.cost_reimbursement),
      };
    }

    // Mexeu no total, no escritório ou no reembolso → a cliente recebe o resto.
    return {
      ...atualizada,
      client_amount: sobra(atualizada.firm_amount + atualizada.cost_reimbursement),
    };
  }

  function updateScheduleRow(index: number, patch: Partial<ScheduleRow>) {
    setEditedSchedule((current) =>
      (current ?? generatedSchedule).map((row, rowIndex) =>
        rowIndex === index ? completarLinha(row, patch) : row,
      ),
    );
  }

  /** Lista ordenada conforme o seletor acima da tabela. */
  const sortedReceivables = useMemo(() => {
    const rows = [...(data?.receivables ?? [])];
    const nome = (r: (typeof rows)[number]) =>
      ((r.clients as { name: string } | null)?.name ?? "").toLocaleLowerCase("pt-BR");
    // O total a receber é o que a tabela mostra, então é por ele que se ordena
    // "por valor" — e não pelo bruto, que pode não incluir a sucumbência.
    const total = (r: (typeof rows)[number]) =>
      num(r.expected_firm_amount) + num(r.expected_client_amount) + num(r.cost_reimbursement);

    switch (sortBy) {
      case "cliente":
        return rows.sort((a, b) => nome(a).localeCompare(nome(b), "pt-BR"));
      case "cliente_desc":
        return rows.sort((a, b) => nome(b).localeCompare(nome(a), "pt-BR"));
      case "data":
        return rows.sort((a, b) =>
          String(a.agreement_date ?? "").localeCompare(String(b.agreement_date ?? "")),
        );
      case "data_desc":
        return rows.sort((a, b) =>
          String(b.agreement_date ?? "").localeCompare(String(a.agreement_date ?? "")),
        );
      case "valor":
        return rows.sort((a, b) => total(b) - total(a));
      case "valor_asc":
        return rows.sort((a, b) => total(a) - total(b));
      default:
        return rows;
    }
  }, [data, sortBy]);

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.client_id) throw new Error("Selecione o cliente");
      if (overridden && !form.override_reason.trim())
        throw new Error("Justifique a alteração manual dos valores calculados");
      if (scheduleErrors.length) throw new Error(scheduleErrors[0]);

      // Passou na validação com alguns centavos de diferença: encosta a sobra
      // no escritório e usa a soma real das parcelas como valor esperado do
      // acordo. Assim o que fica gravado fecha exato, e nenhuma parcela nasce
      // com uma pendência de um centavo que nunca vai ser paga.
      const gravar = ajustarCentavos(schedule);
      const totalGravado = gravar.reduce(
        (t, row) => ({
          firm: round2(t.firm + row.firm_amount),
          client: round2(t.client + row.client_amount),
          costs: round2(t.costs + row.cost_reimbursement),
        }),
        { firm: 0, client: 0, costs: 0 },
      );
      // Sem cronograma não há o que conferir: valem os valores digitados.
      const firmGravado = gravar.length ? totalGravado.firm : firm;
      const clientGravado = gravar.length
        ? parteDaClienteForaDoCronograma
          ? client
          : totalGravado.client
        : client;
      const costsGravado = gravar.length ? totalGravado.costs : costs;

      // Quanto a empresa paga direto, medido no próprio cronograma — assim o
      // que fica gravado no acordo bate com as parcelas mesmo que alguém tenha
      // mexido nelas à mão.
      const firmDirectGravado = gravar
        .filter((row) => row.stream === "empresa")
        .reduce((total, row) => round2(total + row.firm_amount), 0);

      const successForSchedule = Math.min(successFee, firmGravado);
      const firmComponents = splitFirmComponents(gravar, successForSchedule);

      // Acordo e cronograma são gravados em uma única transação no banco:
      // se a criação das parcelas falhar, o acordo também não é criado —
      // evita um acordo "fantasma" sem nenhuma parcela.
      const { error } = await supabase.rpc(
        "create_agreement_with_schedule",
        dropUndefined({
        _client_id: form.client_id,
        _case_id: form.case_id || undefined,
        _type: form.type,
        _status: form.status,
        _description: form.description.trim() || undefined,
        _notes: form.notes.trim() || undefined,
        _gross_amount: gross,
        _fee_percent: form.fee_percent ? num(Number(form.fee_percent)) : undefined,
        _fee_fixed_amount: form.fee_fixed_amount ? num(Number(form.fee_fixed_amount)) : undefined,
        _fee_base_extra_amount: recebidoDireto,
        _firm_direct_amount: firmDirectGravado,
        _success_fee_amount: successFee,
        _cost_reimbursement: costsGravado,
        _expected_firm_amount: firmGravado,
        _expected_client_amount: clientGravado,
        _agreement_date: form.agreement_date || undefined,
        _flow: form.flow,
        _is_estimated: form.is_estimated,
        _manual_override_reason: overridden ? form.override_reason.trim() : undefined,
        _installments: gravar.map((s, index) => ({
          label: s.label,
          number: s.number,
          total_count: gravar.length,
          due_date: s.due_date,
          stream: s.stream ?? "principal",
          gross_amount: s.gross_amount,
          fee_amount: firmComponents[index]?.fee_amount ?? 0,
          success_fee_amount: firmComponents[index]?.success_fee_amount ?? 0,
          client_amount: s.client_amount,
          cost_reimbursement: s.cost_reimbursement,
        })),
        }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acordo registrado com o cronograma.");
      setForm(EMPTY);
      setEditedSchedule(null);
      setStep(1);
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  /** Parcelas do acordo que está aberto para edição. */
  const {
    data: parcelasDoAcordo,
    isLoading: parcelasLoading,
    error: parcelasError,
  } = useQuery({
    queryKey: ["acordo-parcelas", editTarget?.id],
    enabled: !!editTarget,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("v_installments")
        .select(
          "id, label, number, due_date, gross_amount, fee_amount, success_fee_amount, client_amount, cost_reimbursement, paid_total, canceled_at, stream",
        )
        .eq("receivable_id", editTarget!.id)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("number", { ascending: true });
      if (error) throw error;
      return (rows ?? []) as unknown as {
        id: string;
        label: string | null;
        number: number | null;
        due_date: string | null;
        gross_amount: number | null;
        fee_amount: number | null;
        success_fee_amount: number | null;
        client_amount: number | null;
        cost_reimbursement: number | null;
        paid_total: number | null;
        canceled_at: string | null;
        stream: string | null;
      }[];
    },
  });

  // A linha da tabela é o que está no banco com o que a pessoa digitou por
  // cima. Nada de cópia: assim reabrir o acordo sempre mostra as parcelas.
  const editSchedule = useMemo<EditParcela[]>(
    () =>
      (parcelasDoAcordo ?? []).map((p) => ({
        id: p.id,
        label: p.label ?? "",
        due_date: p.due_date ?? "",
        gross_amount: String(num(p.gross_amount)),
        firm_amount: String(round2(num(p.fee_amount) + num(p.success_fee_amount))),
        client_amount: String(num(p.client_amount)),
        cost_reimbursement: String(num(p.cost_reimbursement)),
        origFee: num(p.fee_amount),
        origSuccess: num(p.success_fee_amount),
        numero: p.number,
        stream: p.stream,
        paid: num(p.paid_total),
        canceled: !!p.canceled_at,
        ...(parcelaEdits[p.id] ?? {}),
      })),
    [parcelasDoAcordo, parcelaEdits],
  );

  const temParcelaPaga = editSchedule.some((p) => p.paid > 0.01);

  /** Só as parcelas que a pessoa realmente pode mexer agora. */
  function podeEditar(parcela: EditParcela) {
    if (parcela.canceled) return false;
    return parcela.paid <= 0.01 || allowPaidEdit;
  }

  /**
   * Muda uma parcela e fecha a conta sozinha.
   *
   * O banco recusa parcela em que escritório + cliente + reembolso não somam o
   * total, então a coluna que a pessoa não tocou se ajusta: mexeu no total, no
   * escritório ou no reembolso, a parte da cliente absorve; mexeu na parte da
   * cliente, o total é que sobe ou desce.
   */
  function updateParcela(id: string, patch: Partial<EditParcela>) {
    const atual = editSchedule.find((p) => p.id === id);
    if (!atual) return;
    const atualizada = { ...atual, ...patch };
    const firm = num(Number(atualizada.firm_amount));
    const client = num(Number(atualizada.client_amount));
    const costs = num(Number(atualizada.cost_reimbursement));

    let completo = patch;
    if ("client_amount" in patch) {
      completo = { ...patch, gross_amount: String(round2(firm + client + costs)) };
    } else if (
      "gross_amount" in patch ||
      "firm_amount" in patch ||
      "cost_reimbursement" in patch
    ) {
      const total = num(Number(atualizada.gross_amount));
      completo = {
        ...patch,
        client_amount: String(Math.max(round2(total - firm - costs), 0)),
      };
    }

    setParcelaEdits((current) => ({
      ...current,
      [id]: { ...(current[id] ?? {}), ...completo },
    }));
  }

  /** Soma do cronograma, para conferir com o que o acordo espera receber. */
  const totaisDoCronograma = useMemo(
    () =>
      editSchedule
        .filter((p) => !p.canceled)
        .reduce(
          (total, p) => ({
            gross: round2(total.gross + num(Number(p.gross_amount))),
            firm: round2(total.firm + num(Number(p.firm_amount))),
            client: round2(total.client + num(Number(p.client_amount))),
            costs: round2(total.costs + num(Number(p.cost_reimbursement))),
          }),
          { gross: 0, firm: 0, client: 0, costs: 0 },
        ),
    [editSchedule],
  );

  // Quanto o cronograma deveria somar, pelos valores do próprio formulário.
  // Segue a mesma regra do cadastro: o dinheiro que a cliente recebe direto —
  // por fluxo ou por já ter sacado — não entra no cronograma.
  const clienteForaNaEdicao =
    editForm.flow === "cliente_recebe_direto" || editForm.flow === "recebimento_dividido";
  const recebidoDiretoNaEdicao = num(Number(editForm.fee_base_extra_amount));
  const clienteNoCronogramaNaEdicao = clienteForaNaEdicao
    ? 0
    : Math.max(round2(num(Number(editForm.expected_client_amount)) - recebidoDiretoNaEdicao), 0);
  const totalEsperadoNaEdicao = round2(
    num(Number(editForm.expected_firm_amount)) +
      clienteNoCronogramaNaEdicao +
      num(Number(editForm.cost_reimbursement)),
  );
  const divergenciaDoCronograma = Math.abs(
    round2(totaisDoCronograma.gross - totalEsperadoNaEdicao),
  );

  const updateReceivable = useMutation({
    mutationFn: async () => {
      if (!editTarget) throw new Error("Acordo inválido");
      if (!editForm.description.trim() && !editForm.notes.trim()) {
        // Nada obrigatório aqui: descrição vazia é aceita, só não pode
        // faltar o essencial que o banco valida (tipo e situação).
      }
      const { error } = await supabase.rpc(
        "update_receivable",
        dropUndefined({
          _id: editTarget.id,
          _type: editForm.type,
          _status: editForm.status,
          _description: editForm.description.trim() || undefined,
          _notes: editForm.notes.trim() || undefined,
          _case_id: editForm.case_id || undefined,
          _agreement_date: editForm.agreement_date || undefined,
          _gross_amount: num(Number(editForm.gross_amount)),
          _success_fee_amount: num(Number(editForm.success_fee_amount)),
          _cost_reimbursement: num(Number(editForm.cost_reimbursement)),
          _expected_firm_amount: num(Number(editForm.expected_firm_amount)),
          _expected_client_amount: num(Number(editForm.expected_client_amount)),
          _fee_percent: editForm.fee_percent ? num(Number(editForm.fee_percent)) : undefined,
          _fee_fixed_amount: editForm.fee_fixed_amount
            ? num(Number(editForm.fee_fixed_amount))
            : undefined,
          _fee_base_extra_amount: num(Number(editForm.fee_base_extra_amount)),
          _firm_direct_amount: num(Number(editForm.firm_direct_amount)),
          _flow: editForm.flow || undefined,
          _is_estimated: editForm.is_estimated,
        }),
      );
      if (error) throw error;

      // Só sobem as parcelas que realmente mudaram: uma chamada por parcela
      // mexida, em vez de reescrever o cronograma inteiro a cada salvamento.
      const original = new Map((parcelasDoAcordo ?? []).map((p) => [p.id, p]));
      const alteradas = editSchedule.filter((p) => {
        const antes = original.get(p.id);
        if (!antes || !podeEditar(p)) return false;
        const firmAntes = round2(num(antes.fee_amount) + num(antes.success_fee_amount));
        return (
          p.label !== (antes.label ?? "") ||
          p.due_date !== (antes.due_date ?? "") ||
          Math.abs(num(Number(p.gross_amount)) - num(antes.gross_amount)) > 0.001 ||
          Math.abs(num(Number(p.firm_amount)) - firmAntes) > 0.001 ||
          Math.abs(num(Number(p.client_amount)) - num(antes.client_amount)) > 0.001 ||
          Math.abs(num(Number(p.cost_reimbursement)) - num(antes.cost_reimbursement)) > 0.001
        );
      });

      const pagasAlteradas = alteradas.filter((p) => p.paid > 0.01);
      if (pagasAlteradas.length && !paidEditReason.trim())
        throw new Error("Informe o motivo para alterar parcelas que já receberam pagamento");

      for (const parcela of alteradas) {
        const partes = dividirParteDoEscritorio(parcela);
        const { error: parcelaError } = await supabase.rpc(
          "update_installment",
          dropUndefined({
            _id: parcela.id,
            _label: parcela.label.trim() || undefined,
            _due_date: parcela.due_date || undefined,
            _gross_amount: num(Number(parcela.gross_amount)),
            _fee_amount: partes.fee_amount,
            _success_fee_amount: partes.success_fee_amount,
            _client_amount: num(Number(parcela.client_amount)),
            _cost_reimbursement: num(Number(parcela.cost_reimbursement)),
          }),
        );
        if (parcelaError)
          throw new Error(
            `${parcela.label || `Parcela ${parcela.numero ?? ""}`}: ${friendlyError(parcelaError)}`,
          );
      }

      // Mexer em parcela já recebida é exceção: fica registrado quem autorizou,
      // quais parcelas e por quê.
      if (pagasAlteradas.length && profile) {
        await supabase.from("audit_logs").insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_email: profile.email,
          action: "editar_parcela_paga",
          table_name: "installments",
          record_id: editTarget.id,
          new_values: {
            motivo: paidEditReason.trim(),
            parcelas: pagasAlteradas.map((p) => p.label || `Parcela ${p.numero ?? ""}`),
          },
        });
      }

      return alteradas.length;
    },
    onSuccess: (quantas) => {
      toast.success(
        quantas
          ? `Acordo atualizado e ${quantas} ${quantas === 1 ? "parcela alterada" : "parcelas alteradas"}.`
          : "Acordo atualizado.",
      );
      setEditTarget(null);
      setParcelaEdits({});
      setAllowPaidEdit(false);
      setPaidEditReason("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao editar", { description: friendlyError(e) }),
  });

  const cancelReceivable = useMutation({
    mutationFn: async () => {
      if (!cancelTarget) throw new Error("Acordo inválido");
      if (!cancelReason.trim()) throw new Error("Informe o motivo do cancelamento");
      const { error } = await supabase.rpc("cancel_receivable", {
        _receivable_id: cancelTarget.id,
        _reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acordo cancelado.");
      setCancelTarget(null);
      setCancelReason("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao cancelar", { description: friendlyError(e) }),
  });

  const deleteReceivable = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Acordo inválido");
      // Apaga em cascata: parcelas, recebimentos e repasses ligados ao acordo.
      const { data: resumo, error } = await supabase.rpc("delete_receivable", {
        _id: deleteTarget.id,
      });
      if (error) throw error;
      return resumo as unknown as {
        parcelas: number;
        recebimentos: number;
        repasses: number;
        recebido: number;
        repassado: number;
      } | null;
    },
    onSuccess: (r) => {
      const partes = [
        `${r?.parcelas ?? 0} parcela(s)`,
        r?.recebimentos ? `${r.recebimentos} recebimento(s)` : "",
        r?.repasses ? `${r.repasses} repasse(s)` : "",
      ].filter(Boolean);
      const caixa = num(r?.recebido) + num(r?.repassado);
      toast.success(`Acordo apagado com ${partes.join(", ")}.`, {
        description:
          caixa > 0.01 ? `${money(caixa)} saíram do fluxo de caixa junto.` : undefined,
      });
      setDeleteTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao apagar", { description: friendlyError(e) }),
  });

  const casesForClient = (data?.cases ?? []).filter((c) => c.client_id === form.client_id);

  const stepValid =
    step === 1
      ? !!form.client_id
      : step === 2
        ? gross > 0
        : step === 3
          ? form.no_schedule || scheduleErrors.length === 0
          : true;

  return (
    <>
      <PageHeader
        title="Acordos e Sentenças"
        description="Recebíveis jurídicos com separação entre o valor do escritório e o valor do cliente."
        action={
          canWrite && (
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                if (!v) {
                  setStep(1);
                  setEditedSchedule(null);
                  // Sem limpar o form, o próximo acordo abre com o cliente e
                  // os valores do acordo abandonado ainda preenchidos.
                  setForm(EMPTY);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button>Novo acordo/sentença</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Novo acordo/sentença — etapa {step} de 4</DialogTitle>
                </DialogHeader>

                {step === 1 && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Cliente</Label>
                      <Select
                        value={form.client_id}
                        onValueChange={(v) => setForm({ ...form, client_id: v, case_id: "" })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          {(data?.clients ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Processo (opcional)</Label>
                      <Select
                        value={form.case_id}
                        onValueChange={(v) => setForm({ ...form, case_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o processo" />
                        </SelectTrigger>
                        <SelectContent>
                          {casesForClient.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.case_number || c.opposing_party || "Sem número"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="desc">Descrição</Label>
                      <Input
                        id="desc"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select
                        value={form.type}
                        onValueChange={(v) =>
                          // Virar honorário de serviço zera o que não se aplica,
                          // senão um percentual digitado antes iria junto no
                          // cadastro mesmo com o campo escondido.
                          updateForm(
                            v === "honorarios"
                              ? {
                                  type: v,
                                  fee_percent: "",
                                  fee_fixed_amount: "",
                                  fee_base_extra_amount: "",
                                  success_fee_amount: "",
                                  cost_reimbursement: "",
                                  expected_client_amount: "",
                                  flow: "escritorio_recebe_total",
                                }
                              : { type: v },
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RECEIVABLE_TYPE_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {k === "honorarios" ? "Honorários de serviço" : v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Situação</Label>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm({ ...form, status: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RECEIVABLE_STATUS_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gross">
                        {isServiceFee ? "Valor dos honorários" : "Valor bruto"}
                      </Label>
                      <Input
                        id="gross"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.gross_amount}
                        onChange={(e) => updateForm({ gross_amount: e.target.value })}
                      />
                      {gross <= 0 && (
                        <p className="text-xs text-destructive">Informe um valor maior que zero.</p>
                      )}
                      {isServiceFee && gross > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Valor inteiro do escritório — a cliente não recebe nada deste acordo.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="date">Data do acordo/decisão</Label>
                      <Input
                        id="date"
                        type="date"
                        value={form.agreement_date}
                        onChange={(e) => setForm({ ...form, agreement_date: e.target.value })}
                      />
                    </div>
                    <div className={`space-y-2 ${isServiceFee ? "hidden" : ""}`}>
                      <Label htmlFor="pct">% honorários contratuais</Label>
                      <Input
                        id="pct"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.fee_percent}
                        onChange={(e) => updateForm({ fee_percent: e.target.value })}
                      />
                    </div>
                    <div className={`space-y-2 ${isServiceFee ? "hidden" : ""}`}>
                      <Label htmlFor="fix">Honorários fixos (se sem %)</Label>
                      <Input
                        id="fix"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.fee_fixed_amount}
                        onChange={(e) => updateForm({ fee_fixed_amount: e.target.value })}
                      />
                    </div>
                    <div className={`space-y-2 sm:col-span-2 ${isServiceFee ? "hidden" : ""}`}>
                      <Label htmlFor="direto">
                        Valor recebido direto pela cliente (FGTS, alvará)
                      </Label>
                      <Input
                        id="direto"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.fee_base_extra_amount}
                        onChange={(e) => updateForm({ fee_base_extra_amount: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Parte do valor bruto que a cliente sacou sozinha e nunca passa pelo
                        escritório. Os honorários continuam sendo calculados sobre o valor bruto
                        inteiro — o que este campo faz é abater do que ainda entra na nossa conta.
                      </p>
                      {recebidoDireto > 0 && (
                        <p className="text-xs text-info">
                          Honorários: {money(contractualFee)} sobre o valor bruto de {money(gross)}.
                          Transita pela nossa conta {money(gross)} − {money(recebidoDireto)} ={" "}
                          <strong className="num">
                            {money(Math.max(round2(gross - recebidoDireto), 0))}
                          </strong>
                          , e desse valor a cliente fica com{" "}
                          <strong className="num">{money(clientNoCronograma)}</strong>.
                        </p>
                      )}
                    </div>
                    <div className={`space-y-2 ${isServiceFee ? "hidden" : ""}`}>
                      <Label htmlFor="suc">Sucumbência</Label>
                      <Input
                        id="suc"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.success_fee_amount}
                        onChange={(e) => updateForm({ success_fee_amount: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Sempre por fora: não entra no valor bruto nem na base do percentual. Soma
                        no total do escritório e ganha cronograma próprio, com as datas em que a
                        parte contrária vai pagar.
                      </p>
                    </div>
                    <div className={`space-y-2 ${isServiceFee ? "hidden" : ""}`}>
                      <Label htmlFor="cst">Reembolso de custas</Label>
                      <Input
                        id="cst"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.cost_reimbursement}
                        onChange={(e) => updateForm({ cost_reimbursement: e.target.value })}
                      />
                    </div>
                    <div className={`space-y-2 ${isServiceFee ? "hidden" : ""}`}>
                      <Label>Forma do fluxo</Label>
                      {clienteRecebeDireto && (
                        <p className="order-last text-xs text-info">
                          As parcelas a receber vão conter só o que a cliente repassa para o
                          escritório — o dinheiro dela não passa por aqui.
                        </p>
                      )}
                      {recebimentoDividido && (
                        <p className="order-last text-xs text-info">
                          No passo seguinte você informa quanto do honorário a empresa paga direto
                          ao escritório. O resto do acordo cai na conta da cliente, e ela paga o
                          honorário que faltar.
                        </p>
                      )}
                      <Select value={form.flow} onValueChange={(v) => updateForm({ flow: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FLOW_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <Checkbox
                        checked={form.is_estimated}
                        onCheckedChange={(v) => setForm({ ...form, is_estimated: v === true })}
                      />
                      Valor estimado (a confirmar)
                    </label>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firm">Valor esperado do escritório</Label>
                        <Input
                          id="firm"
                          type="number"
                          step="0.01"
                          placeholder={String(suggestedFirm.toFixed(2))}
                          value={form.expected_firm_amount}
                          onChange={(e) => updateForm({ expected_firm_amount: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Sugerido: {money(suggestedFirm)}
                          {isServiceFee ? " (todo o valor)" : " (honorários + sucumbência)"}
                        </p>
                      </div>
                      <div className={`space-y-2 ${isServiceFee ? "hidden" : ""}`}>
                        <Label htmlFor="cli">Valor esperado do cliente</Label>
                        <Input
                          id="cli"
                          type="number"
                          step="0.01"
                          placeholder={String(suggestedClient.toFixed(2))}
                          value={form.expected_client_amount}
                          onChange={(e) => updateForm({ expected_client_amount: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Sugerido: {money(suggestedClient)}
                        </p>
                      </div>
                    </div>
                    {overridden && (
                      <div className="space-y-2">
                        <Label htmlFor="just">Justificativa da alteração manual</Label>
                        <Textarea
                          id="just"
                          value={form.override_reason}
                          onChange={(e) => setForm({ ...form, override_reason: e.target.value })}
                        />
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.no_schedule}
                        onCheckedChange={(v) => updateForm({ no_schedule: v === true })}
                      />
                      Ainda sem cronograma definido (a definir)
                    </label>
                    {!form.no_schedule && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Como distribuir os valores nas parcelas?</Label>
                          <Select
                            value={form.distribution_mode}
                            onValueChange={(v) =>
                              updateForm({ distribution_mode: v as DistributionMode })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="proporcional">
                                Proporcional entre escritório e cliente
                              </SelectItem>
                              <SelectItem value="escritorio_primeiro">
                                Primeiros valores para o escritório
                              </SelectItem>
                              <SelectItem value="meio_a_meio">
                                Metade para cada, até fechar o do escritório
                              </SelectItem>
                              <SelectItem value="manual">Personalizado manualmente</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            A sugestão poderá ser alterada parcela por parcela na próxima etapa.
                          </p>
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={form.has_entry}
                            onCheckedChange={(v) => updateForm({ has_entry: v === true })}
                          />
                          O acordo possui entrada
                        </label>

                        {form.has_entry && (
                          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="entry-value">Valor da entrada</Label>
                              <Input
                                id="entry-value"
                                type="number"
                                min="0"
                                step="0.01"
                                value={form.entry_amount}
                                onChange={(e) => updateForm({ entry_amount: e.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="entry-date">Data da entrada</Label>
                              <Input
                                id="entry-date"
                                type="date"
                                value={form.entry_due}
                                onChange={(e) => updateForm({ entry_due: e.target.value })}
                              />
                            </div>
                          </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="par">
                              {form.has_entry ? "Parcelas após a entrada" : "Nº de parcelas"}
                            </Label>
                            <Input
                              id="par"
                              type="number"
                              min="1"
                              value={form.parcels}
                              onChange={(e) => updateForm({ parcels: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="fst">1º vencimento do saldo</Label>
                            <Input
                              id="fst"
                              type="date"
                              value={form.first_due}
                              onChange={(e) => updateForm({ first_due: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="per">Periodicidade (meses)</Label>
                            <Input
                              id="per"
                              type="number"
                              min="1"
                              value={form.periodicity}
                              onChange={(e) => updateForm({ periodicity: e.target.value })}
                            />
                          </div>
                        </div>

                        {clienteRecebeDireto && (
                          <div className="rounded-md border border-info/40 bg-info/5 p-3 text-xs">
                            <p className="font-medium text-foreground">
                              A cliente recebe direto da empresa
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              O cronograma abaixo cobra só os{" "}
                              <strong className="num text-foreground">{money(mainFirm + costs)}</strong>{" "}
                              que ela deve repassar ao escritório. Os{" "}
                              <strong className="num text-foreground">{money(client)}</strong> que
                              ficam com ela não viram parcela a receber, porque nunca passam pela
                              nossa conta.
                              {successFee > 0 && (
                                <>
                                  {" "}
                                  A sucumbência de{" "}
                                  <strong className="num text-foreground">
                                    {money(successFee)}
                                  </strong>{" "}
                                  é paga pela empresa, em parcelas próprias.
                                </>
                              )}
                            </p>
                          </div>
                        )}

                        {/* Recebimento dividido: a empresa deposita parte do
                            honorário direto aqui e manda o resto do acordo
                            para a conta da cliente, que nos paga o que faltou
                            do honorário. */}
                        {recebimentoDividido && !isServiceFee && (
                          <div className="rounded-md border border-border p-3">
                            <div className="space-y-2">
                              <Label htmlFor="fdir">
                                Do honorário de {money(mainFirm)}, quanto a empresa paga direto ao
                                escritório?
                              </Label>
                              <Input
                                id="fdir"
                                type="number"
                                step="0.01"
                                min="0"
                                value={form.firm_direct_amount}
                                onChange={(e) => updateForm({ firm_direct_amount: e.target.value })}
                              />
                              <p className="text-xs text-muted-foreground">
                                O resto do acordo cai direto na conta da cliente — não entra no
                                caixa nem vira repasse. O valor bruto continua inteiro, como
                                estatística do que se conseguiu para ela.
                              </p>
                              {firmDirect > 0 && (
                                <p className="text-xs text-info">
                                  Empresa paga{" "}
                                  <strong className="num">{money(firmDirect)}</strong> e a cliente
                                  paga <strong className="num">{money(firmNoPrincipal)}</strong> —
                                  em trilhas separadas, cada uma com suas datas. A cliente recebe{" "}
                                  <strong className="num">{money(client)}</strong> direto na conta
                                  dela.
                                </p>
                              )}
                            </div>

                            {firmDirect > 0 && (
                              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                <div className="space-y-2">
                                  <Label htmlFor="fdpar">Parcelas da empresa</Label>
                                  <Input
                                    id="fdpar"
                                    type="number"
                                    min="1"
                                    value={form.firm_direct_parcels}
                                    onChange={(e) =>
                                      updateForm({ firm_direct_parcels: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="fdfst">1º vencimento</Label>
                                  <Input
                                    id="fdfst"
                                    type="date"
                                    value={form.firm_direct_first_due}
                                    onChange={(e) =>
                                      updateForm({ firm_direct_first_due: e.target.value })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="fdper">Periodicidade (meses)</Label>
                                  <Input
                                    id="fdper"
                                    type="number"
                                    min="1"
                                    value={form.firm_direct_periodicity}
                                    onChange={(e) =>
                                      updateForm({ firm_direct_periodicity: e.target.value })
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* A sucumbência é paga direto pela parte contrária, e
                            quase nunca nas mesmas datas do acordo da cliente —
                            por isso ela sempre tem trilha própria. */}
                        {successSeparated && (
                          <div className="rounded-md border border-border p-3">
                            <p className="text-sm">
                              Sucumbência de {money(successFee)}, paga direto pela parte contrária
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Vira parcelas próprias, com as datas dela. O cronograma do acordo
                                fica só com o que passa pela cliente.
                              </span>
                            </p>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div className="space-y-2">
                                <Label htmlFor="spar">Parcelas da sucumbência</Label>
                                <Input
                                  id="spar"
                                  type="number"
                                  min="1"
                                  value={form.success_parcels}
                                  onChange={(e) => updateForm({ success_parcels: e.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="sfst">1º vencimento</Label>
                                <Input
                                  id="sfst"
                                  type="date"
                                  value={form.success_first_due}
                                  onChange={(e) =>
                                    updateForm({ success_first_due: e.target.value })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="sper">Periodicidade (meses)</Label>
                                <Input
                                  id="sper"
                                  type="number"
                                  min="1"
                                  value={form.success_periodicity}
                                  onChange={(e) =>
                                    updateForm({ success_periodicity: e.target.value })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {scheduleErrors.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <p className="text-sm font-medium text-destructive">
                          Corrija antes de continuar:
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-destructive">
                          {scheduleErrors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div className="panel p-4 text-sm">
                      {gross > 0 && (
                        <p className="mb-3 border-b border-border pb-3 text-xs text-muted-foreground">
                          Valor bruto do acordo:{" "}
                          <strong className="num text-foreground">{money(gross)}</strong>
                          {successFee > 0 && (
                            <>
                              {" "}
                              + sucumbência de {money(successFee)} por fora ={" "}
                              <strong className="num text-foreground">
                                {money(round2(gross + successFee))}
                              </strong>
                              .
                            </>
                          )}
                        </p>
                      )}
                      {recebidoDireto > 0 && (
                        <p className="mb-3 border-b border-border pb-3 text-xs text-muted-foreground">
                          Desse bruto, a cliente já sacou{" "}
                          <strong className="num text-foreground">{money(recebidoDireto)}</strong>{" "}
                          direto. Os honorários continuam calculados sobre o bruto inteiro, mas
                          esse valor não entra no cronograma, no caixa nem no repasse.
                        </p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <p>
                          Total a receber:{" "}
                          <strong className="num">{money(firm + client + costs)}</strong>
                        </p>
                        <p>
                          Distribuído:{" "}
                          <strong className="num">{money(scheduleTotals.gross)}</strong>
                        </p>
                        <p>
                          Escritório: <strong className="num">{money(scheduleTotals.firm)}</strong>
                          <span className="text-muted-foreground"> de {money(firm)}</span>
                        </p>
                        <p>
                          Cliente: <strong className="num">{money(scheduleTotals.client)}</strong>
                          <span className="text-muted-foreground"> de {money(client)}</span>
                        </p>
                        <p>
                          Reembolsos: <strong className="num">{money(scheduleTotals.costs)}</strong>
                          <span className="text-muted-foreground"> de {money(costs)}</span>
                        </p>
                        <p>
                          Itens do cronograma: <strong>{schedule.length}</strong>
                        </p>
                      </div>

                      {centavosPendentes > 0 && scheduleErrors.length === 0 && (
                        <p className="mt-2 rounded-md border border-border bg-background p-2 text-xs">
                          Sobrou uma diferença de{" "}
                          <strong className="num">{money(centavosPendentes)}</strong> por causa do
                          arredondamento das parcelas. Pode confirmar: o sistema encosta esses
                          centavos na parte do escritório para o acordo fechar exato.
                        </p>
                      )}
                    </div>

                    {!form.no_schedule && (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Composição de cada parcela</p>
                          <p className="text-xs text-muted-foreground">
                            Altere as datas e indique exatamente quanto é do escritório e do
                            cliente.
                          </p>
                          {!editedSchedule && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Recalculado com os valores atuais — as alterações feitas à mão antes
                              de mudar os valores foram descartadas.
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEditedSchedule(generatedSchedule.map((row) => ({ ...row })))
                          }
                        >
                          Regerar sugestão
                        </Button>
                      </div>
                    )}

                    {schedule.length > 0 && (
                      <div className="max-h-80 overflow-auto rounded-md border border-border">
                        <table className="min-w-[860px] w-full text-sm">
                          <thead className="bg-muted text-xs text-muted-foreground uppercase">
                            <tr>
                              <th className="p-2 text-left">Identificação</th>
                              <th className="text-left">Vencimento</th>
                              <th className="text-right">Total</th>
                              <th className="text-right">Escritório</th>
                              <th className="text-right">Cliente</th>
                              <th className="p-2 text-right">Reembolso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedule.map((row, index) => (
                              <tr
                                key={`${row.number}-${index}`}
                                className="border-t border-border/60"
                              >
                                <td className="p-2">
                                  <Input
                                    className="min-w-28"
                                    value={row.label}
                                    onChange={(e) =>
                                      updateScheduleRow(index, { label: e.target.value })
                                    }
                                  />
                                  {row.stream === "sucumbencia" && (
                                    <Tag tone="info">paga direto ao escritório</Tag>
                                  )}
                                  {row.stream === "empresa" && (
                                    <Tag tone="info">a empresa paga</Tag>
                                  )}
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-36"
                                    type="date"
                                    value={row.due_date}
                                    onChange={(e) =>
                                      updateScheduleRow(index, { due_date: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.gross_amount}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        gross_amount: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.firm_amount}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        firm_amount: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.client_amount}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        client_amount: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.cost_reimbursement}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        cost_reimbursement: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {scheduleErrors.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <p className="text-sm font-medium text-destructive">
                          Corrija o cronograma antes de confirmar:
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-destructive">
                          {scheduleErrors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="gap-2">
                  {step > 1 && (
                    <Button variant="outline" onClick={() => setStep((s) => (s - 1) as Step)}>
                      Voltar
                    </Button>
                  )}
                  {step < 4 ? (
                    <Button
                      onClick={() => {
                        if (step === 3)
                          setEditedSchedule(generatedSchedule.map((row) => ({ ...row })));
                        setStep((s) => (s + 1) as Step);
                      }}
                      disabled={!stepValid}
                    >
                      Continuar
                    </Button>
                  ) : (
                    <Button
                      onClick={() => create.mutate()}
                      disabled={create.isPending || scheduleErrors.length > 0}
                    >
                      {create.isPending ? "Salvando…" : "Confirmar"}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Label htmlFor="ord" className="text-sm">
          Ordenar por
        </Label>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger id="ord" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recentes">Cadastrados por último</SelectItem>
            <SelectItem value="cliente">Cliente (A–Z)</SelectItem>
            <SelectItem value="cliente_desc">Cliente (Z–A)</SelectItem>
            <SelectItem value="data_desc">Data do acordo (mais recente)</SelectItem>
            <SelectItem value="data">Data do acordo (mais antiga)</SelectItem>
            <SelectItem value="valor">Valor (maior primeiro)</SelectItem>
            <SelectItem value="valor_asc">Valor (menor primeiro)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {sortedReceivables.length} acordo(s)
        </span>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Cliente</th>
              <th>Tipo</th>
              <th>Situação</th>
              <th className="text-right">Bruto</th>
              <th className="text-right">Total a receber</th>
              <th className="text-right">Escritório</th>
              <th className="text-right">Cliente</th>
              <th className="text-right">Recebido</th>
              {(canCancel || canEdit || canDelete || isMainAdmin) && <th className="p-3" />}
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
            {!isLoading && (data?.receivables.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Nenhum acordo cadastrado.
                </td>
              </tr>
            )}
            {sortedReceivables.map((r) => {
              // O que será efetivamente cobrado nas parcelas. Pode diferir do
              // valor bruto quando a sucumbência foi cadastrada por fora dele.
              const totalToReceive =
                num(r.expected_firm_amount) +
                num(r.expected_client_amount) +
                num(r.cost_reimbursement);
              const paid = (data?.installments ?? [])
                .filter((i) => i.receivable_id === r.id)
                .reduce((s, i) => s + num(i.paid_total), 0);
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <span className="font-medium">
                      {(r.clients as { name: string } | null)?.name ?? "—"}
                    </span>
                    {r.description && (
                      <span className="block text-xs text-muted-foreground">{r.description}</span>
                    )}
                  </td>
                  <td>{RECEIVABLE_TYPE_LABEL[r.type] ?? r.type}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <ReceivableStatusTag status={r.status} />
                      {r.is_estimated && <Tag tone="warning">Estimado</Tag>}
                    </div>
                  </td>
                  <td className="num text-right text-muted-foreground">{money(r.gross_amount)}</td>
                  <td className="num text-right font-medium">
                    {money(totalToReceive)}
                    {Math.abs(totalToReceive - num(r.gross_amount)) > 0.01 && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {totalToReceive > num(r.gross_amount) ? "+" : "−"}
                        {money(Math.abs(totalToReceive - num(r.gross_amount))).replace(
                          "R$",
                          "R$ ",
                        )}{" "}
                        sobre o bruto
                      </span>
                    )}
                  </td>
                  <td className="num text-right">{money(r.expected_firm_amount)}</td>
                  <td className="num text-right">{money(r.expected_client_amount)}</td>
                  <td className="num text-right">{money(paid)}</td>
                   {(canCancel || canEdit || canDelete || isMainAdmin) && (
                     <td className="p-3 text-right whitespace-nowrap">
                      {canEdit && r.status !== "cancelado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            // Abre limpo: o que foi digitado num acordo antes
                            // não pode vazar para este.
                            setParcelaEdits({});
                            setAllowPaidEdit(false);
                            setPaidEditReason("");
                            setEditTarget({
                              id: r.id,
                              name: (r.clients as { name: string } | null)?.name ?? "acordo",
                            });
                            setEditForm({
                              type: r.type,
                              status: r.status,
                              description: r.description ?? "",
                              notes: r.notes ?? "",
                              case_id: r.case_id ?? "",
                              agreement_date: r.agreement_date ?? todayISO(),
                              gross_amount: String(num(r.gross_amount)),
                              success_fee_amount: String(num(r.success_fee_amount)),
                              cost_reimbursement: String(num(r.cost_reimbursement)),
                              expected_firm_amount: String(num(r.expected_firm_amount)),
                              expected_client_amount: String(num(r.expected_client_amount)),
                              fee_percent: r.fee_percent ? String(num(r.fee_percent)) : "",
                              fee_fixed_amount: r.fee_fixed_amount
                                ? String(num(r.fee_fixed_amount))
                                : "",
                              fee_base_extra_amount: r.fee_base_extra_amount
                                ? String(num(r.fee_base_extra_amount))
                                : "",
                              firm_direct_amount: r.firm_direct_amount
                                ? String(num(r.firm_direct_amount))
                                : "",
                              flow: r.flow ?? "escritorio_recebe_total",
                              is_estimated: !!r.is_estimated,
                            });
                          }}
                        >
                          Editar
                        </Button>
                      )}
                       {canCancel && r.status !== "cancelado" && paid <= 0.01 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            setCancelTarget({
                              id: r.id,
                              name: (r.clients as { name: string } | null)?.name ?? "acordo",
                            });
                            setCancelReason("");
                          }}
                        >
                           Cancelar
                         </Button>
                       )}
                       {(canDelete || isMainAdmin) && (
                         <Button
                           size="sm"
                           variant="ghost"
                           className="text-destructive"
                           onClick={() =>
                             setDeleteTarget({
                               id: r.id,
                               name: (r.clients as { name: string } | null)?.name ?? "acordo",
                               paid,
                             })
                           }
                         >
                           Apagar
                         </Button>
                       )}
                     </td>
                   )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) {
            setEditTarget(null);
            setParcelaEdits({});
            setAllowPaidEdit(false);
            setPaidEditReason("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Editar acordo</DialogTitle>
            <DialogDescription>
              {editTarget?.name} — dá para mexer nos valores do acordo e no cronograma, datas
              incluídas. O que já entrou não pode ser desfeito por aqui: nem o acordo nem uma
              parcela podem ficar valendo menos do que já foi recebido. Para isso, estorne o
              recebimento antes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm({ ...editForm, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RECEIVABLE_TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {k === "honorarios" ? "Honorários de serviço" : v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RECEIVABLE_STATUS_LABEL)
                    .filter(([k]) => k !== "cancelado")
                    .map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edesc">Descrição</Label>
              <Input
                id="edesc"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edata">Data do acordo</Label>
              <Input
                id="edata"
                type="date"
                value={editForm.agreement_date}
                onChange={(e) => setEditForm({ ...editForm, agreement_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebruto">Valor bruto</Label>
              <Input
                id="ebruto"
                type="number"
                step="0.01"
                value={editForm.gross_amount}
                onChange={(e) => setEditForm({ ...editForm, gross_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="esuc">Sucumbência</Label>
              <Input
                id="esuc"
                type="number"
                step="0.01"
                value={editForm.success_fee_amount}
                onChange={(e) => setEditForm({ ...editForm, success_fee_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecus">Reembolso de custas</Label>
              <Input
                id="ecus"
                type="number"
                step="0.01"
                value={editForm.cost_reimbursement}
                onChange={(e) => setEditForm({ ...editForm, cost_reimbursement: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edireto">Valor recebido direto pela cliente (FGTS, alvará)</Label>
              <Input
                id="edireto"
                type="number"
                step="0.01"
                min="0"
                value={editForm.fee_base_extra_amount}
                onChange={(e) =>
                  setEditForm({ ...editForm, fee_base_extra_amount: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Entra só na base do percentual de honorários. Mudar aqui não recalcula sozinho os
                valores esperados abaixo — ajuste-os na mão se for o caso.
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="efdir">Honorário que a empresa paga direto ao escritório</Label>
              <Input
                id="efdir"
                type="number"
                step="0.01"
                min="0"
                value={editForm.firm_direct_amount}
                onChange={(e) => setEditForm({ ...editForm, firm_direct_amount: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Sai de dentro do esperado do escritório — não é dinheiro a mais. Corrige só o
                registro do acordo: as parcelas já criadas continuam com a origem que tinham.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="efirm">Esperado do escritório</Label>
              <Input
                id="efirm"
                type="number"
                step="0.01"
                value={editForm.expected_firm_amount}
                onChange={(e) =>
                  setEditForm({ ...editForm, expected_firm_amount: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecli">Esperado da cliente</Label>
              <Input
                id="ecli"
                type="number"
                step="0.01"
                value={editForm.expected_client_amount}
                onChange={(e) =>
                  setEditForm({ ...editForm, expected_client_amount: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="epct">% honorários contratuais</Label>
              <Input
                id="epct"
                type="number"
                step="0.01"
                value={editForm.fee_percent}
                onChange={(e) => setEditForm({ ...editForm, fee_percent: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="efix">Honorários fixos</Label>
              <Input
                id="efix"
                type="number"
                step="0.01"
                value={editForm.fee_fixed_amount}
                onChange={(e) => setEditForm({ ...editForm, fee_fixed_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Processo</Label>
              <Select
                value={editForm.case_id}
                onValueChange={(v) => setEditForm({ ...editForm, case_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem processo" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.cases ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.case_number || "sem número"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Forma do fluxo</Label>
              <Select
                value={editForm.flow}
                onValueChange={(v) => setEditForm({ ...editForm, flow: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FLOW_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={editForm.is_estimated}
                onCheckedChange={(v) => setEditForm({ ...editForm, is_estimated: v === true })}
              />
              Valor estimado (a confirmar)
            </label>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="enotes">Observações</Label>
              <Textarea
                id="enotes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
            <div className="space-y-3 sm:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">Cronograma de parcelas</h3>
                <p className="text-xs text-muted-foreground">
                  Somam{" "}
                  <strong className="num text-foreground">
                    {money(totaisDoCronograma.gross)}
                  </strong>{" "}
                  — escritório {money(totaisDoCronograma.firm)}, cliente{" "}
                  {money(totaisDoCronograma.client)}, reembolso{" "}
                  {money(totaisDoCronograma.costs)}
                </p>
              </div>

              {parcelasLoading && (
                <p className="text-xs text-muted-foreground">Carregando parcelas…</p>
              )}

              {/* Sem isto, uma falha ao carregar se disfarçava de acordo sem
                  parcelas — foi o que aconteceu quando a view do banco estava
                  sem a coluna de origem da parcela. */}
              {parcelasError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  Não foi possível carregar as parcelas: {friendlyError(parcelasError)}
                </p>
              )}

              {!parcelasLoading && !parcelasError && editSchedule.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Este acordo ainda não tem parcelas.
                </p>
              )}

              {temParcelaPaga && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={allowPaidEdit}
                      onCheckedChange={(v) => setAllowPaidEdit(v === true)}
                    />
                    <span>
                      Alterar também as parcelas que já receberam pagamento
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Elas são histórico: mexer nelas muda relatórios já fechados. Sem marcar,
                        só as parcelas em aberto ficam editáveis. O valor de uma parcela nunca
                        pode ficar abaixo do que já entrou nela — para isso, estorne o
                        recebimento antes.
                      </span>
                    </span>
                  </label>
                  {allowPaidEdit && (
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="motivo-pagas">Motivo da alteração</Label>
                      <Textarea
                        id="motivo-pagas"
                        value={paidEditReason}
                        onChange={(e) => setPaidEditReason(e.target.value)}
                        placeholder="Fica registrado na auditoria junto com as parcelas alteradas."
                      />
                    </div>
                  )}
                </div>
              )}

              {editSchedule.length > 0 && (
                <div className="max-h-80 overflow-auto rounded-md border border-border">
                  <table className="min-w-[860px] w-full text-sm">
                    <thead className="bg-muted text-xs text-muted-foreground uppercase">
                      <tr>
                        <th className="p-2 text-left">Identificação</th>
                        <th className="text-left">Vencimento</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Escritório</th>
                        <th className="text-right">Cliente</th>
                        <th className="p-2 text-right">Reembolso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editSchedule.map((parcela) => {
                        const liberada = podeEditar(parcela);
                        return (
                          <tr key={parcela.id} className="border-t border-border/60">
                            <td className="p-2">
                              <Input
                                className="min-w-28"
                                value={parcela.label}
                                disabled={!liberada}
                                onChange={(e) =>
                                  updateParcela(parcela.id, { label: e.target.value })
                                }
                              />
                              <div className="mt-1 flex flex-wrap gap-1">
                                {parcela.canceled && <Tag tone="danger">cancelada</Tag>}
                                {parcela.paid > 0.01 && (
                                  <Tag tone={liberada ? "warning" : "info"}>
                                    recebeu {money(parcela.paid)}
                                  </Tag>
                                )}
                                {parcela.stream === "sucumbencia" && (
                                  <Tag tone="info">sucumbência</Tag>
                                )}
                                {parcela.stream === "empresa" && (
                                  <Tag tone="info">a empresa paga</Tag>
                                )}
                              </div>
                            </td>
                            <td className="p-2">
                              <Input
                                className="min-w-36"
                                type="date"
                                value={parcela.due_date}
                                disabled={!liberada}
                                onChange={(e) =>
                                  updateParcela(parcela.id, { due_date: e.target.value })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                className="min-w-28 text-right"
                                type="number"
                                min="0"
                                step="0.01"
                                value={parcela.gross_amount}
                                disabled={!liberada}
                                onChange={(e) =>
                                  updateParcela(parcela.id, { gross_amount: e.target.value })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                className="min-w-28 text-right"
                                type="number"
                                min="0"
                                step="0.01"
                                value={parcela.firm_amount}
                                disabled={!liberada}
                                onChange={(e) =>
                                  updateParcela(parcela.id, { firm_amount: e.target.value })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                className="min-w-28 text-right"
                                type="number"
                                min="0"
                                step="0.01"
                                value={parcela.client_amount}
                                disabled={!liberada}
                                onChange={(e) =>
                                  updateParcela(parcela.id, { client_amount: e.target.value })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                className="min-w-28 text-right"
                                type="number"
                                min="0"
                                step="0.01"
                                value={parcela.cost_reimbursement}
                                disabled={!liberada}
                                onChange={(e) =>
                                  updateParcela(parcela.id, {
                                    cost_reimbursement: e.target.value,
                                  })
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {editSchedule.length > 0 && divergenciaDoCronograma > 0.01 && (
                <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                  <p>
                    As parcelas somam {money(totaisDoCronograma.gross)} e o acordo espera receber{" "}
                    {money(totalEsperadoNaEdicao)} —{" "}
                    {faltaOuSobra(totaisDoCronograma.gross, totalEsperadoNaEdicao)} no cronograma.
                  </p>
                  {/* Causa quase certa quando a diferença é justamente o FGTS:
                      parcelas geradas antes de o campo existir cobram da
                      cliente um dinheiro que ela já tinha sacado. */}
                  {recebidoDiretoNaEdicao > 0.01 &&
                    Math.abs(divergenciaDoCronograma - recebidoDiretoNaEdicao) < 1 && (
                      <p>
                        A diferença é justamente o que a cliente recebeu direto (
                        {money(recebidoDiretoNaEdicao)}). Se estas parcelas foram criadas antes
                        desse campo, elas ainda cobram dela um dinheiro que já está na conta dela:
                        baixe a parte da cliente nas parcelas, ou zere o campo se ele não se
                        aplica a este acordo.
                      </p>
                    )}
                  <p className="text-muted-foreground">
                    Dá para salvar assim, mas os relatórios vão mostrar a diferença.
                  </p>
                </div>
              )}

              {/* Parcela em que o total não bate com as próprias partes, quase
                  sempre arredondamento antigo. Mexer na linha já a fecha. */}
              {Math.abs(
                round2(
                  totaisDoCronograma.firm + totaisDoCronograma.client + totaisDoCronograma.costs,
                ) - totaisDoCronograma.gross,
              ) > 0.01 && (
                <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                  Em alguma parcela o total não bate com escritório + cliente + reembolso: as
                  colunas somam{" "}
                  {money(
                    round2(
                      totaisDoCronograma.firm +
                        totaisDoCronograma.client +
                        totaisDoCronograma.costs,
                    ),
                  )}{" "}
                  e os totais somam {money(totaisDoCronograma.gross)}. Basta mexer na parcela
                  torta que ela se fecha sozinha.
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                A coluna Escritório junta honorários e sucumbência. Mexendo no total, no
                escritório ou no reembolso, a parte da cliente se ajusta sozinha; mexendo na parte
                da cliente, é o total que muda — assim a parcela sempre fecha.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditTarget(null);
                setParcelaEdits({});
                setAllowPaidEdit(false);
                setPaidEditReason("");
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => updateReceivable.mutate()}
              disabled={updateReceivable.isPending}
            >
              {updateReceivable.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar acordo</DialogTitle>
            <DialogDescription>
              O acordo de {cancelTarget?.name} e as parcelas em aberto deixam de ser cobrados e saem
              dos totais. O registro continua no histórico com o motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-recv-reason">Motivo do cancelamento</Label>
            <Textarea
              id="cancel-recv-reason"
              placeholder="Ex.: acordo desfeito, cadastrado em duplicidade…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={cancelReceivable.isPending || !cancelReason.trim()}
              onClick={() => cancelReceivable.mutate()}
            >
              {cancelReceivable.isPending ? "Cancelando…" : "Cancelar acordo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar o acordo de {deleteTarget?.name}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Somem juntos: o acordo, <strong>todas as parcelas</strong>, os recebimentos
                  estornados e os <strong>repasses</strong> ligados a ele.
                </p>
                {(deleteTarget?.paid ?? 0) > 0.01 && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 font-medium text-destructive">
                    Atenção: este acordo já recebeu{" "}
                    <span className="num">{money(deleteTarget?.paid ?? 0)}</span>. Esse dinheiro
                    sai do Fluxo de Caixa junto, e o saldo das contas muda na hora — inclusive de
                    meses já fechados.
                  </p>
                )}
                <p>
                  Não dá para desfazer. Fica o registro completo na auditoria, com todos os
                  valores.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteReceivable.isPending}
              onClick={() => deleteReceivable.mutate()}
            >
              {deleteReceivable.isPending ? "Apagando…" : "Apagar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
