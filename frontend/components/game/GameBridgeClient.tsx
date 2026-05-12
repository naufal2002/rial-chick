"use client";

// Mock mode: all onchain/wagmi calls removed.
// startBet, cashOut, crash → pure WebSocket to backend.
// Balance is read from /auth/me (backend database).

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { isAddress } from "viem";
import { useWallet } from "../web3/WalletProvider";
import { backendPost, backendFetch } from "../../lib/backend/api";
import { BACKEND_API_URL, hasBackendApiConfig } from "../../lib/backend/config";
import {
  readRawErrorMessage,
  toUserFacingWalletError,
} from "../../lib/errors";

type GameBridgeClientProps = {
  backgroundMode?: boolean;
};

type StartedPayload = {
  sessionId: string;
  onchainSessionId: string;
  stake: number;
  stakeAmountUnits: string;
};

type SettlementPayload = {
  sessionId: string;
  onchainSessionId: string;
  settlementTxHash?: string;
  settlementSignature?: string;
  signature?: string;
  resolution?: ChickenBridgeSettlementResolution;
  payload?: ChickenBridgeSettlementResolution;
  multiplier?: string;
  payoutAmount?: string;
  profit?: string;
  reason?: string;
};

type ReconnectedPayload = {
  sessionId: string;
  onchainSessionId: string;
  stake: number;
  stakeAmountUnits: string;
  row: number;
  maxRow: number;
  multiplierBp: number;
  multiplier: string;
  cp: number;
  cashoutWindow: boolean;
  segmentRemainingMs: number;
  cpStayRemainingMs: number;
  decayBp: number;
  serverTime: number;
};

type ActiveBackendSessionPayload = {
  hasActiveGame: boolean;
  session?: {
    session_id?: string;
    onchain_session_id?: string;
    stake_amount?: number | string;
    created_at?: string;
  } | null;
};

