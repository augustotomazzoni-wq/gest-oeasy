import {
  INSTALLMENT_STATUS_LABEL,
  RECEIVABLE_STATUS_LABEL,
  TRANSFER_STATUS_LABEL,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  PAGA: "bg-success/12 text-success border-success/30",
  PARCIAL: "bg-info/12 text-info border-info/30",
  VENCE_HOJE: "bg-warning/16 text-warning-foreground border-warning/40",
  ATRASADA: "bg-destructive/12 text-destructive border-destructive/30",
  A_VENCER: "bg-muted text-muted-foreground border-border",
  A_DEFINIR: "bg-secondary text-secondary-foreground border-border",
  CANCELADA: "bg-muted text-muted-foreground border-border line-through",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {INSTALLMENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

// Uma única tabela cor↔status por domínio, para que "confirmado", "pago" etc.
// tenham sempre a mesma cor em qualquer tela do sistema.
const RECEIVABLE_TONE: Record<string, Tone> = {
  rascunho: "neutral",
  estimado: "warning",
  confirmado: "success",
  em_pagamento: "info",
  em_execucao: "info",
  encerrado: "neutral",
  cancelado: "danger",
};

const TRANSFER_TONE: Record<string, Tone> = {
  pendente: "warning",
  agendado: "info",
  pago: "success",
  cancelado: "neutral",
};

export function receivableStatusTone(status: string): Tone {
  return RECEIVABLE_TONE[status] ?? "neutral";
}

export function transferStatusTone(status: string): Tone {
  return TRANSFER_TONE[status] ?? "neutral";
}

export function ReceivableStatusTag({ status }: { status: string }) {
  return <Tag tone={receivableStatusTone(status)}>{RECEIVABLE_STATUS_LABEL[status] ?? status}</Tag>;
}

export function TransferStatusTag({ status }: { status: string }) {
  return <Tag tone={transferStatusTone(status)}>{TRANSFER_STATUS_LABEL[status] ?? status}</Tag>;
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const tones = {
    neutral: "bg-secondary text-secondary-foreground border-border",
    success: "bg-success/12 text-success border-success/30",
    warning: "bg-warning/16 text-warning-foreground border-warning/40",
    danger: "bg-destructive/12 text-destructive border-destructive/30",
    info: "bg-info/12 text-info border-info/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
