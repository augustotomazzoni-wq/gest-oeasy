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
  // Dinheiro que a cliente já recebeu por fora (FGTS liberado na conta
  // vinculada, alvará sacado direto). Só entra na base do percentual.
  fee_base_extra_amount: "",
  success_fee_amount: "",
  success_fee_included: false,
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
  // Sucumbência com cronograma próprio: a parte contrária paga direto ao
  // escritório, e quase nunca nas mesmas datas do acordo da cliente.
  success_separate: false,
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
    "success_fee_included",
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
    "success_separate",
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
  // Valor que a cliente recebeu direto — FGTS liberado na conta vinculada,
  // alvará sacado por ela. O contrato cobra o percentual sobre ele, mas o
  // dinheiro nunca passa por aqui: fica fora do bruto, do cronograma, do caixa
  // e do repasse. Só engorda a base do percentual, e o honorário a mais sai da
  // parte que a cliente receberia do que transita.
  const feeBaseExtra = isServiceFee ? 0 : num(Number(form.fee_base_extra_amount));
  const feeBase = gross + feeBaseExtra;
  const feePercentValue = form.fee_percent ? num(Number(form.fee_percent)) : 0;
  const feeFromPercent = form.fee_percent ? (feeBase * feePercentValue) / 100 : 0;
  // Quanto do honorário vem do valor recebido direto — só para mostrar na
  // tela; a conta em si já está no feeFromPercent.
  const feeOverExtra = form.fee_percent ? (feeBaseExtra * feePercentValue) / 100 : 0;
  const contractualFee = isServiceFee
    ? gross
    : form.fee_percent
      ? feeFromPercent
      : num(Number(form.fee_fixed_amount));
  const successFee = isServiceFee ? 0 : num(Number(form.success_fee_amount));
  const costs = isServiceFee ? 0 : num(Number(form.cost_reimbursement));
  // A sucumbência é paga pela parte perdedora, então às vezes vem por fora do
  // valor do acordo e às vezes já está embutida nele. Quem cadastra informa
  // qual é o caso — antes o sistema sempre assumia "por fora" em silêncio, e o
  // cronograma somava mais que o valor bruto sem explicar o motivo.
  const successInsideGross = form.success_fee_included;
  const suggestedFirm = contractualFee + successFee;
  const suggestedClient = Math.max(
    gross - contractualFee - costs - (successInsideGross ? successFee : 0),
    0,
  );
  // Quanto o cronograma inteiro deve somar. Na conta normal isso dá exatamente
  // o valor bruto (mais a sucumbência, quando ela vem por fora), porque o
  // honorário sai de dentro da parte da cliente. Quando o honorário passa do
  // que transita — acordo pequeno com FGTS grande recebido direto — a cliente
  // fica devendo a diferença, e o total sobe junto.
  const expectedGrossTotal = round2(suggestedFirm + suggestedClient + costs);
  // Só o dinheiro que transita — é o que o resumo mostra como "bruto +
  // sucumbência". Fica separado do total acima porque o honorário sobre o
  // valor recebido direto pode fazer o total passar do que transita.
  const grossPlusSuccess = round2(gross + (successInsideGross ? 0 : successFee));
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
  const clientNoCronograma = parteDaClienteForaDoCronograma ? 0 : client;

  // Sucumbência com datas próprias só faz sentido quando existe sucumbência e
  // ela não está embutida no valor do acordo.
  const successSeparated = form.success_separate && successFee > 0.01 && !isServiceFee;
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
    const expectedTotal = firm + clientNoCronograma + costs;
    const entry = num(Number(form.entry_amount));
    if (form.has_entry && entry <= 0) errors.push("Informe um valor de entrada maior que zero.");
    if (form.has_entry && entry - expectedTotal > 0.01)
      errors.push("A entrada não pode ser maior que o total a receber.");
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

    if (Math.abs(scheduleTotals.gross - expectedTotal) > tolTotal)
      errors.push(
        `As parcelas somam ${money(scheduleTotals.gross)} e o total a receber é ` +
          `${money(expectedTotal)} — ${faltaOuSobra(scheduleTotals.gross, expectedTotal)} no cronograma.`,
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
    // Quando a parte da cliente não passa pelo escritório — ela recebendo
    // direto ou o recebimento sendo dividido — o cronograma vale menos que o
    // acordo de propósito, e a conferência com o valor bruto não se aplica.
    if (
      !parteDaClienteForaDoCronograma &&
      gross > 0 &&
      Math.abs(expectedTotal - expectedGrossTotal) > tolTotal
    )
      errors.push(
        `O total distribuído (${money(expectedTotal)}) não fecha com o valor bruto` +
          `${successInsideGross ? "" : " + sucumbência"}` +
          `${feeBaseExtra > 0.01 ? " + honorário sobre o valor recebido direto" : ""}` +
          ` (${money(expectedGrossTotal)}) — ` +
          `${faltaOuSobra(expectedTotal, expectedGrossTotal)} na divisão entre escritório e cliente.`,
      );
    return [...new Set(errors)];
  }, [
    clientNoCronograma,
    parteDaClienteForaDoCronograma,
    costs,
    feeBaseExtra,
    firm,
    gross,
    mainFirm,
    recebimentoDividido,
    expectedGrossTotal,
    successInsideGross,
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
        _fee_base_extra_amount: feeBaseExtra,
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
    },
    onSuccess: () => {
      toast.success("Acordo atualizado.");
      setEditTarget(null);
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
                                  success_fee_included: false,
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
                        Dinheiro que a cliente sacou sozinha e nunca passa pelo escritório. Entra só
                        na base do percentual de honorários — fica fora do valor bruto, do
                        cronograma, do caixa e do repasse.
                      </p>
                      {feeBaseExtra > 0 && !form.fee_percent && (
                        <p className="text-xs text-warning">
                          Sem % de honorários este valor não muda nada: informe o percentual, ou
                          cobre o honorário pelo campo de valor fixo.
                        </p>
                      )}
                      {feeBaseExtra > 0 && !!form.fee_percent && (
                        <p className="text-xs text-info">
                          Base do percentual: {money(gross)} + {money(feeBaseExtra)} ={" "}
                          <strong className="num">{money(feeBase)}</strong> → honorários de{" "}
                          <strong className="num">{money(feeFromPercent)}</strong>, sendo{" "}
                          <strong className="num">{money(feeOverExtra)}</strong> por conta do valor
                          recebido direto.
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
                      {successFee > 0 && (
                        <label className="flex items-start gap-2 pt-1 text-xs">
                          <Checkbox
                            checked={form.success_fee_included}
                            onCheckedChange={(v) =>
                              updateForm({ success_fee_included: v === true })
                            }
                          />
                          <span className="text-muted-foreground">
                            A sucumbência já está dentro do valor bruto.
                            <span className="mt-0.5 block">
                              {form.success_fee_included
                                ? `Total a distribuir: ${money(gross)}.`
                                : `Por fora — total a distribuir: ${money(gross + successFee)}.`}
                            </span>
                          </span>
                        </label>
                      )}
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
                              {successFee > 0 && !successInsideGross && (
                                <>
                                  {" "}
                                  A sucumbência de{" "}
                                  <strong className="num text-foreground">{money(successFee)}</strong>{" "}
                                  é paga pela empresa — marque a opção abaixo para ela virar
                                  parcelas próprias.
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

                        {/* Caso comum: a cliente recebe o acordo e repassa a
                            parte do escritório, enquanto a sucumbência é paga
                            direto pela parte contrária — em datas próprias. */}
                        {successFee > 0 && !isServiceFee && (
                          <div className="rounded-md border border-border p-3">
                            <label className="flex items-start gap-2 text-sm">
                              <Checkbox
                                checked={form.success_separate}
                                onCheckedChange={(v) =>
                                  updateForm({ success_separate: v === true })
                                }
                              />
                              <span>
                                A sucumbência é paga direto pela parte contrária, em datas
                                próprias
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  Gera parcelas separadas para os {money(successFee)} de
                                  sucumbência. O cronograma do acordo fica só com o que passa
                                  pela cliente.
                                </span>
                              </span>
                            </label>

                            {form.success_separate && (
                              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                <div className="space-y-2">
                                  <Label htmlFor="spar">Parcelas da sucumbência</Label>
                                  <Input
                                    id="spar"
                                    type="number"
                                    min="1"
                                    value={form.success_parcels}
                                    onChange={(e) =>
                                      updateForm({ success_parcels: e.target.value })
                                    }
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
                            )}
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
                          {successFee > 0 &&
                            (successInsideGross ? (
                              <> — sucumbência de {money(successFee)} já incluída.</>
                            ) : (
                              <>
                                {" "}
                                + sucumbência de {money(successFee)} por fora ={" "}
                                <strong className="num text-foreground">
                                  {money(grossPlusSuccess)}
                                </strong>
                                .
                              </>
                            ))}
                        </p>
                      )}
                      {feeBaseExtra > 0 && (
                        <p className="mb-3 border-b border-border pb-3 text-xs text-muted-foreground">
                          A cliente recebeu{" "}
                          <strong className="num text-foreground">{money(feeBaseExtra)}</strong>{" "}
                          direto. Isso só aumentou a base dos honorários (
                          <strong className="num text-foreground">{money(feeBase)}</strong>
                          {feeOverExtra > 0 && <> — {money(feeOverExtra)} a mais de honorário</>}).
                          O valor em si não entra no cronograma, no caixa nem no repasse.
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

      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar acordo</DialogTitle>
            <DialogDescription>
              {editTarget?.name} — o que já foi recebido não pode ser desfeito por aqui: os
              valores esperados não podem ficar abaixo do que já entrou. Para mexer no que já foi
              pago, estorne o recebimento antes.
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
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground sm:col-span-2">
              Editar aqui muda o acordo, não o cronograma já gerado. As parcelas continuam como
              estão — ajuste-as em Parcelas e Recebimentos se os valores mudaram.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
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