type PendingResolver<T> = {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

const RESPONSE_TIMEOUT_MS = 45_000;
const RECONNECT_GRACE_TIMEOUT_MS = 32_000;
const ACTIVE_SESSION_CACHE_MS = 2500;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

function normalizeError(error: unknown, fallback: string) {
  return readRawErrorMessage(error, fallback);
}

function rejectPendingRequest<T>(
  pending: PendingResolver<T> | null,
  message: string,
) {
  if (!pending) return;
  window.clearTimeout(pending.timeoutId);
  pending.reject(new Error(message));
}

export function GameBridgeClient({
  backgroundMode = false,
}: GameBridgeClientProps) {
  const {
    account,
    isBackendAuthenticated,
    hasBackendApiConfig: hasBackendConfig,
    ensureBackendSession,
    refreshBackendSession,
  } = useWallet();

  const socketRef = useRef<Socket | null>(null);
  const activeSessionIdRef = useRef<string>("");
  const pendingStartRef = useRef<PendingResolver<StartedPayload> | null>(null);
  const pendingCashoutRef = useRef<PendingResolver<SettlementPayload> | null>(null);
  const pendingCrashRef = useRef<PendingResolver<SettlementPayload> | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const activeSessionCacheRef = useRef<{
    address: string | null;
    value: string;
    fetchedAt: number;
  }>({ address: null, value: ZERO_BYTES32, fetchedAt: 0 });

  useEffect(() => {
    if (backgroundMode) return;
    document.documentElement.classList.add("play-scroll-lock");
    document.body.classList.add("play-scroll-lock");
    return () => {
      document.documentElement.classList.remove("play-scroll-lock");
      document.body.classList.remove("play-scroll-lock");
    };
  }, [backgroundMode]);

  useEffect(() => {
    if (backgroundMode) {
      window.__CHICKEN_MONAD_BRIDGE__ = {
        backgroundMode: true,
        loadAvailableBalance: async () => 0,
        loadDepositBalances: async () => ({
          walletBalance: 0,
          availableBalance: 0,
          lockedBalance: 0,
          allowance: 0,
        }),
        loadLeaderboard: async () => ({ leaderboard: [], walletAddress: "" }),
        loadPlayerStats: async () => ({
          wallet_address: "",
          total_games: 0,
          total_wins: 0,
          total_losses: 0,
          total_profit: 0,
          created_at: null,
        }),
        loadGameHistory: async (limit = 3) => ({ sessions: [], total: 0, limit, offset: 0 }),
        loadPlayerTransactions: async (limit = 3) => ({ transactions: [], total: 0, limit, offset: 0 }),
        getWalletAddress: () => "",
        openDeposit: (presetAmount?: number) => {
          window.dispatchEvent(new CustomEvent("chicken:open-deposit-modal", { detail: { amount: presetAmount } }));
        },
        claimFaucet: async () => { throw new Error("Background mode does not support faucet claim."); },
        depositToVault: async () => { throw new Error("Background mode does not support deposit."); },
        startBet: async () => { throw new Error("Background mode does not support start bet."); },
        sendMove: () => {},
        cashOut: async () => { throw new Error("Background mode does not support cash out."); },
        crash: async () => null,
        autoSettlePending: async () => false,
        getPlayBlocker: async () => ({ kind: "none" }),
        resolvePlayBlocker: async () => false,
        getPassportStatus: async () => ({
          walletAddress: "",
          eligibility: { eligible: false, tier: 0, reason: "Background mode.", stats: { runsEvaluated: 0, bestHops: 0, averageHops: 0 } },
          passport: { configured: false, valid: false, tier: 0, issuedAt: 0, expiry: 0, revoked: false },
        }),
        claimPassport: async () => { throw new Error("Background mode does not support passport claim."); },
      };
      return () => { delete window.__CHICKEN_MONAD_BRIDGE__; };
    }

    // ─── Socket setup ──────────────────────────────────────────────────
    function ensureSocket() {
      if (socketRef.current) return socketRef.current;

      if (!hasBackendApiConfig() || !BACKEND_API_URL) {
        throw new Error("NEXT_PUBLIC_BACKEND_API_URL is not set.");
      }

      const socket = io(BACKEND_API_URL, {
        withCredentials: true,
        transports: ["websocket", "polling"],
      });

      socket.on("game:started", (payload: StartedPayload) => {
        const pending = pendingStartRef.current;
        if (!pending) return;
        pendingStartRef.current = null;
        window.clearTimeout(pending.timeoutId);
        emitPlayBlocker({ kind: "none" });
        pending.resolve(payload);
      });

      socket.on("game:reconnected", (payload: ReconnectedPayload) => {
        const expectedSessionId = activeSessionIdRef.current;
        if (expectedSessionId && payload.sessionId !== expectedSessionId) return;

        if (reconnectTimeoutRef.current) {
          window.clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        activeSessionIdRef.current = payload.sessionId;
        emitPlayBlocker({ kind: "none" });
        window.dispatchEvent(new CustomEvent("chicken:game-reconnected", { detail: payload }));
      });

      socket.on("game:cashout_result", (payload: SettlementPayload) => {
        const pending = pendingCashoutRef.current;
        if (!pending) return;
        pendingCashoutRef.current = null;
        window.clearTimeout(pending.timeoutId);
        pending.resolve(payload);
      });

      socket.on("game:crashed", (payload: SettlementPayload) => {
        const pending = pendingCrashRef.current;
        if (pending) {
          pendingCrashRef.current = null;
          window.clearTimeout(pending.timeoutId);
          pending.resolve(payload);
        } else {
          // Server-initiated crash (decay_timeout, speedhack, etc.) — no pending promise
          activeSessionIdRef.current = "";
          void refreshPlayBlockerStatus();
          window.dispatchEvent(new CustomEvent("chicken:server-crash", { detail: payload }));
        }
      });

      socket.on("game:start_aborted", (payload: { message?: string }) => {
        activeSessionIdRef.current = "";
        const message = payload?.message || "startSession failed. Please start the bet again.";
        void refreshPlayBlockerStatus();
        window.dispatchEvent(new CustomEvent("chicken:start-bet-failed", { detail: { message } }));
      });

      socket.on("game:error", (payload: { message?: string }) => {
        const message = toUserFacingWalletError(payload?.message || "", "Backend game error.");
        rejectPendingRequest(pendingStartRef.current, message);
        rejectPendingRequest(pendingCashoutRef.current, message);
        rejectPendingRequest(pendingCrashRef.current, message);
        pendingStartRef.current = null;
        pendingCashoutRef.current = null;
        pendingCrashRef.current = null;
        window.dispatchEvent(new CustomEvent("chicken:game-error", { detail: { message } }));
      });

      socket.on("error", (payload: { message?: string } | string) => {
        const message = toUserFacingWalletError(
          typeof payload === "string" ? payload : payload?.message || "",
          "Socket error from backend.",
        );
        const hadPending = Boolean(pendingStartRef.current || pendingCashoutRef.current || pendingCrashRef.current);
        rejectPendingRequest(pendingStartRef.current, message);
        rejectPendingRequest(pendingCashoutRef.current, message);
        rejectPendingRequest(pendingCrashRef.current, message);
        pendingStartRef.current = null;
        pendingCashoutRef.current = null;
        pendingCrashRef.current = null;
        if (hadPending) {
          window.dispatchEvent(new CustomEvent("chicken:game-error", { detail: { message } }));
        } else {
          console.warn("⚠️ Ignored transient socket error:", message);
        }
      });

      socket.on("disconnect", (reason) => {
        if (reconnectTimeoutRef.current) {
          window.clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        const message = reason === "io server disconnect"
          ? "Socket was disconnected by server. Sign in again, then try starting bet."
          : `Socket disconnected: ${reason}`;

        rejectPendingRequest(pendingStartRef.current, message);
        rejectPendingRequest(pendingCashoutRef.current, message);
        rejectPendingRequest(pendingCrashRef.current, message);
        pendingStartRef.current = null;
        pendingCashoutRef.current = null;
        pendingCrashRef.current = null;

        if (!activeSessionIdRef.current) return;

        if (reason === "io server disconnect") {
          activeSessionIdRef.current = "";
          window.dispatchEvent(new CustomEvent("chicken:game-reconnect-expired", {
            detail: { message: "Failed to restore paused run. Sign in again and restart." },
          }));
          return;
        }

        window.dispatchEvent(new CustomEvent("chicken:game-disconnected", { detail: { message } }));

        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (!activeSessionIdRef.current) return;
          activeSessionIdRef.current = "";
          window.dispatchEvent(new CustomEvent("chicken:game-reconnect-expired", {
            detail: { message: "Connection lost for too long. The run ended and will sync when you start again." },
          }));
        }, RECONNECT_GRACE_TIMEOUT_MS);
      });

      socket.on("game:cp_expired", (payload: { message?: string }) => {
        window.dispatchEvent(new CustomEvent("chicken:cp-expired", { detail: { message: payload?.message || "" } }));
      });

      socketRef.current = socket;
      return socket;
    }

    async function waitForSocketReady(socket: Socket) {
      if (socket.connected) return;
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          socket.off("connect", onConnect);
          socket.off("connect_error", onError);
          reject(new Error("Socket connection timeout."));
        }, RESPONSE_TIMEOUT_MS);

        function onConnect() { window.clearTimeout(timeoutId); socket.off("connect_error", onError); resolve(); }
        function onError(error: Error) { window.clearTimeout(timeoutId); socket.off("connect", onConnect); reject(error); }

        socket.once("connect", onConnect);
        socket.once("connect_error", onError);
      });
    }

    function createPendingRequest<T>(ref: React.MutableRefObject<PendingResolver<T> | null>) {
      return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          ref.current = null;
          reject(new Error("Backend response timeout."));
        }, RESPONSE_TIMEOUT_MS);
        ref.current = { resolve, reject, timeoutId };
      });
    }

    function emitDepositProgress(phase: string, message?: string) {
      window.dispatchEvent(new CustomEvent("chicken:deposit-progress", { detail: { phase, message: message || "" } }));
    }

    function emitPlayBlocker(blocker: ChickenBridgePlayBlocker) {
      window.dispatchEvent(new CustomEvent("chicken:play-blocker", { detail: blocker }));
    }

    // ─── Auth helpers ──────────────────────────────────────────────────

    async function requireReadyGameWallet(): Promise<string> {
      if (!account || !isAddress(account)) {
        throw new Error("Login first before playing.");
      }
      if (!hasBackendConfig) {
        throw new Error("Frontend backend config is incomplete.");
      }
      const authOkay = await ensureBackendSession();
      if (!authOkay) {
        throw new Error("Backend session is not active yet. Login first.");
      }
      return account;
    }

    async function requireBackendWalletSession(): Promise<string> {
      if (!account || !isAddress(account)) {
        throw new Error("Login first to view player stats.");
      }
      if (!hasBackendConfig) {
        throw new Error("Frontend backend config is incomplete.");
      }
      const authOkay = await ensureBackendSession();
      if (!authOkay) {
        throw new Error("Backend session is not active yet. Login and try again.");
      }
      return account;
    }

    // ─── Backend session fetchers ──────────────────────────────────────

    async function fetchActiveBackendSession(): Promise<ActiveBackendSessionPayload> {
      try {
        return await backendFetch<ActiveBackendSessionPayload>("/api/game/active");
      } catch (err) {
        console.error("❌ Failed to fetch active session:", err);
        return { hasActiveGame: false, session: null };
      }
    }

    async function fetchPendingSettlements() {
      try {
        return await backendFetch<{ hasPending: boolean; pendingSettlements: any[] }>("/api/game/pending-settlement");
      } catch (err) {
        console.error("❌ Failed to fetch pending settlement:", err);
        return { hasPending: false, pendingSettlements: [] };
      }
    }

    // ─── Balance helper ────────────────────────────────────────────────

    async function fetchBalance(): Promise<number> {
      try {
        const me = await backendFetch<{ balance?: number }>("/auth/me");
        return Number(me.balance ?? 0);
      } catch {
        return 0;
      }
    }

    // ─── Play blocker ──────────────────────────────────────────────────

    async function getPlayBlocker(): Promise<ChickenBridgePlayBlocker> {
      if (!account || !isAddress(account) || !hasBackendConfig) {
        return { kind: "none" };
      }

      const authOkay = isBackendAuthenticated || (await refreshBackendSession());
      if (!authOkay) return { kind: "none" };

      const [pending, activeBackendSession] = await Promise.all([
        fetchPendingSettlements(),
        fetchActiveBackendSession(),
      ]);

      if (pending.hasPending && pending.pendingSettlements.length > 0) {
        const pendingCount = pending.pendingSettlements.length;
        const firstPending = pending.pendingSettlements[0];
        return {
          kind: "pending_settlement",
          message: pendingCount > 1 ? `${pendingCount} PREV BETS NEED SETTLEMENT` : "PREV BET NEEDS SETTLEMENT",
          actionLabel: "END NOW",
          onchainSessionId: String(firstPending?.onchain_session_id || ""),
          pendingCount,
        };
      }

      if (activeBackendSession.hasActiveGame) {
        return {
          kind: "active_previous",
          message: "PREV BET STILL NOT END",
          actionLabel: "END NOW",
          onchainSessionId: String(activeBackendSession.session?.onchain_session_id || ""),
        };
      }

      return { kind: "none" };
    }

    async function refreshPlayBlockerStatus() {
      try {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        return blocker;
      } catch (error) {
        console.warn("⚠️ Failed to refresh play blocker:", error);
        const fallback: ChickenBridgePlayBlocker = { kind: "none" };
        emitPlayBlocker(fallback);
        return fallback;
      }
    }

    // ─── Pending settlement helper ─────────────────────────────────────

    function normalizeHistoryLimit(limit: number | undefined, fallback = 3) {
      const parsed = Number(limit);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(1, Math.min(Math.floor(parsed), 20));
    }

    async function submitSettlementWithRetry(
      sessionId: string,
      retries = 4,
    ): Promise<{ success: boolean; txHash?: string }> {
      let attempt = 0;
      while (true) {
        try {
          return await backendPost<{ success: boolean; txHash?: string }>(
            "/api/game/submit-settlement",
            { sessionId },
          );
        } catch (error) {
          if (attempt >= retries) throw error;
          const backoffMs = 350 * Math.pow(2, attempt) + Math.floor(Math.random() * 180);
          attempt += 1;
          await new Promise<void>((r) => { window.setTimeout(r, backoffMs); });
        }
      }
    }

    async function settlePendingSettlements(
      pendingSettlements: any[],
      options?: { targetOnchainSessionId?: string },
    ) {
      const targetId = options?.targetOnchainSessionId?.toLowerCase() || "";
      const candidates = targetId
        ? pendingSettlements.filter((s) => String(s.onchain_session_id || "").toLowerCase() === targetId)
        : pendingSettlements;

      if (candidates.length === 0) return false;

      let settledCount = 0;
      let firstFailureMessage = "";

      for (const s of candidates) {
        try {
          emitDepositProgress("settle_pending", `Settling old session ${String(s.onchain_session_id || "").slice(0, 10)}...`);
          await submitSettlementWithRetry(String(s.session_id || ""));
          console.log(`✅ Old session ${s.session_id} settled.`);
          settledCount += 1;
        } catch (err) {
          console.error(`❌ Failed to settle old session ${s.session_id}:`, err);
          if (!firstFailureMessage) firstFailureMessage = normalizeError(err, "Failed to process pending settlement.");
        }
      }

      if (firstFailureMessage) {
        emitDepositProgress("settle_incomplete", firstFailureMessage);
        throw new Error(firstFailureMessage);
      }

      if (settledCount > 0) emitDepositProgress("done", "Old session settled.");
      return settledCount > 0;
    }

    // ─── Bridge API ────────────────────────────────────────────────────

    window.__CHICKEN_MONAD_BRIDGE__ = {
      backgroundMode: false,

      loadAvailableBalance: async () => {
        if (!account || !isAddress(account)) return 0;
        await refreshBackendSession();
        return fetchBalance();
      },

      loadDepositBalances: async () => {
        if (!account || !isAddress(account)) {
          return { walletBalance: 0, availableBalance: 0, lockedBalance: 0, allowance: 0 };
        }
        await refreshBackendSession();
        const balance = await fetchBalance();
        return { walletBalance: 0, availableBalance: balance, lockedBalance: 0, allowance: 0 };
      },

      loadLeaderboard: async () => {
        if (!hasBackendConfig) throw new Error("Frontend backend config is incomplete.");
        const payload = await backendFetch<{ leaderboard?: ChickenBridgeLeaderboardEntry[] }>("/api/leaderboard");
        return {
          leaderboard: Array.isArray(payload?.leaderboard) ? payload.leaderboard : [],
          walletAddress: account && isAddress(account) ? account : "",
        };
      },

      loadPlayerStats: async () => {
        await requireBackendWalletSession();
        return backendFetch<ChickenBridgePlayerStats>("/api/player/stats");
      },

      loadGameHistory: async (limit = 3) => {
        await requireBackendWalletSession();
        const safeLimit = normalizeHistoryLimit(limit);
        const payload = await backendFetch<ChickenBridgeGameHistoryPayload>(
          `/api/game/history?limit=${safeLimit}&offset=0`,
        );
        return {
          sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
          total: Number(payload?.total || 0),
          limit: Number(payload?.limit || safeLimit),
          offset: Number(payload?.offset || 0),
        };
      },

      loadPlayerTransactions: async (limit = 3) => {
        await requireBackendWalletSession();
        const safeLimit = normalizeHistoryLimit(limit);
        const payload = await backendFetch<ChickenBridgePlayerTransactionsPayload>(
          `/api/player/transactions?limit=${safeLimit}&offset=0`,
        );
        return {
          transactions: Array.isArray(payload?.transactions) ? payload.transactions : [],
          total: Number(payload?.total || 0),
          limit: Number(payload?.limit || safeLimit),
          offset: Number(payload?.offset || 0),
        };
      },

      getWalletAddress: () => (account && isAddress(account) ? account : ""),

      openDeposit: (presetAmount?: number) => {
        window.dispatchEvent(new CustomEvent("chicken:open-deposit-modal", { detail: { amount: presetAmount } }));
      },

      claimFaucet: async () => {
        await requireReadyGameWallet();
        return backendPost<ChickenBridgeFaucetResult>("/api/player/faucet", {});
      },

      depositToVault: async () => {
        // Mock mode: balance is managed by the backend, no deposit needed.
        throw new Error("Mock mode: balance is managed automatically. No deposit needed.");
      },

      autoSettlePending: async () => {
        await requireReadyGameWallet();
        const pending = await fetchPendingSettlements();
        if (!pending.hasPending || pending.pendingSettlements.length === 0) {
          await refreshPlayBlockerStatus();
          return false;
        }
        console.log(`🧹 Auto-settling ${pending.pendingSettlements.length} pending session(s)...`);
        const didSettle = await settlePendingSettlements(pending.pendingSettlements);
        await refreshPlayBlockerStatus();
        return didSettle;
      },

      getPlayBlocker: async () => {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        return blocker;
      },

      resolvePlayBlocker: async () => {
        await requireReadyGameWallet();
        const blocker = await getPlayBlocker();

        if (blocker.kind === "none") {
          emitPlayBlocker(blocker);
          return false;
        }

        if (blocker.kind === "pending_settlement") {
          const pending = await fetchPendingSettlements();
          if (pending.hasPending && pending.pendingSettlements.length > 0) {
            await settlePendingSettlements(pending.pendingSettlements, {
              targetOnchainSessionId: blocker.onchainSessionId,
            });
            const remaining = await fetchPendingSettlements();
            if (remaining.hasPending && remaining.pendingSettlements.length > 0) {
              await settlePendingSettlements(remaining.pendingSettlements);
            }
          }
        } else {
          emitDepositProgress("settle_sign", "Ending previous bet...");
          await backendPost<{ success: boolean; resolved?: boolean }>("/api/game/force-end-active");
          const pending = await fetchPendingSettlements();
          if (pending.hasPending && pending.pendingSettlements.length > 0) {
            await settlePendingSettlements(pending.pendingSettlements, {
              targetOnchainSessionId: blocker.onchainSessionId,
            });
          }
        }

        const refreshedBlocker = await refreshPlayBlockerStatus();
        return refreshedBlocker.kind === "none";
      },

      getPassportStatus: async () => {
        await requireBackendWalletSession();
        return backendFetch<ChickenBridgePassportStatus>("/api/passport/status");
      },

      claimPassport: async () => {
        throw new Error("Mock mode: passport claim is not available without blockchain.");
      },

      // ─── startBet: emit game:start, no startSession contract call ──
      startBet: async (stake: number) => {
        await requireReadyGameWallet();

        try {
          const bridge = window.__CHICKEN_MONAD_BRIDGE__;
          if (bridge?.autoSettlePending) await bridge.autoSettlePending();
        } catch (err) {
          throw new Error(normalizeError(err, "Pending settlement not finished. Resolve it before starting a new bet."));
        }

        const socket = ensureSocket();
        await waitForSocketReady(socket);

        emitPlayBlocker({ kind: "none" });
        const pendingStart = createPendingRequest(pendingStartRef);
        socket.emit("game:start", { stake });

        let payload: StartedPayload;
        try {
          payload = await pendingStart;
        } catch (error) {
          throw new Error(normalizeError(error, "Failed to start game on backend."));
        }

        activeSessionIdRef.current = payload.sessionId;

        return {
          sessionId: payload.sessionId,
          onchainSessionId: payload.onchainSessionId,
          stake,
          availableBalance: Number.NaN, // refreshed separately via loadAvailableBalance
          txHash: "",
        };
      },

      sendMove: (direction: string) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) return;
        socket.emit("game:move", { direction });
      },

      // ─── cashOut: emit game:cashout, backend mock handles settlement ──
      cashOut: async () => {
        await requireReadyGameWallet();
        const socket = ensureSocket();
        await waitForSocketReady(socket);

        const pendingCashout = createPendingRequest(pendingCashoutRef);
        socket.emit("game:cashout");

        const payload = await pendingCashout;
        activeSessionIdRef.current = "";

        await refreshPlayBlockerStatus();
        const availableBalance = await fetchBalance();

        return {
          sessionId: payload.sessionId,
          onchainSessionId: payload.onchainSessionId,
          availableBalance,
          txHash: String(payload.settlementTxHash || ""),
          resolution: payload.resolution || payload.payload,
          signature: payload.settlementSignature || payload.signature || "",
          multiplier: Number(payload.multiplier || "0"),
          payoutAmount: Number(payload.payoutAmount || "0"),
          profit: Number(payload.profit || "0"),
          reason: payload.reason,
        };
      },

      // ─── crash: emit game:crash, backend mock handles settlement ──
      crash: async (reason?: string) => {
        await requireReadyGameWallet();
        const socket = ensureSocket();
        await waitForSocketReady(socket);

        const pendingCrash = createPendingRequest(pendingCrashRef);
        socket.emit("game:crash", { reason });

        const payload = await pendingCrash;
        const settlementResolution = payload.resolution || payload.payload;
        const settlementSignature = payload.settlementSignature || payload.signature || "";

        activeSessionIdRef.current = "";

        if (!settlementResolution) return null;

        await refreshPlayBlockerStatus();
        const availableBalance = await fetchBalance();

        return {
          sessionId: payload.sessionId,
          onchainSessionId: payload.onchainSessionId,
          availableBalance,
          txHash: String(payload.settlementTxHash || ""),
          resolution: settlementResolution,
          signature: settlementSignature,
          multiplier: Number(payload.multiplier || "0"),
          payoutAmount: Number(payload.payoutAmount || "0"),
          profit: Number(payload.profit || "0"),
          reason: payload.reason,
        };
      },
    };

    void refreshPlayBlockerStatus();
    // Eagerly connect socket so backend can emit game:reconnected if a paused game exists
    try { ensureSocket(); } catch { /* no backend config */ }
    window.dispatchEvent(new CustomEvent("chicken:bridge-ready"));

    // Proactive HTTP check: detect paused sessions that the socket might miss
    void (async () => {
      try {
        const activeCheck = await backendFetch<{
          hasActiveGame: boolean;
          snapshot?: Record<string, unknown> | null;
        }>("/api/game/active");
        if (activeCheck.hasActiveGame) {
          window.dispatchEvent(new CustomEvent("chicken:active-session-found", {
            detail: activeCheck.snapshot ?? null,
          }));
        }
      } catch {
        // non-critical — ignore
      }
    })();

    return () => {
      pendingStartRef.current = null;
      pendingCashoutRef.current = null;
      pendingCrashRef.current = null;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      delete window.__CHICKEN_MONAD_BRIDGE__;
    };
  }, [
    account,
    backgroundMode,
    ensureBackendSession,
    isBackendAuthenticated,
    hasBackendConfig,
    refreshBackendSession,
  ]);

  return null;
}
