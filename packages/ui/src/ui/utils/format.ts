/** Display helpers shared across UI components. */

export function formatUsd(amount: number, options?: { compact?: boolean; precision?: number }): string {
  const { compact, precision } = options ?? {};
  if (compact && amount >= 1000) {
    const formatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
    return `$${formatter.format(amount)}`;
  }
  const fractionDigits = precision ?? (amount < 1 ? 4 : 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatRelativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  const diff = (ts - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "ago" : "from now";

  if (abs < 60) return `${Math.round(abs)}s ${sign}`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ${sign}`;
  if (abs < 86_400) return `${Math.round(abs / 3600)}h ${sign}`;
  if (abs < 86_400 * 30) return `${Math.round(abs / 86_400)}d ${sign}`;
  return new Date(iso).toLocaleDateString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
