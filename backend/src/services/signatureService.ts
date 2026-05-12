import { randomBytes } from "node:crypto";

// Mock mode: all signing is fake — no EIP-712, no private key, no RPC needed.

export const SETTLEMENT_OUTCOME = {
  CASHED_OUT: 1,
  CRASHED: 2,
} as const;

type Hex = `0x${string}`;
type Address = `0x${string}`;

export interface ResolutionPayload {
  sessionId: Hex;
  player: Address;
  stakeAmount: bigint;
  payoutAmount: bigint;
  finalMultiplierBp: bigint;
  outcome: number;
  deadline: bigint;
}

export interface SignedSettlementResult {
  signature: Hex;
  resolution: {
    sessionId: Hex;
    player: Address;
    stakeAmount: string;
    payoutAmount: string;
    finalMultiplierBp: string;
    outcome: number;
    deadline: string;
  };
  signerAddress: Address;
}

export interface PassportClaimPayload {
  player: Address;
  tier: number;
  issuedAt: bigint;
  expiry: bigint;
  nonce: bigint;
}

export interface SignedPassportClaimResult {
  signature: Hex;
  claim: {
    player: Address;
    tier: number;
    issuedAt: string;
    expiry: string;
    nonce: string;
  };
  signerAddress: Address;
}

const MOCK_SIGNER = "0x000000000000000000000000000000000000dead" as Address;

function mockSignature(): Hex {
  return `0x${randomBytes(65).toString("hex")}` as Hex;
}

export function getSignerAddress(): Address {
  return MOCK_SIGNER;
}

export function generateOnchainSessionId(): Hex {
  return `0x${randomBytes(32).toString("hex")}` as Hex;
}

export function usdcToUint256(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export async function signSettlement(params: {
  playerAddress: string;
  onchainSessionId: string;
  stakeAmount: number;
  payoutAmount: number;
  finalMultiplierBp: number;
  outcome: number;
  deadline?: number;
}): Promise<SignedSettlementResult> {
  const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 86400;

  console.log(`🎭 Mock signSettlement: outcome=${params.outcome} stake=${params.stakeAmount} payout=${params.payoutAmount}`);

  return {
    signature: mockSignature(),
    resolution: {
      sessionId: params.onchainSessionId as Hex,
      player: params.playerAddress as Address,
      stakeAmount: usdcToUint256(params.stakeAmount).toString(),
      payoutAmount: usdcToUint256(params.payoutAmount).toString(),
      finalMultiplierBp: String(params.finalMultiplierBp),
      outcome: params.outcome,
      deadline: String(deadline),
    },
    signerAddress: MOCK_SIGNER,
  };
}

export async function signPassportClaim(params: {
  playerAddress: string;
  tier: number;
  issuedAt?: number;
  expiry?: number;
  nonce?: bigint;
}): Promise<SignedPassportClaimResult> {
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = params.issuedAt ?? now;
  const expiry = params.expiry ?? now + 2592000;
  const nonce = params.nonce ?? BigInt(`0x${randomBytes(32).toString("hex")}`);

  return {
    signature: mockSignature(),
    claim: {
      player: params.playerAddress as Address,
      tier: params.tier,
      issuedAt: String(issuedAt),
      expiry: String(expiry),
      nonce: nonce.toString(),
    },
    signerAddress: MOCK_SIGNER,
  };
}
