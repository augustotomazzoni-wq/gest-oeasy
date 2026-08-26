import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { money, dateBR, num, todayISO } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { parseWorkbook, matchKey, type ParsedWorkbook } from "@/lib/import-xlsx";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/importar")({
  head: () => ({
    meta: [
      { title: "Importar Planilha | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Importe a planilha de controle de recebíveis: clientes, acordos, parcelas e recebimentos já quitados.",
      },
      { property: "og:title", content: "Importar planilha de recebíveis" },
      {
        property: "og:description",
        content: "Migração da planilha Excel para o sistema financeiro do escritório.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportarPage,
});

function ImportarPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [log, setLog] = useState<string[]>([]);

  async function onFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const result = parseWorkbook(buf);
      setParsed(result);
      setFileName(file.name);
      setLog([]);
      toast.success(
        `Planilha lida: ${result.clients.length} clientes e ${result.installments.length} parcelas.`,
      );
    } catch (e) {
      toast.error("Não foi possível ler a planilha", {
        description: (e as Error).message,
      });
    }
  }

  const run = useMutation({
    mutationFn: async () => {
      if (!parsed || !profile) throw new Error("Nenhuma planilha carregada");
      const org = profile.organization_id;
      const messages: string[] = [];

      const { data: existing } = await supabase
        .from("clients")
        .select("id, name")
        .is("deleted_at", null);
      const seenPerClient = new Map<string, number>();
      const clientIds = new Map((existing ?? []).map((c) => [matchKey(c.name), c.id] as const));

      for (const c of parsed.clients) {
        const key = matchKey(c.name);
        let clientId = clientIds.get(key);
        if (!clientId) {
          const { data, error } = await supabase
            .from("clients")
            .insert({
              organization_id: org,
              created_by: profile.id,
              name: c.name,
              notes: c.notes,
            })
            .select("id")
            .single();
          if (error) throw new Error(`Cliente ${c.name}: ${friendlyError(error)}`);
          clientId = data.id;
          clientIds.set(key, clientId);
        }

        // Identifica a linha da planilha para que um cliente com mais de um
        // acordo não seja confundido com uma reimportação. Antes a checagem
        // era só por cliente, então o segundo acordo era descartado.
        const rowIndex = (seenPerClient.get(key) ?? 0) + 1;
        seenPerClient.set(key, rowIndex);
        const importTag = c.case_number?.trim() || c.opposing_party?.trim() || `linha ${rowIndex}`;
        const importDescription = `Importado da planilha de controle — ${importTag}`;

        // Se uma importação anterior falhou no meio do caminho, este acordo
        // pode já existir — pula para não duplicar parcelas e recebimentos.
        const { data: alreadyImported } = await supabase
          .from("legal_receivables")
          .select("id")
          .eq("client_id", clientId)
          .eq("description", importDescription)
          .is("deleted_at", null)
          .maybeSingle();
        if (alreadyImported) {
          messages.push(
            `${c.name} (${importTag}): já importado anteriormente — pulado para evitar duplicidade.`,
          );
          continue;
        }

        let caseId: string | null = null;
        if (c.case_number || c.opposing_party) {
          const { data: existingCase } = await supabase
            .from("cases")
            .select("id")
            .eq("client_id", clientId)
            .eq("case_number", c.case_number ?? "")
            .is("deleted_at", null)
            .maybeSingle();
          if (existingCase) caseId = existingCase.id;
          else {
            const { data, error } = await supabase
              .from("cases")
              .insert({
                organization_id: org,
                created_by: profile.id,
                client_id: clientId,
                case_number: c.case_number,
                opposing_party: c.opposing_party,
              })
              .select("id")
              .single();
            if (error) throw new Error(`Processo de ${c.name}: ${friendlyError(error)}`);
            caseId = data.id;
          }
        }

        const gross = c.gross_amount ?? c.firm_amount;
        const clientShare = c.gross_amount ? Math.max(c.gross_amount - c.firm_amount, 0) : 0;

        const { data: recv, error: rErr } = await supabase
          .from("legal_receivables")
          .insert({
            organization_id: org,
            created_by: profile.id,
            client_id: clientId,
            case_id: caseId,
            type: c.type as never,
            status: c.status as never,
            is_estimated: c.is_estimated,
            gross_amount: gross,
            fee_percent: c.fee_percent,
            expected_firm_amount: c.firm_amount,
            expected_client_amount: clientShare,
            notes: c.notes,
            description: importDescription,
          })
          .select("id")
          .single();
        if (rErr) throw new Error(`Acordo de ${c.name}: ${friendlyError(rErr)}`);

        // A aba de parcelas só identifica o cliente, não o acordo. Quando o
        // mesmo cliente tem mais de um acordo na planilha, não há como saber a
        // qual deles cada parcela pertence — então as parcelas vão para o
        // primeiro acordo e o aviso abaixo pede a conferência manual.
        const rows =
          rowIndex === 1 ? parsed.installments.filter((i) => matchKey(i.client) === key) : [];
        if (rowIndex > 1 && parsed.installments.some((i) => matchKey(i.client) === key)) {
          messages.push(
            `${c.name} (${importTag}): 2º acordo do mesmo cliente — as parcelas da planilha ficaram no primeiro acordo. Confira e mova as que forem deste.`,
          );
        }
        const list = rows.length
          ? rows
          : c.firm_amount > 0
            ? [
                {
                  client: c.name,
                  number: 1,
                  total_count: 1,
                  due_date: null,
                  firm_amount: c.firm_amount,
                  paid: c.already_received >= c.firm_amount && c.firm_amount > 0,
                  received_on: null,
                  status: null,
                  notes: null,
                },
              ]
            : [];

        for (const p of list) {
          const { data: inst, error: iErr } = await supabase
            .from("installments")
            .insert({
              organization_id: org,
              created_by: profile.id,
              receivable_id: recv.id,
              number: p.number,
              total_count: p.total_count,
              due_date: p.due_date,
              gross_amount: p.firm_amount,
              fee_amount: p.firm_amount,
              client_amount: 0,
              notes: p.notes,
            })
            .select("id")
            .single();
          if (iErr) throw new Error(`Parcela de ${c.name}: ${friendlyError(iErr)}`);

          if (p.paid && p.firm_amount > 0) {
            // O valor importado é 100% honorário do escritório e entrou na
            // conta dele. Os campos de destino precisam ser informados
            // explicitamente: sem eles o banco rejeita o lançamento, porque
            // amount_received_in_firm_account (padrão 0) tem que bater com a
            // soma dos honorários.
            const { error: pErr } = await supabase.from("receipts").insert({
              organization_id: org,
              created_by: profile.id,
              installment_id: inst.id,
              received_on: p.received_on ?? p.due_date ?? todayISO(),
              total_amount: p.firm_amount,
              fee_amount: p.firm_amount,
              client_amount: 0,
              receipt_destination: "conta_escritorio",
              amount_received_in_firm_account: p.firm_amount,
              client_amount_received_by_firm: 0,
              client_amount_received_direct: 0,
              notes: "Importado da planilha",
            });
            if (pErr) throw new Error(`Recebimento de ${c.name}: ${friendlyError(pErr)}`);
          }
        }

        messages.push(`${c.name}: acordo importado com ${list.length} parcela(s).`);
      }

      await supabase.from("audit_logs").insert({
        organization_id: org,
        user_id: profile.id,
        user_email: profile.email,
        action: "importar_planilha",
        table_name: "legal_receivables",
        new_values: {
          arquivo: fileName,
          clientes: parsed.clients.length,
          parcelas: parsed.installments.length,
        },
      });

      return messages;
    },
    onSuccess: (messages) => {
      setLog(messages);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Importação concluída.");
      void qc.invalidateQueries();
    },
    onError: (e: Error) =>
      toast.error("Importação interrompida", { description: friendlyError(e) }),
  });

  const totalFirm = (parsed?.clients ?? []).reduce((s, c) => s + num(c.firm_amount), 0);
  const totalReceived = (parsed?.clients ?? []).reduce((s, c) => s + num(c.already_received), 0);

  return (
    <>
      <PageHeader
        title="Importar Planilha"
        description="Leia a planilha de controle de recebíveis e traga clientes, acordos, parcelas e recebimentos."
      />

      <div className="panel mb-4 p-4">
        <Input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          disabled={!canWrite}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Formato esperado: aba "Clientes" e aba "Parcelas a Receber", com os mesmos cabeçalhos da
          planilha atual. Nada é gravado até você confirmar.
        </p>
      </div>

      {parsed && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <div className="panel p-4">
              <p className="text-xs text-muted-foreground uppercase">Clientes</p>
              <p className="num mt-1 text-2xl font-semibold">{parsed.clients.length}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs text-muted-foreground uppercase">Parcelas</p>
              <p className="num mt-1 text-2xl font-semibold">{parsed.installments.length}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs text-muted-foreground uppercase">Total do escritório</p>
              <p className="num mt-1 text-2xl font-semibold">{money(totalFirm)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs text-muted-foreground uppercase">Já recebido</p>
              <p className="num mt-1 text-2xl font-semibold text-success">{money(totalReceived)}</p>
            </div>
          </div>

          {parsed.warnings.length > 0 && (
            <div className="panel mb-4 border-warning/40 p-4">
              <h2 className="font-display text-sm font-semibold">Avisos</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {parsed.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel mb-4 overflow-x-auto">
            <div className="border-b border-border p-3">
              <h2 className="font-display text-sm font-semibold">Prévia — clientes e acordos</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="p-3">Cliente</th>
                  <th>Tipo</th>
                  <th>Situação</th>
                  <th className="text-right">Bruto</th>
                  <th className="text-right">Escritório</th>
                  <th className="p-3 text-right">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {parsed.clients.map((c) => (
                  <tr key={c.name} className="border-b border-border/60 last:border-0">
                    <td className="p-3">
                      <span className="font-medium">{c.name}</span>
                      {c.case_number && (
                        <span className="block text-xs text-muted-foreground">{c.case_number}</span>
                      )}
                    </td>
                    <td>{c.type}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Tag>{c.status}</Tag>
                        {c.is_estimated && <Tag tone="warning">Estimado</Tag>}
                      </div>
                    </td>
                    <td className="num text-right">{money(c.gross_amount ?? 0)}</td>
                    <td className="num text-right">{money(c.firm_amount)}</td>
                    <td className="num p-3 text-right">{money(c.already_received)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel mb-4 max-h-96 overflow-auto">
            <div className="border-b border-border p-3">
              <h2 className="font-display text-sm font-semibold">Prévia — parcelas</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="p-3">Cliente</th>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th className="text-right">Valor nosso</th>
                  <th className="p-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {parsed.installments.map((p, i) => (
                  <tr
                    key={`${p.client}-${p.number}-${i}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="p-3">{p.client}</td>
                    <td>
                      {p.number}/{p.total_count}
                    </td>
                    <td>{dateBR(p.due_date)}</td>
                    <td className="num text-right">{money(p.firm_amount)}</td>
                    <td className="p-3">
                      <Tag tone={p.paid ? "success" : "neutral"}>
                        {p.paid ? "Paga" : (p.status ?? "Em aberto")}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run.mutate()} disabled={run.isPending || !canWrite}>
              {run.isPending ? "Importando…" : "Confirmar importação"}
            </Button>
            <Button variant="outline" onClick={() => setParsed(null)}>
              Descartar
            </Button>
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="panel mt-4 p-4">
          <h2 className="font-display text-sm font-semibold">Resultado da importação</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {log.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
