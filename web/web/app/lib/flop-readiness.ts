export const FLOP_TEASER_URL = "https://flop.finance/teaser/#04-testnet-and-airdrop";
export const MAX_DEVELOPMENT_INFERENCE_RECORDS = 200;

export type DevelopmentInferenceUsage = {
  id: string;
  generated_at_utc: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  scope: "off_network_development";
};

export type DevelopmentInferenceSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function safeText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ").slice(0, maximum) : "";
}

function safeTokenCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function inferenceActivityKey(did: string): string {
  return `neoncore:development-inference:${did}`;
}

export function parseDevelopmentInference(value: string | null): DevelopmentInferenceUsage[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): DevelopmentInferenceUsage[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const id = safeText(record.id, 160);
      const generatedAt = safeText(record.generated_at_utc, 40);
      const model = safeText(record.model, 100);
      const inputTokens = safeTokenCount(record.input_tokens);
      const outputTokens = safeTokenCount(record.output_tokens);
      const statedTotal = safeTokenCount(record.total_tokens);
      if (!id || !generatedAt || !model || record.scope !== "off_network_development") return [];
      return [{
        id,
        generated_at_utc: generatedAt,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: Math.max(statedTotal, inputTokens + outputTokens),
        scope: "off_network_development",
      }];
    }).slice(0, MAX_DEVELOPMENT_INFERENCE_RECORDS);
  } catch {
    return [];
  }
}

export function addDevelopmentInference(
  entries: DevelopmentInferenceUsage[],
  entry: DevelopmentInferenceUsage,
): DevelopmentInferenceUsage[] {
  return [entry, ...entries.filter((item) => item.id !== entry.id)].slice(0, MAX_DEVELOPMENT_INFERENCE_RECORDS);
}

export function summarizeDevelopmentInference(entries: DevelopmentInferenceUsage[]): DevelopmentInferenceSummary {
  return entries.reduce<DevelopmentInferenceSummary>((summary, entry) => ({
    calls: summary.calls + 1,
    inputTokens: summary.inputTokens + entry.input_tokens,
    outputTokens: summary.outputTokens + entry.output_tokens,
    totalTokens: summary.totalTokens + entry.total_tokens,
  }), { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

export function projectedAirdropUnlock(spend: number, lockedAllocation: number): number {
  const safeSpend = Number.isFinite(spend) ? Math.max(0, spend) : 0;
  const safeLocked = Number.isFinite(lockedAllocation) ? Math.max(0, lockedAllocation) : 0;
  return Math.min(safeLocked, safeSpend / 3);
}
