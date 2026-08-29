export const FLOP_TEASER_URL = "https://flop.finance/teaser/#04-testnet-and-airdrop";
export const FLOP_TEASER_UPDATED = "2026-08-26";
export const MAX_DEVELOPMENT_INFERENCE_RECORDS = 200;

export type TestnetSpendPlanInput = {
  faucetBalance: number;
  plannedSpend: number;
  averageSessionFee: number;
  campaignDays: number;
  lockedAllocation: number;
};

export type TestnetSpendPlanSummary = {
  dailySpendTarget: number;
  estimatedSessions: number;
  unusedFaucetBalance: number;
  unfundedSpend: number;
  unlockCapacity: number;
  projectedUnlock: number;
  additionalSpendToUnlockAllocation: number;
};

export type TestnetSessionDraftInput = {
  taskLabel: string;
  modelWeightsIndex: string;
  maximumLatencyMs: number;
  computeFlops: string;
  confidentiality: boolean;
  maximumFeeFlop: string;
};

export type TestnetSessionDraft = {
  schema_version: "neoncore.flop-session-draft.v1";
  network: "flop-testnet-unconfigured";
  scope: "draft_only_not_submitted";
  official_draft_updated: typeof FLOP_TEASER_UPDATED;
  owner_did: string;
  created_at_utc: string;
  task_label: string;
  request: {
    model_weights_index: string;
    maximum_latency_ms: number;
    compute_flops: string;
    confidentiality: boolean;
    maximum_fee_flop: string;
  };
};

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

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function requiredSingleLine(value: string, label: string, maximum: number): string {
  const text = value.trim();
  if (!text || text.length > maximum || /[\r\n]/.test(text)) throw new Error(`${label} is missing or invalid.`);
  return text;
}

function positiveDecimal(value: string, label: string): string {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text) || /^0(?:\.0+)?$/.test(text)) {
    throw new Error(`${label} must be a positive decimal value.`);
  }
  return text;
}

export const DEFAULT_TESTNET_SPEND_PLAN: TestnetSpendPlanInput = {
  faucetBalance: 900,
  plannedSpend: 900,
  averageSessionFee: 3,
  campaignDays: 90,
  lockedAllocation: 100,
};

export function testnetSpendPlanKey(did: string): string {
  return `neoncore:flop-testnet-plan:${did}`;
}

export function parseTestnetSpendPlan(value: string | null): TestnetSpendPlanInput {
  if (!value) return { ...DEFAULT_TESTNET_SPEND_PLAN };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      faucetBalance: boundedNumber(parsed.faucetBalance, DEFAULT_TESTNET_SPEND_PLAN.faucetBalance, 0, 1_000_000_000),
      plannedSpend: boundedNumber(parsed.plannedSpend, DEFAULT_TESTNET_SPEND_PLAN.plannedSpend, 0, 1_000_000_000),
      averageSessionFee: boundedNumber(parsed.averageSessionFee, DEFAULT_TESTNET_SPEND_PLAN.averageSessionFee, 0.000001, 1_000_000_000),
      campaignDays: Math.round(boundedNumber(parsed.campaignDays, DEFAULT_TESTNET_SPEND_PLAN.campaignDays, 1, 365)),
      lockedAllocation: boundedNumber(parsed.lockedAllocation, DEFAULT_TESTNET_SPEND_PLAN.lockedAllocation, 0, 1_000_000_000),
    };
  } catch {
    return { ...DEFAULT_TESTNET_SPEND_PLAN };
  }
}

export function calculateTestnetSpendPlan(input: TestnetSpendPlanInput): TestnetSpendPlanSummary {
  const faucetBalance = boundedNumber(input.faucetBalance, 0, 0, 1_000_000_000);
  const plannedSpend = boundedNumber(input.plannedSpend, 0, 0, 1_000_000_000);
  const averageSessionFee = boundedNumber(input.averageSessionFee, 0.000001, 0.000001, 1_000_000_000);
  const campaignDays = Math.round(boundedNumber(input.campaignDays, 90, 1, 365));
  const lockedAllocation = boundedNumber(input.lockedAllocation, 0, 0, 1_000_000_000);
  return {
    dailySpendTarget: plannedSpend / campaignDays,
    estimatedSessions: Math.floor(plannedSpend / averageSessionFee),
    unusedFaucetBalance: Math.max(0, faucetBalance - plannedSpend),
    unfundedSpend: Math.max(0, plannedSpend - faucetBalance),
    unlockCapacity: plannedSpend / 3,
    projectedUnlock: projectedAirdropUnlock(plannedSpend, lockedAllocation),
    additionalSpendToUnlockAllocation: Math.max(0, lockedAllocation * 3 - plannedSpend),
  };
}

export function createTestnetSessionDraft(
  ownerDid: string,
  input: TestnetSessionDraftInput,
  createdAtUtc = new Date().toISOString(),
): TestnetSessionDraft {
  if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(ownerDid)) throw new Error("Load a valid owner DID first.");
  const maximumLatencyMs = Number(input.maximumLatencyMs);
  if (!Number.isSafeInteger(maximumLatencyMs) || maximumLatencyMs < 1 || maximumLatencyMs > 86_400_000) {
    throw new Error("Maximum latency must be between 1 and 86400000 milliseconds.");
  }
  const computeFlops = input.computeFlops.trim();
  if (!/^[1-9]\d{0,77}$/.test(computeFlops)) throw new Error("Compute FLOPs must be a positive whole number.");
  return {
    schema_version: "neoncore.flop-session-draft.v1",
    network: "flop-testnet-unconfigured",
    scope: "draft_only_not_submitted",
    official_draft_updated: FLOP_TEASER_UPDATED,
    owner_did: ownerDid,
    created_at_utc: requiredSingleLine(createdAtUtc, "Creation time", 40),
    task_label: requiredSingleLine(input.taskLabel, "Task label", 120),
    request: {
      model_weights_index: requiredSingleLine(input.modelWeightsIndex, "Model weights index", 256),
      maximum_latency_ms: maximumLatencyMs,
      compute_flops: computeFlops,
      confidentiality: Boolean(input.confidentiality),
      maximum_fee_flop: positiveDecimal(input.maximumFeeFlop, "Maximum fee"),
    },
  };
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
