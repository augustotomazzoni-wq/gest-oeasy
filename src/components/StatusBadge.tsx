import { INSTALLMENT_STATUS_LABEL } from "@/lib/format";
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
