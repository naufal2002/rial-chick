import { randomBytes } from "node:crypto";

// Mock mode: no onchain submission — just return a fake tx hash.

type SettlementResolutionInput = {
  sessionId: string;
  player: string;
  stakeAmount: string | number | bigint;
  payoutAmount: string | number | bigint;
  finalMultiplierBp: string | number | bigint;
  outcome: string | number;
  deadline: string | number | bigint;
};

export function getSettlementRelayerAddress(): string {
  return "0x0000000000000000000000000000000000000000";
}

export async function submitSettlementOnchain(params: {
  resolution: SettlementResolutionInput;
  signature: string;
}): Promise<string> {
  console.log(`🎭 Mock settlement submitted (mock mode) — outcome=${params.resolution.outcome}`);
  return `0x${randomBytes(32).toString("hex")}`;
}
