import * as THREE from "https://esm.sh/three";

const minTileIndex = -8;
const maxTileIndex = 8;
const tilesPerRow = maxTileIndex - minTileIndex + 1;
const tileSize = 42;

// ============================================================
// BETTING SYSTEM (mock, in-memory + localStorage — Rialo Devnet Demo)
// ============================================================

const STEP_INCREMENT_BP = 250; // +0.025x per forward step
const CP_BONUS_NUM = 12; // × 1.2 at CP
const CP_BONUS_DEN = 10;
const CP_INTERVAL = 40; // checkpoint every 40 steps
const SEGMENT_TIME_MS = 60 * 1000; // 60s between CPs
const CP_MAX_STAY_MS = 60 * 1000; // auto-exit CP after 60s
const DECAY_BP_PER_SEC = 1000; // -0.1x per second = -1000 bp/s
const SPEED_MULT_PER_CP = 1.1; // vehicle speed × 1.3 per CP
const MAX_MOVE_QUEUE = 8;

const bet = {
  balance: 0,
  active: false,
  stake: 0,
  multiplierBp: 0, // starts at 0.00x (not 1.00x!)
  maxRow: 0,
  currentCp: 0, // number of CPs completed

  // CP window state
  cashoutWindow: false,
  cpEnterTime: 0,
  cpRowIndex: 0,
  cpStayRemainingMs: 0,

  // Segment (between CP) timer
  segmentActive: false,
  segmentStart: 0,

  // Decay tracking
  lastDecayTick: 0,
  isDecaying: false,
  reconnecting: false,

  timerInterval: null,
};

let gameOver = false;
let settlementPending = false;
let lastLiveBetStatusMessage = "";
let audioCtx = null;
let audioUnlocked = false;
let lastStepSfxAt = 0;
let lastCrashSfxAt = 0;
let lastCheckpointSfxAt = 0;
const SFX_STORAGE_KEY = "chickenSfxVolume";
const SFX_MASTER_GAIN = 2.8;
let sfxVolume = 0.9;

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioCtx = new AudioContextClass();
  return audioCtx;
}

function clampSfxVolume(value) {
  const num = Number(value);
  if (!isFinite(num)) return 0.9;
  return Math.min(1, Math.max(0, num));
}

function readStoredSfxVolume() {
  try {
    const raw = localStorage.getItem(SFX_STORAGE_KEY);
    if (raw == null || raw === "") return 0.9;
    return clampSfxVolume(parseFloat(raw));
  } catch (_error) {
    return 0.9;
  }
}

function writeStoredSfxVolume(value) {
  try {
    localStorage.setItem(SFX_STORAGE_KEY, String(clampSfxVolume(value)));
  } catch (_error) {
    // ignore storage errors in private mode / restricted contexts
  }
}

function applySfxVolume(value) {
  sfxVolume = clampSfxVolume(value);
  writeStoredSfxVolume(sfxVolume);
}

async function unlockAudio() {
  if (audioUnlocked) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (_error) {
      return;
    }
  }
  audioUnlocked = ctx.state === "running";
}

function playTone({
  frequency = 440,
  durationMs = 120,
  type = "sine",
  volume = 0.02,
  frequencyEnd = null,
} = {}) {
  const ctx = ensureAudioContext();
  if (!ctx || !audioUnlocked) return;

  const now = ctx.currentTime;
  const durationSec = Math.max(0.02, durationMs / 1000);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const targetVolume = Math.min(
    0.5,
    Math.max(0.0001, volume * SFX_MASTER_GAIN * sfxVolume),
  );

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (isFinite(frequencyEnd) && frequencyEnd > 0) {
    osc.frequency.exponentialRampToValueAtTime(frequencyEnd, now + durationSec);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(targetVolume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.01);
}

function playStepSfx() {
  const now = Date.now();
  if (now - lastStepSfxAt < 90) return;
  lastStepSfxAt = now;
  playTone({
    frequency: 360,
    frequencyEnd: 290,
    durationMs: 75,
    type: "triangle",
    volume: 0.03,
  });
}

function playCrashSfx() {
  const nowMs = Date.now();
  if (nowMs - lastCrashSfxAt < 550) return;
  lastCrashSfxAt = nowMs;
  void unlockAudio();

  playTone({
    frequency: 1300,
    frequencyEnd: 420,
    durationMs: 140,
    type: "square",
    volume: 0.28,
  });
  playTone({
    frequency: 820,
    frequencyEnd: 160,
    durationMs: 460,
    type: "triangle",
    volume: 0.22,
  });
}

function playStartBetSfx() {
  void unlockAudio();
  playTone({
    frequency: 560,
    frequencyEnd: 760,
    durationMs: 110,
    type: "square",
    volume: 0.08,
  });
}

function playCheckpointSfx() {
  const nowMs = Date.now();
  if (nowMs - lastCheckpointSfxAt < 500) return;
  lastCheckpointSfxAt = nowMs;
  void unlockAudio();

  const ctx = ensureAudioContext();
  if (!ctx || !audioUnlocked) return;

  const now = ctx.currentTime;
  const notes = [660, 820, 980];
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + index * 0.06;
    const end = start + 0.13;
    const target = Math.min(0.5, 0.07 * SFX_MASTER_GAIN * sfxVolume);

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, target),
      start + 0.01,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  });
}

function playCashoutSfx() {
  void unlockAudio();
  playTone({
    frequency: 700,
    frequencyEnd: 980,
    durationMs: 130,
    type: "triangle",
    volume: 0.1,
  });
  playTone({
    frequency: 980,
    frequencyEnd: 1240,
    durationMs: 150,
    type: "triangle",
    volume: 0.08,
  });
}

function setupAudioUnlock() {
  const unlockOnce = () => {
    void unlockAudio();
    window.removeEventListener("pointerdown", unlockOnce);
    window.removeEventListener("touchstart", unlockOnce);
    window.removeEventListener("keydown", unlockOnce);
  };
  window.addEventListener("pointerdown", unlockOnce, { passive: true });
  window.addEventListener("touchstart", unlockOnce, { passive: true });
  window.addEventListener("keydown", unlockOnce);
}

function setupSfxVolumeSync() {
  applySfxVolume(readStoredSfxVolume());
  window.addEventListener("chicken:set-sfx-volume", (event) => {
    const detail = (event && event.detail) || {};
    applySfxVolume(detail.value);
  });
}

setupAudioUnlock();
setupSfxVolumeSync();

function getBridge() {
  return window.__CHICKEN_RIALO_BRIDGE__;
}

function hasLiveBridge() {
  const bridge = getBridge();
  return Boolean(bridge && !bridge.backgroundMode);
}

async function loadBalance() {
  if (hasLiveBridge()) {
    try {
      bet.balance = await getBridge().loadAvailableBalance();
      renderBalance();
      return;
    } catch (error) {
      console.error("Failed to load live balance:", error);
    }
  }

  const saved = localStorage.getItem("chickenBetBalance");
  bet.balance = saved ? parseFloat(saved) : 0;
  renderBalance();
}

function saveBalance() {
  if (hasLiveBridge()) return;
  localStorage.setItem("chickenBetBalance", bet.balance.toFixed(2));
}

function renderBalance() {
  const el = document.getElementById("balance");
  if (el) el.innerText = "$" + bet.balance.toFixed(2);
}

function dispatchPlayStatus({
  message = "",
  tone = "info",
  sticky = false,
  clear = false,
  durationMs,
} = {}) {
  window.dispatchEvent(
    new CustomEvent("chicken:play-status", {
      detail: { message, tone, sticky, clear, durationMs },
    }),
  );
}

function syncLiveBetStatus() {
  if (!bet.active || settlementPending || bet.reconnecting) {
    lastLiveBetStatusMessage = "";
    return;
  }

  const mult = bet.multiplierBp / 10000;
  const payout = bet.stake * mult;
  const message = `LIVE BET $${bet.stake.toFixed(2)} • ${mult.toFixed(
    2,
  )}x • $${payout.toFixed(2)} • CP ${bet.currentCp}`;

  if (message === lastLiveBetStatusMessage) return;
  lastLiveBetStatusMessage = message;
  dispatchPlayStatus({
    message,
    tone: "ready",
    sticky: true,
  });
}

function formatBridgeError(error, fallback, userRejectedMessage) {
  const rawMessage =
    typeof error === "string"
      ? String(error || "").trim()
      : error && typeof error === "object" && "message" in error
        ? String(error.message || "").trim()
        : "";

  const message = rawMessage || fallback;
  const lower = message.toLowerCase();

  if (isUserRejectedBridgeError(error)) {
    return userRejectedMessage || "Request was canceled in wallet.";
  }

  if (
    lower.includes("already pending") ||
    lower.includes("pending request") ||
    lower.includes("request of type") ||
    lower.includes("user is already processing")
  ) {
    return "There is still a pending wallet request.";
  }

  if (
    lower.includes("insufficient funds") ||
    lower.includes("gas required exceeds allowance") ||
    lower.includes("intrinsic gas too low") ||
    lower.includes("exceeds allowance")
  ) {
    return "Wallet gas balance is insufficient for this transaction.";
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("network error") ||
    lower.includes("network request failed") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("disconnected") ||
    lower.includes("socket hang up") ||
    lower.includes("rpc")
  ) {
    return "Wallet or RPC connection is unstable. Please try again.";
  }

  let simplified = message.split(/\r?\n/)[0]?.trim() || "";
  [
    "Details:",
    "Request Arguments:",
    "Request body:",
    "URL:",
    "Version:",
  ].forEach((marker) => {
    const index = simplified.indexOf(marker);
    if (index >= 0) {
      simplified = simplified.slice(0, index).trim();
    }
  });
  simplified = simplified.replace(/^execution reverted:?\s*/i, "").trim();

  if (!simplified) return fallback;
  if (simplified.length > 140) return fallback;
  if (
    simplified.toLowerCase().includes("details:") ||
    simplified.toLowerCase().includes("request arguments:") ||
    simplified.toLowerCase().includes("version:")
  ) {
    return fallback;
  }

  return simplified;
}

function isUserRejectedBridgeError(error) {
  const message =
    typeof error === "string"
      ? String(error || "").toLowerCase()
      : error && typeof error === "object" && "message" in error
        ? String(error.message || "").toLowerCase()
        : "";
  return (
    message.includes("userrejectedrequesterror") ||
    message.includes("user rejected") ||
    message.includes("rejected the request") ||
    message.includes("user denied") ||
    message.includes("rejected by user")
  );
}

function setDepositButtonState(label = "DEPOSIT", busy = false) {
  window.dispatchEvent(
    new CustomEvent("chicken:deposit-ui-state", {
      detail: { label, busy },
    }),
  );
}

function setBetButtonState() {
  const betBtn = document.getElementById("bet-btn");
  if (!betBtn) return;

  if (settlementPending) {
    betBtn.innerText = "SETTLING...";
    betBtn.classList.add("busy");
    betBtn.classList.remove("active");
    betBtn.disabled = true;
    return;
  }

  if (bet.reconnecting) {
    betBtn.innerText = "RECONNECTING...";
    betBtn.classList.add("busy");
    betBtn.classList.remove("active");
    betBtn.disabled = true;
    return;
  }

  if (bet.active) {
    betBtn.innerText = "BET LIVE";
    betBtn.classList.add("active");
    betBtn.classList.remove("busy");
    betBtn.disabled = false;
    return;
  }

  betBtn.innerText = "BET";
  betBtn.classList.remove("active");
  betBtn.classList.remove("busy");
  betBtn.disabled = false;
}

function deposit(amount) {
  if (!isFinite(amount) || amount <= 0) return false;
  if (hasLiveBridge()) return false;
  bet.balance += amount;
  saveBalance();
  renderBalance();
  return true;
}

function activateBet(stake, availableBalance) {
  if (isFinite(availableBalance)) {
    bet.balance = availableBalance;
    renderBalance();
  }

  settlementPending = false;
  if (!isFinite(stake) || stake <= 0) return false;

  bet.active = true;
  bet.stake = stake;
  bet.multiplierBp = 0;
  bet.maxRow = 0;
  bet.currentCp = 0;
  bet.cashoutWindow = false;
  bet.cpEnterTime = 0;
  bet.cpRowIndex = 0;
  bet.cpStayRemainingMs = 0;
  bet.segmentActive = true; // first segment starts immediately from step 0
  bet.segmentStart = Date.now();
  bet.lastDecayTick = Date.now();
  bet.isDecaying = false;
  bet.reconnecting = false;

  startBetTicker();
  renderBetHud();
  showBetHud(true);
  showBetPanel(false);
  hideResult();
  setBetButtonState();
  dispatchPlayStatus({ clear: true });
  lastLiveBetStatusMessage = "";

  initializeGame();
  playStartBetSfx();
  return true;
}

function calculateRowMultiplierBp(rowIndex) {
  let multiplierBp = 0;
  const safeRowIndex = Math.max(0, Math.floor(Number(rowIndex) || 0));

  for (let step = 1; step <= safeRowIndex; step += 1) {
    multiplierBp += STEP_INCREMENT_BP;
    if (step % CP_INTERVAL === 0) {
      multiplierBp = Math.floor((multiplierBp * CP_BONUS_NUM) / CP_BONUS_DEN);
    }
  }

  return multiplierBp;
}

function getCurrentDecayPenaltyBp(now = Date.now()) {
  if (!bet.active || bet.cashoutWindow || !bet.segmentActive) {
    return 0;
  }

  const elapsed = now - bet.segmentStart;
  const overtime = elapsed - SEGMENT_TIME_MS;
  if (overtime <= 0) {
    return 0;
  }

  return Math.floor((DECAY_BP_PER_SEC * overtime) / 1000);
}

function getCurrentEffectiveMultiplierBp(now = Date.now()) {
  const baseMultiplierBp = calculateRowMultiplierBp(position.currentRow);
  return Math.max(0, baseMultiplierBp - getCurrentDecayPenaltyBp(now));
}

async function startBet(stake) {
  if (!isFinite(stake) || stake <= 0) return false;

  if (hasLiveBridge()) {
    try {
      const result = await getBridge().startBet(stake);
      return activateBet(stake, result.availableBalance);
    } catch (error) {
      const message = formatBridgeError(
        error,
        "Failed to start live bet.",
        "Start bet was canceled in wallet.",
      );
      console.error("Failed to start live bet:", error);
      window.dispatchEvent(
        new CustomEvent("chicken:game-error", { detail: { message } }),
      );
      void loadBalance();
      return false;
    }
  }

  if (stake > bet.balance) return false;

  bet.balance -= stake;
  saveBalance();
  renderBalance();
  return activateBet(stake, bet.balance);
}

function onPlayerAdvance(newRowIndex) {
  if (!bet.active) return;

  // Check if this row is a checkpoint (every 40 steps, grass row)
  if (newRowIndex > 0 && newRowIndex % CP_INTERVAL === 0) {
    reachCheckpoint(newRowIndex);
  } else {
    // moved forward past the CP row — close cashout window
    if (bet.cashoutWindow && newRowIndex > bet.cpRowIndex) {
      closeCashoutWindow();
    }
  }

  renderBetHud();
}

function reachCheckpoint(rowIndex) {
  playCheckpointSfx();
  bet.currentCp += 1;
  bet.cpRowIndex = rowIndex;

  // × 1.2 compound bonus
  bet.multiplierBp = getCurrentEffectiveMultiplierBp();

  // Open cashout window, freeze segment timer while at CP
  bet.cashoutWindow = true;
  bet.cpEnterTime = Date.now();
  bet.segmentActive = false;

  renderBetHud();
}

function closeCashoutWindow() {
  bet.cashoutWindow = false;
  // Start new segment timer (60s to reach next CP)
  bet.segmentActive = true;
  bet.segmentStart = Date.now();
  bet.lastDecayTick = Date.now();
}

function canCashOut() {
  return bet.active && bet.cashoutWindow && !bet.reconnecting;
}

async function cashOut(reason) {
  if (!bet.active) return;
  if (!bet.cashoutWindow) return; // only at CP with window open
  if (settlementPending) return;

  if (hasLiveBridge()) {
    settlementPending = true;
    setBetButtonState();
    let keepStatusMessage = false;
    dispatchPlayStatus({
      message: "SETTLING CASH OUT...",
      tone: "busy",
      sticky: true,
    });
    try {
      const result = await getBridge().cashOut();
      bet.active = false;
      stopBetTicker();
      bet.balance = result.availableBalance;
      renderBalance();
      showBetHud(false);
      showResult({
        type: "cashout",
        reason: reason || "manual",
        stake: bet.stake,
        multiplier: result.multiplier,
        payout: result.payoutAmount,
        profit: result.profit,
        rows: bet.maxRow,
        cp: bet.currentCp,
      });
    } catch (error) {
      console.error("Failed to settle cashout:", error);
      // Backend already finalized the offchain session, so keep UI in sync
      // and force the player back to a clean pre-bet state.
      bet.active = false;
      bet.cashoutWindow = false;
      bet.segmentActive = false;
      stopBetTicker();
      showBetHud(false);
      showBetPanel(true);
      const fallbackMessage = isUserRejectedBridgeError(error)
        ? "Cash out was canceled in wallet. Resolve pending settlement, then start betting again."
        : "Failed to settle cashout.";
      const message = formatBridgeError(
        error,
        fallbackMessage,
        "Cash out was canceled in wallet.",
      );
      keepStatusMessage = true;
      dispatchPlayStatus({
        message,
        tone: "error",
        durationMs: 4200,
      });
      alert(message);
    } finally {
      settlementPending = false;
      setBetButtonState();
      if (!keepStatusMessage) {
        dispatchPlayStatus({ clear: true });
      }
      void loadBalance();
    }
    return;
  }

  const mult = getCurrentEffectiveMultiplierBp() / 10000;
  bet.active = false;
  stopBetTicker();
  setBetButtonState();

  const payout = bet.stake * mult;
  const profit = payout - bet.stake;
  bet.balance += payout;
  saveBalance();
  renderBalance();

  showBetHud(false);
  showResult({
    type: "cashout",
    reason: reason || "manual",
    stake: bet.stake,
    multiplier: mult,
    payout,
    profit,
    rows: bet.maxRow,
    cp: bet.currentCp,
  });
}

async function crashBet(reason) {
  if (!bet.active) return;
  if (settlementPending) return;

  playCrashSfx();

  if (hasLiveBridge()) {
    settlementPending = true;
    setBetButtonState();
    let keepStatusMessage = false;
    const mult = getCurrentEffectiveMultiplierBp() / 10000;
    const lostStake = bet.stake;
    bet.active = false;
    stopBetTicker();
    showBetHud(false);
    showResult({
      type: "crash",
      stake: lostStake,
      multiplier: mult,
      payout: 0,
      profit: -lostStake,
      rows: bet.maxRow,
      cp: bet.currentCp,
    });
    dispatchPlayStatus({
      message: "CRASHED. SETTLING...",
      tone: "warning",
      sticky: true,
    });

    try {
      const result = await getBridge().crash(reason || "collision");
      if (result && isFinite(result.availableBalance)) {
        bet.balance = result.availableBalance;
        renderBalance();
      }
      showResult({
        type: "crash",
        stake: lostStake,
        multiplier: result ? result.multiplier : mult,
        payout: 0,
        profit: -lostStake,
        rows: bet.maxRow,
        cp: bet.currentCp,
        silent: true,
      });
    } catch (error) {
      console.error("Failed to settle crash:", error);
      const message = formatBridgeError(
        error,
        "Failed to settle crash.",
        "Run settlement was canceled in wallet.",
      );
      keepStatusMessage = true;
      dispatchPlayStatus({
        message,
        tone: "error",
        durationMs: 4200,
      });
      alert(message);
    } finally {
      settlementPending = false;
      setBetButtonState();
      if (!keepStatusMessage) {
        dispatchPlayStatus({ clear: true });
      }
      void loadBalance();
    }
    return;
  }

  const mult = getCurrentEffectiveMultiplierBp() / 10000;
  bet.active = false;
  stopBetTicker();
  setBetButtonState();

  showBetHud(false);
  showResult({
    type: "crash",
    stake: bet.stake,
    multiplier: mult,
    payout: 0,
    profit: -bet.stake,
    rows: bet.maxRow,
    cp: bet.currentCp,
  });
}

function startBetTicker() {
  stopBetTicker();
  bet.timerInterval = setInterval(tickBet, 100);
}

function stopBetTicker({ resetTimer = true } = {}) {
  if (bet.timerInterval) {
    clearInterval(bet.timerInterval);
    bet.timerInterval = null;
  }
  if (resetTimer) {
    renderTimer(SEGMENT_TIME_MS, false);
  }
}

function tickBet() {
  if (!bet.active) return;
  const now = Date.now();

  // --- CP stay timeout check ---
  if (bet.cashoutWindow) {
    const stayElapsed = now - bet.cpEnterTime;
    const remaining = Math.max(0, CP_MAX_STAY_MS - stayElapsed);
    renderTimer(remaining, true); // "AT CP" mode
    bet.cpStayRemainingMs = remaining;
    bet.isDecaying = false;
    bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
    renderBetHud(); // update CP timer row in HUD every tick
    if (remaining <= 0) {
      closeCashoutWindow();
    }
  } else if (bet.segmentActive) {
    // --- Segment timer ---
    const segElapsed = now - bet.segmentStart;
    const remaining = Math.max(0, SEGMENT_TIME_MS - segElapsed);
    renderTimer(remaining, false);
    bet.cpStayRemainingMs = 0;

    // --- Decay logic: after segment time is up, -0.1x per second ---
    const decayWasActive = bet.isDecaying;
    const decayPenaltyBp = getCurrentDecayPenaltyBp(now);

    if (decayPenaltyBp > 0) {
      bet.isDecaying = true;
      bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
      bet.lastDecayTick = now;
      renderBetHud();
    } else {
      bet.isDecaying = false;
      bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
      bet.lastDecayTick = now;
      if (decayWasActive) {
        renderBetHud();
      }
    }
  } else {
    bet.isDecaying = false;
    bet.cpStayRemainingMs = 0;
    bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
  }
}

function renderTimer(ms, atCp) {
  const el = document.getElementById("timer");
  const card = document.getElementById("timer-card");
  const labelEl = document.getElementById("timer-label");
  if (!el) return;

  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  el.innerText = `${m}:${s.toString().padStart(2, "0")}`;

  if (labelEl) labelEl.innerText = atCp ? "AT CP" : "RUSH";

  if (card) {
    if (ms < 15000 && bet.active) card.classList.add("timer-warning");
    else card.classList.remove("timer-warning");
  }
}

function renderBetHud() {
  const effectiveMultiplierBp = getCurrentEffectiveMultiplierBp();
  const decayPenaltyBp = getCurrentDecayPenaltyBp();
  const isDecayActive =
    bet.active && !bet.reconnecting && !bet.cashoutWindow && decayPenaltyBp > 0;
  const mult = effectiveMultiplierBp / 10000;
  const payout = bet.stake * mult;
  const headKickerEl = document.querySelector(".bet-hud-kicker");
  const headLineEl = document.querySelector(".bet-hud-headline");
  const stakeEl = document.getElementById("bet-stake");
  const multEl = document.getElementById("bet-multiplier");
  const payEl = document.getElementById("bet-payout");
  const scoreCpEl = document.getElementById("score-cp");
  const activeHudEl = document.getElementById("bet-hud-active");
  const idleHudEl = document.getElementById("bet-hud-idle");
  const cashoutBtn = document.getElementById("cash-out-btn");
  const decayRow = document.getElementById("bet-hud-decay");
  const decayValueEl = document.getElementById("bet-decay");

  bet.multiplierBp = effectiveMultiplierBp;
  bet.isDecaying = isDecayActive;

  if (stakeEl) stakeEl.innerText = "$" + bet.stake.toFixed(2);
  if (multEl) multEl.innerText = mult.toFixed(2) + "x";
  if (payEl) payEl.innerText = "$" + payout.toFixed(2);
  if (scoreCpEl) scoreCpEl.innerText = String(bet.currentCp);

  if (headKickerEl) {
    headKickerEl.textContent = bet.active ? "Live Bet" : "Run Summary";
  }
  if (headLineEl) {
    if (bet.reconnecting) {
      headLineEl.textContent = "Reconnecting...";
    } else if (!bet.active) {
      headLineEl.textContent = "No active bet";
    } else if (bet.cashoutWindow) {
      headLineEl.textContent = "Checkpoint window open";
    } else if (isDecayActive) {
      headLineEl.textContent = "DECAYING IS ACTIVE";
    } else {
      headLineEl.textContent = "Run in progress";
    }
  }

  if (activeHudEl) {
    activeHudEl.style.display = bet.active ? "block" : "none";
  }
  if (idleHudEl) {
    idleHudEl.style.display = bet.active ? "none" : "block";
  }

  // Decay indicator
  if (decayRow) {
    decayRow.hidden = !isDecayActive;
    decayRow.style.display = isDecayActive ? "flex" : "none";
  }
  if (decayValueEl) {
    decayValueEl.innerText = "-0.1x / sec";
  }

  if (cashoutBtn) {
    if (!bet.active || bet.reconnecting) {
      cashoutBtn.style.display = "none";
      cashoutBtn.disabled = true;
      cashoutBtn.classList.add("disabled");
      cashoutBtn.innerText = "RECONNECTING...";
    } else if (canCashOut()) {
      cashoutBtn.style.display = "block";
      cashoutBtn.disabled = false;
      cashoutBtn.classList.remove("disabled");
      cashoutBtn.innerText = "CASH OUT";
    } else {
      cashoutBtn.style.display = "none";
      cashoutBtn.disabled = true;
      cashoutBtn.classList.add("disabled");
      cashoutBtn.innerText = "RUN TO NEXT CP";
    }
  }

  syncLiveBetStatus();
}

function showBetPanel(show) {
  const el = document.getElementById("bet-panel");
  if (el) el.style.display = show ? "flex" : "none";
}

function showBetHud(show) {
  const el = document.getElementById("bet-hud");
  if (el) el.style.display = "block";
  renderBetHud();
}

function syncPlayerToGrid() {
  player.position.x = position.currentTile * tileSize;
  player.position.y = position.currentRow * tileSize;
  player.children[0].position.z = 0;
}

function pauseActiveBetForReconnect() {
  if (!bet.active) return;

  bet.reconnecting = true;
  bet.isDecaying = false;
  movesQueue.length = 0;

  if (moveClock.running) moveClock.stop();

  syncPlayerToGrid();
  stopBetTicker({ resetTimer: false });
  hideResult();
  showBetHud(true);
  showBetPanel(false);
  setBetButtonState();
  renderBetHud();
}

function restoreActiveBetFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;

  const row = Math.max(0, Number(snapshot.row) || 0);
  const maxRow = Math.max(row, Number(snapshot.maxRow) || 0);
  const currentCp = Math.max(0, Number(snapshot.cp) || 0);
  const cashoutWindow = Boolean(snapshot.cashoutWindow);
  const segmentRemainingMs = Math.max(
    0,
    Number(snapshot.segmentRemainingMs) || 0,
  );
  const cpStayRemainingMs = Math.max(
    0,
    Number(snapshot.cpStayRemainingMs) || 0,
  );
  const decayBp = Math.max(0, Number(snapshot.decayBp) || 0);
  const now = Date.now();

  settlementPending = false;
  gameOver = false;
  bet.active = true;
  bet.reconnecting = false;
  bet.stake = Math.max(0, Number(snapshot.stake) || 0);
  bet.maxRow = maxRow;
  bet.currentCp = currentCp;
  bet.cashoutWindow = cashoutWindow;
  bet.cpRowIndex = cashoutWindow ? row : currentCp * CP_INTERVAL;
  bet.cpStayRemainingMs = cashoutWindow ? cpStayRemainingMs : 0;
  bet.cpEnterTime = cashoutWindow
    ? now - Math.max(0, CP_MAX_STAY_MS - cpStayRemainingMs)
    : 0;
  bet.segmentActive = !cashoutWindow;
  bet.segmentStart =
    segmentRemainingMs > 0
      ? now - Math.max(0, SEGMENT_TIME_MS - segmentRemainingMs)
      : now - SEGMENT_TIME_MS - Math.floor((decayBp * 1000) / DECAY_BP_PER_SEC);
  bet.lastDecayTick = now;
  bet.isDecaying = !cashoutWindow && decayBp > 0;
  bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);

  movesQueue.length = 0;
  if (moveClock.running) moveClock.stop();
  position.currentRow = row;

  syncPlayerToGrid();

  if (scoreDOM) scoreDOM.innerText = String(position.currentRow);
  if (scoreCpDOM) scoreCpDOM.innerText = String(bet.currentCp);

  hideResult();
  showBetPanel(false);
  showBetHud(true);
  setBetButtonState();
  renderBetHud();
  tickBet();
  startBetTicker();
  return true;
}

function resetBetAfterReconnectFailure() {
  settlementPending = false;
  bet.active = false;
  bet.reconnecting = false;
  bet.cashoutWindow = false;
  bet.segmentActive = false;
  bet.cpStayRemainingMs = 0;
  bet.isDecaying = false;
  movesQueue.length = 0;

  if (moveClock.running) moveClock.stop();

  stopBetTicker();
  setBetButtonState();
  renderBetHud();
  showBetHud(false);
}

let _pendingRecoverySnapshot = null;
let _resultAutoHideTimer = null;

function showSessionRecoveryDialog(snapshot) {
  _pendingRecoverySnapshot = snapshot;
  const modal = document.getElementById("session-recovery-modal");
  if (!modal) return;

  const stake = Number(snapshot?.stake) || 0;
  const cp = Number(snapshot?.cp) || 0;
  const row = Number(snapshot?.row) || 0;
  const multStr = (Number(snapshot?.multiplierBp || 0) / 10000).toFixed(2);

  const infoEl = document.getElementById("session-recovery-info");
  if (infoEl) {
    infoEl.innerHTML = `Kamu punya sesi game yang belum selesai.<br>
      Stake: <strong>$${stake.toFixed(2)}</strong> &nbsp;|&nbsp;
      Row: <strong>${row}</strong> &nbsp;|&nbsp;
      CP: <strong>${cp}</strong> &nbsp;|&nbsp;
      Multiplier: <strong>${multStr}x</strong>`;
  }

  modal.style.display = "flex";
}

function hideSessionRecoveryDialog() {
  const modal = document.getElementById("session-recovery-modal");
  if (modal) modal.style.display = "none";
  _pendingRecoverySnapshot = null;
}

function showResult(data) {
  gameOver = true;
  movesQueue.length = 0;

  const resultDOM = document.getElementById("result-container");
  const titleEl = document.getElementById("result-title");
  const bodyEl = document.getElementById("result-body");
  if (!resultDOM || !titleEl || !bodyEl) return;

  const shouldPlaySfx = !data.silent;

  if (data.type === "cashout") {
    if (shouldPlaySfx) playCashoutSfx();
    titleEl.innerText = "CASHED OUT";
    titleEl.style.color = "#27ae60";
    const profitClass =
      data.profit >= 0 ? "profit-positive" : "profit-negative";
    const profitSign = data.profit >= 0 ? "+" : "-";
    bodyEl.innerHTML = `
      <p>Checkpoint: <strong>${data.cp}</strong></p>
      <p>Hops survived: <strong>${data.rows}</strong></p>
      <p>Multiplier: <strong>${data.multiplier.toFixed(2)}x</strong></p>
      <p>Payout: <strong>$${data.payout.toFixed(2)}</strong></p>
      <p class="${profitClass}">Profit: ${profitSign}$${Math.abs(data.profit).toFixed(2)}</p>
    `;
  } else if (data.type === "crash") {
    if (shouldPlaySfx) playCrashSfx();
    titleEl.innerText = "CRASHED";
    titleEl.style.color = "#c0392b";
    bodyEl.innerHTML = `
      <p>Last checkpoint: <strong>${data.cp}</strong></p>
      <p>Hops survived: <strong>${data.rows}</strong></p>
      <p>Last multiplier: <strong>${data.multiplier.toFixed(2)}x</strong></p>
      <p class="profit-negative">Lost: -$${data.stake.toFixed(2)}</p>
    `;
  } else {
    if (shouldPlaySfx) playCrashSfx();
    titleEl.innerText = "GAME OVER";
    titleEl.style.color = "#c0392b";
    bodyEl.innerHTML = `<p>Hops: <strong>${position.currentRow}</strong></p>`;
  }
  resultDOM.style.visibility = "visible";

  // Auto-hide after 3 s or when Play Again is clicked
  if (_resultAutoHideTimer) clearTimeout(_resultAutoHideTimer);
  _resultAutoHideTimer = setTimeout(() => {
    _resultAutoHideTimer = null;
    if (resultDOM.style.visibility === "visible") {
      hideResult();
      showBetPanel(true);
      initializeGame();
    }
  }, 3000);
}

function hideResult() {
  if (_resultAutoHideTimer) {
    clearTimeout(_resultAutoHideTimer);
    _resultAutoHideTimer = null;
  }
  const el = document.getElementById("result-container");
  if (el) el.style.visibility = "hidden";
}

let _globalToastTimeout = null;

function showGlobalErrorToast(msg) {
  let toast = document.getElementById("global-error-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "global-error-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "90px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#c0392b",
      color: "#fff",
      padding: "10px 18px",
      borderRadius: "6px",
      fontWeight: "bold",
      fontSize: "13px",
      zIndex: "10000",
      maxWidth: "88%",
      textAlign: "center",
      boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
      pointerEvents: "none",
    });
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.display = "block";
  if (_globalToastTimeout) clearTimeout(_globalToastTimeout);
  _globalToastTimeout = setTimeout(() => {
    toast.style.display = "none";
  }, 4200);
}

function Camera() {
  const size = 300;
  const viewRatio = window.innerWidth / window.innerHeight;
  const width = viewRatio < 1 ? size : size * viewRatio;
  const height = viewRatio < 1 ? size / viewRatio : size;

  const camera = new THREE.OrthographicCamera(
    width / -2, // left
    width / 2, // right
    height / 2, // top
    height / -2, // bottom
    100, // near
    900, // far
  );

  camera.up.set(0, 0, 1);
  camera.position.set(300, -300, 300);
  camera.lookAt(0, 0, 0);

  return camera;
}

function Texture(width, height, rects) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(0,0,0,0.6)";
  rects.forEach((rect) => {
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
  });
  return new THREE.CanvasTexture(canvas);
}

const carFrontTexture = new Texture(40, 80, [{ x: 0, y: 10, w: 30, h: 60 }]);
const carBackTexture = new Texture(40, 80, [{ x: 10, y: 10, w: 30, h: 60 }]);
const carRightSideTexture = new Texture(110, 40, [
  { x: 10, y: 0, w: 50, h: 30 },
  { x: 70, y: 0, w: 30, h: 30 },
]);
const carLeftSideTexture = new Texture(110, 40, [
  { x: 10, y: 10, w: 50, h: 30 },
  { x: 70, y: 10, w: 30, h: 30 },
]);

export const truckFrontTexture = Texture(30, 30, [
  { x: 5, y: 0, w: 10, h: 30 },
]);
export const truckRightSideTexture = Texture(25, 30, [
  { x: 15, y: 5, w: 10, h: 10 },
]);
export const truckLeftSideTexture = Texture(25, 30, [
  { x: 15, y: 15, w: 10, h: 10 },
]);

function Car(initialTileIndex, direction, color) {
  const car = new THREE.Group();
  car.position.x = initialTileIndex * tileSize;
  if (!direction) car.rotation.z = Math.PI;

  const main = new THREE.Mesh(
    new THREE.BoxGeometry(65, 28, 12),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  main.position.z = 12;
  main.castShadow = true;
  main.receiveShadow = true;
  car.add(main);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(28, 22, 9), [
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carBackTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carFrontTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carRightSideTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carLeftSideTexture,
    }),
    new THREE.MeshPhongMaterial({ color: 0xd9ecff, flatShading: true }), // top
    new THREE.MeshPhongMaterial({ color: 0xcccccc, flatShading: true }), // bottom
  ]);
  cabin.position.x = -10;
  cabin.position.z = 22;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  car.add(cabin);

  const spoiler = new THREE.Mesh(
    new THREE.BoxGeometry(2, 26, 3),
    new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true }),
  );
  spoiler.position.set(-31, 0, 22);
  spoiler.castShadow = true;
  car.add(spoiler);

  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0 });
  const headlightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 3, 2),
    headlightMat,
  );
  headlightL.position.set(30.5, -10, 11);
  car.add(headlightL);

  const headlightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 3, 2),
    headlightMat,
  );
  headlightR.position.set(30.5, 10, 11);
  car.add(headlightR);

  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  const taillightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 2.5),
    taillightMat,
  );
  taillightL.position.set(-30.5, -10, 11);
  car.add(taillightL);

  const taillightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 2.5),
    taillightMat,
  );
  taillightR.position.set(-30.5, 10, 11);
  car.add(taillightR);

  const bumperMat = new THREE.MeshLambertMaterial({
    color: 0x2c2c2c,
    flatShading: true,
  });
  const bumperFront = new THREE.Mesh(
    new THREE.BoxGeometry(2, 30, 5),
    bumperMat,
  );
  bumperFront.position.set(30.5, 0, 8);
  car.add(bumperFront);

  const bumperBack = new THREE.Mesh(new THREE.BoxGeometry(1, 28, 4), bumperMat);
  bumperBack.position.set(-30.5, 0, 8);
  car.add(bumperBack);

  const frontWheel = Wheel(18);
  car.add(frontWheel);

  const backWheel = Wheel(-18);
  car.add(backWheel);

  return car;
}

function DirectionalLight() {
  const dirLight = new THREE.DirectionalLight();
  dirLight.position.set(-100, -100, 200);
  dirLight.up.set(0, 0, 1);
  dirLight.castShadow = true;

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;

  dirLight.shadow.camera.up.set(0, 0, 1);
  dirLight.shadow.camera.left = -400;
  dirLight.shadow.camera.right = 400;
  dirLight.shadow.camera.top = 400;
  dirLight.shadow.camera.bottom = -400;
  dirLight.shadow.camera.near = 50;
  dirLight.shadow.camera.far = 400;

  return dirLight;
}

function createRialChickBannerTexture(cpNumber) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#0D0D0D";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#F5C518";
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);

  ctx.fillStyle = "#F5C518";
  ctx.beginPath();
  ctx.arc(54, canvas.height / 2, 24, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0D0D0D";
  ctx.beginPath();
  ctx.arc(54, canvas.height / 2, 13, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#F5C518";
  ctx.font = "bold 38px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `CHECKPOINT ${cpNumber}`,
    canvas.width / 2 + 16,
    canvas.height / 2,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createRialChickGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.font = "bold 180px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.strokeStyle = "rgba(13,13,13,0.88)";
  ctx.lineWidth = 18;
  ctx.strokeText("Rial Chick", canvas.width / 2, canvas.height / 2 + 6);

  ctx.fillStyle = "rgba(245,197,24,0.88)";
  ctx.fillText("Rial Chick", canvas.width / 2, canvas.height / 2 + 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createRialoImageTexture() {
  const loader = new THREE.TextureLoader();
  const texture = loader.load("/images/rialo-graffiti.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createGRialoGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "blur(2px)";
  ctx.font = "bold italic 120px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(184,134,11,0.4)";
  ctx.fillText("GRialo", canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function Grass(rowIndex, isCheckpoint) {
  const grass = new THREE.Group();
  grass.position.y = rowIndex * tileSize;

  const createSection = (color) =>
    new THREE.Mesh(
      new THREE.BoxGeometry(tilesPerRow * tileSize, tileSize, 3),
      new THREE.MeshLambertMaterial({ color }),
    );

  const middleColor = isCheckpoint ? 0xF5C518 : 0xD4B483;
  const sideColor = isCheckpoint ? 0x0D0D0D : 0xC4A470;

  const middle = createSection(middleColor);
  middle.receiveShadow = true;
  grass.add(middle);

  const left = createSection(sideColor);
  left.position.x = -tilesPerRow * tileSize;
  grass.add(left);

  const right = createSection(sideColor);
  right.position.x = tilesPerRow * tileSize;
  grass.add(right);

  if (isCheckpoint) {
    const cpNumber = Math.floor(rowIndex / CP_INTERVAL);
    const postMat = new THREE.MeshLambertMaterial({
      color: 0x0D0D0D,
      flatShading: true,
    });
    const bannerMat = new THREE.MeshLambertMaterial({
      map: createRialChickBannerTexture(cpNumber),
    });

    const postL = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 40), postMat);
    postL.position.set(-tilesPerRow * tileSize * 0.35, -5, 20);
    postL.castShadow = true;
    grass.add(postL);

    const postR = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 40), postMat);
    postR.position.set(tilesPerRow * tileSize * 0.35, -5, 20);
    postR.castShadow = true;
    grass.add(postR);

    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(tilesPerRow * tileSize * 0.75, 2, 12),
      bannerMat,
    );
    banner.position.set(0, -5, 36);
    banner.castShadow = true;
    grass.add(banner);

    const gmonadGroundLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(tilesPerRow * tileSize * 0.62, tileSize * 0.7),
      new THREE.MeshBasicMaterial({
        map: createRialChickGroundTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    gmonadGroundLabel.position.set(0, 0, 1.7);
    grass.add(gmonadGroundLabel);

    // Rial Chick flags at edges
    [-1, 1].forEach((side) => {
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 18),
        new THREE.MeshLambertMaterial({ color: 0x0D0D0D, flatShading: true }),
      );
      flag.position.set(side * tilesPerRow * tileSize * 0.42, 15, 9);
      flag.castShadow = true;
      grass.add(flag);

      const flagTop = new THREE.Mesh(
        new THREE.BoxGeometry(8, 1, 5),
        new THREE.MeshLambertMaterial({ color: 0xEDE8DC, flatShading: true }),
      );
      flagTop.position.set(
        side * tilesPerRow * tileSize * 0.42 + side * 4,
        15,
        16,
      );
      grass.add(flagTop);
    });
  }

  const flowerColors = [0xff6b9d, 0xffd93d, 0xffffff, 0xc780ff, 0xff8a5c];
  const flowerCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < flowerCount; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const flowerGroup = new THREE.Group();

    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 3),
      new THREE.MeshLambertMaterial({ color: 0x4a7c1f, flatShading: true }),
    );
    stem.position.z = 3;
    flowerGroup.add(stem);

    const petal = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 2.5, 2),
      new THREE.MeshLambertMaterial({
        color: flowerColors[Math.floor(Math.random() * flowerColors.length)],
        flatShading: true,
      }),
    );
    petal.position.z = 5.5;
    flowerGroup.add(petal);

    flowerGroup.position.x =
      side * ((tilesPerRow / 2) * tileSize + 30 + Math.random() * 260);
    flowerGroup.position.y = (Math.random() - 0.5) * tileSize * 0.8;
    grass.add(flowerGroup);
  }

  if (Math.random() < 0.4) {
    const bush = new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x6fa832, flatShading: true }),
    );
    const side = Math.random() < 0.5 ? -1 : 1;
    bush.position.x =
      side * ((tilesPerRow / 2) * tileSize + 50 + Math.random() * 200);
    bush.position.y = (Math.random() - 0.5) * tileSize * 0.6;
    bush.position.z = 4.5;
    bush.castShadow = true;
    grass.add(bush);
  }

  if (rowIndex === 0) {
    const watermark = new THREE.Mesh(
      new THREE.PlaneGeometry(tilesPerRow * tileSize * 0.5, tileSize * 1.2),
      new THREE.MeshBasicMaterial({
        map: createRialoImageTexture(),
        transparent: true,
        alphaTest: 0.1,
        depthWrite: false,
      }),
    );
    watermark.position.set(0, 0, 1.8);
    grass.add(watermark);
  } else if (!isCheckpoint && rowIndex % 8 === 0) {
    const watermark = new THREE.Mesh(
      new THREE.PlaneGeometry(tilesPerRow * tileSize * 0.45, tileSize * 0.55),
      new THREE.MeshBasicMaterial({
        map: createGRialoGroundTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    watermark.position.set(0, 0, 1.8);
    grass.add(watermark);
  }

  return grass;
}

const metadata = [];

const map = new THREE.Group();

function initializeMap() {
  // Remove all rows
  metadata.length = 0;
  map.remove(...map.children);

  // Add new rows
  for (let rowIndex = 0; rowIndex > -10; rowIndex--) {
    const grass = Grass(rowIndex);
    map.add(grass);
  }
  addRows();
}

function addRows() {
  const startIndex = metadata.length;
  const newMetadata = generateRows(20, startIndex);

  metadata.push(...newMetadata);

  newMetadata.forEach((rowData, index) => {
    const rowIndex = startIndex + index + 1;

    if (rowData.type === "forest") {
      const row = Grass(rowIndex, rowData.isCheckpoint);

      rowData.trees.forEach(({ tileIndex, height, variant }) => {
        const three = Tree(tileIndex, height, variant);
        row.add(three);
      });

      map.add(row);
    }

    if (rowData.type === "car") {
      const row = Road(rowIndex);

      rowData.vehicles.forEach((vehicle) => {
        const car = Car(
          vehicle.initialTileIndex,
          rowData.direction,
          vehicle.color,
        );
        vehicle.ref = car;
        row.add(car);
      });

      map.add(row);
    }

    if (rowData.type === "truck") {
      const row = Road(rowIndex);

      rowData.vehicles.forEach((vehicle) => {
        const truck = Truck(
          vehicle.initialTileIndex,
          rowData.direction,
          vehicle.color,
        );
        vehicle.ref = truck;
        row.add(truck);
      });

      map.add(row);
    }
  });
}

const player = Player();

function Player() {
  const player = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0xfafafa,
    flatShading: true,
  });
  const combMat = new THREE.MeshLambertMaterial({
    color: 0xe63946,
    flatShading: true,
  });
  const beakMat = new THREE.MeshLambertMaterial({
    color: 0xff9f1c,
    flatShading: true,
  });
  const eyeMat = new THREE.MeshLambertMaterial({
    color: 0x111111,
    flatShading: true,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 13, 12), bodyMat);
  body.position.z = 7;
  body.castShadow = true;
  body.receiveShadow = true;
  player.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 7), bodyMat);
  head.position.set(0, 4, 17);
  head.castShadow = true;
  head.receiveShadow = true;
  player.add(head);

  const beak = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 1.5), beakMat);
  beak.position.set(0, 9, 16.5);
  beak.castShadow = true;
  player.add(beak);

  const comb1 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), combMat);
  comb1.position.set(-2, 2, 22);
  comb1.castShadow = true;
  player.add(comb1);

  const comb2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 3), combMat);
  comb2.position.set(0, 3, 22.5);
  comb2.castShadow = true;
  player.add(comb2);

  const comb3 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), combMat);
  comb3.position.set(2, 4, 22);
  comb3.castShadow = true;
  player.add(comb3);

  const wattle = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 2), combMat);
  wattle.position.set(0, 8.5, 14);
  player.add(wattle);

  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), eyeMat);
  eyeL.position.set(-2.5, 7.5, 18);
  player.add(eyeL);

  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), eyeMat);
  eyeR.position.set(2.5, 7.5, 18);
  player.add(eyeR);

  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 7), bodyMat);
  wingL.position.set(-7, -1, 8);
  wingL.castShadow = true;
  player.add(wingL);

  const wingR = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 7), bodyMat);
  wingR.position.set(7, -1, 8);
  wingR.castShadow = true;
  player.add(wingR);

  const tail1 = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 6), bodyMat);
  tail1.position.set(0, -7, 13);
  tail1.castShadow = true;
  player.add(tail1);

  const tail2 = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 4), bodyMat);
  tail2.position.set(0, -8, 17);
  tail2.castShadow = true;
  player.add(tail2);

  const legMat = new THREE.MeshLambertMaterial({
    color: 0xff9f1c,
    flatShading: true,
  });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 2), legMat);
  legL.position.set(-3, 0, 0.5);
  player.add(legL);

  const legR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 2), legMat);
  legR.position.set(3, 0, 0.5);
  player.add(legR);

  const playerContainer = new THREE.Group();
  playerContainer.add(player);

  return playerContainer;
}

const position = {
  currentRow: 0,
  currentTile: 0,
};

const movesQueue = [];

function initializePlayer() {
  // Initialize the Three.js player object
  player.position.x = 0;
  player.position.y = 0;
  player.children[0].position.z = 0;

  // Initialize metadata
  position.currentRow = 0;
  position.currentTile = 0;

  // Clear the moves queue
  movesQueue.length = 0;
}

function isInputBlocked() {
  if (gameOver) return true;
  if (bet.reconnecting) return true;
  const betPanel = document.getElementById("bet-panel");
  const depositModal = document.getElementById("deposit-modal");
  if (betPanel && betPanel.style.display !== "none") return true;
  if (depositModal && depositModal.style.display !== "none") return true;
  return false;
}

function queueMove(direction) {
  if (isInputBlocked()) return;

  if (movesQueue.length >= MAX_MOVE_QUEUE) return;

  const isValidMove = endsUpInValidPosition(
    {
      rowIndex: position.currentRow,
      tileIndex: position.currentTile,
    },
    [...movesQueue, direction],
  );

  if (!isValidMove) return;

  movesQueue.push(direction);
}

function stepCompleted() {
  const direction = movesQueue.shift();
  if (!direction) return;

  playStepSfx();

  if (direction === "forward") position.currentRow += 1;
  if (direction === "backward") position.currentRow -= 1;
  if (direction === "left") position.currentTile -= 1;
  if (direction === "right") position.currentTile += 1;

  if (hasLiveBridge()) {
    getBridge().sendMove(direction);
  }

  // Add new rows if the player is running out of them
  if (position.currentRow > metadata.length - 10) addRows();

  // Track multiplier for bet mode — only count NEW rows (anti-exploit)
  if (bet.active) {
    if (direction === "forward") {
      if (position.currentRow > bet.maxRow) {
        bet.maxRow = position.currentRow;
        onPlayerAdvance(position.currentRow);
      } else {
        if (bet.cashoutWindow && position.currentRow > bet.cpRowIndex) {
          closeCashoutWindow();
        }
        renderBetHud();
      }
    } else if (direction === "backward") {
      if (bet.cashoutWindow && position.currentRow !== bet.cpRowIndex) {
        closeCashoutWindow();
      }
      renderBetHud();
    } else {
      renderBetHud();
    }
  }

  const scoreDOM = document.getElementById("score");
  if (scoreDOM) scoreDOM.innerText = position.currentRow.toString();
}

function Renderer() {
  const canvas = document.querySelector("canvas.game");
  if (!canvas) throw new Error("Canvas not found");

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas: canvas,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  return renderer;
}

function Road(rowIndex) {
  const road = new THREE.Group();
  road.position.y = rowIndex * tileSize;

  const createSection = (color) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(tilesPerRow * tileSize, tileSize),
      new THREE.MeshLambertMaterial({ color }),
    );

  const middle = createSection(0x555555);
  middle.receiveShadow = true;
  road.add(middle);

  const left = createSection(0x444444);
  left.position.x = -tilesPerRow * tileSize;
  road.add(left);

  const right = createSection(0x444444);
  right.position.x = tilesPerRow * tileSize;
  road.add(right);

  const curbMat = new THREE.MeshLambertMaterial({
    color: 0xFFFFFF,
    flatShading: true,
  });
  const curbFront = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, 1.5, 2),
    curbMat,
  );
  curbFront.position.set(0, tileSize / 2 - 0.5, 1);
  road.add(curbFront);

  const curbBack = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, 1.5, 2),
    curbMat,
  );
  curbBack.position.set(0, -tileSize / 2 + 0.5, 1);
  road.add(curbBack);

  return road;
}

function Tree(tileIndex, _height, variant = "cone") {
  const tree = new THREE.Group();
  tree.position.x = tileIndex * tileSize;

  if (variant === "flag") {
    // Checkered flag on a tall white pole
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 40),
      new THREE.MeshLambertMaterial({ color: 0xFFFFFF, flatShading: true }),
    );
    pole.position.z = 20;
    pole.castShadow = true;
    tree.add(pole);

    // Flag base (white)
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(16, 2, 10),
      new THREE.MeshLambertMaterial({ color: 0xF0F0F0, flatShading: true }),
    );
    flag.position.set(8, 0, 43);
    flag.castShadow = true;
    tree.add(flag);

    // Dark squares overlaid to create checkered pattern
    const checkMat = new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true });
    const check1 = new THREE.Mesh(new THREE.BoxGeometry(8, 2.1, 5), checkMat);
    check1.position.set(4, 0, 45.5);
    tree.add(check1);
    const check2 = new THREE.Mesh(new THREE.BoxGeometry(8, 2.1, 5), checkMat);
    check2.position.set(12, 0, 40.5);
    tree.add(check2);

  } else if (variant === "pitboard") {
    // Pit board: short black pole + colored sign
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 20),
      new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true }),
    );
    pole.position.z = 10;
    pole.castShadow = true;
    tree.add(pole);

    const boardColor = randomElement([0xCC0000, 0x0066CC]);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(20, 2, 12),
      new THREE.MeshLambertMaterial({ color: boardColor, flatShading: true }),
    );
    board.position.set(0, 0, 26);
    board.castShadow = true;
    tree.add(board);

  } else if (variant === "floodlight") {
    // Stadium floodlight: tall pole + horizontal bracket + two lamp heads
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333, flatShading: true });
    const bracketMat = new THREE.MeshLambertMaterial({ color: 0x444444, flatShading: true });
    const lampMat = new THREE.MeshLambertMaterial({ color: 0xFFE000, flatShading: true });

    const pole = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 60), poleMat);
    pole.position.z = 30;
    pole.castShadow = true;
    tree.add(pole);

    const bracket = new THREE.Mesh(new THREE.BoxGeometry(16, 2.5, 2.5), bracketMat);
    bracket.position.z = 62;
    bracket.castShadow = true;
    tree.add(bracket);

    const lampL = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 5), lampMat);
    lampL.position.set(-9, 0, 62);
    lampL.castShadow = true;
    tree.add(lampL);

    const lampR = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 5), lampMat);
    lampR.position.set(9, 0, 62);
    lampR.castShadow = true;
    tree.add(lampR);

  } else if (variant === "tirepile") {
    // Tire pile: 3 stacked tires with white reflective stripes
    const tireMat = new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF, flatShading: true });
    const tireR = 10;
    const tireH = 7;
    const offsets = [[0, 0], [2, 1], [-1, 2]];

    offsets.forEach(([ox, oy], i) => {
      const z = i * (tireH + 1) + tireH / 2;

      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(tireR, tireR, tireH, 12),
        tireMat,
      );
      tire.rotation.x = Math.PI / 2;
      tire.position.set(ox, oy, z);
      tire.castShadow = true;
      tire.receiveShadow = true;
      tree.add(tire);

      const tireStripe = new THREE.Mesh(
        new THREE.CylinderGeometry(tireR + 0.5, tireR + 0.5, 1.5, 12),
        stripeMat,
      );
      tireStripe.rotation.x = Math.PI / 2;
      tireStripe.position.set(ox, oy, z);
      tree.add(tireStripe);
    });

  } else if (variant === "gridmarker") {
    // Starting grid: 2 flat numbered boxes side by side on the ground
    const makeGridTexture = (num) => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) return new THREE.CanvasTexture(canvas);
      ctx.fillStyle = "#FFDD00";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 80px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), 64, 64);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    };

    const n1 = Math.ceil(Math.random() * 8);
    let n2;
    do { n2 = Math.ceil(Math.random() * 8); } while (n2 === n1);

    [-20, 20].forEach((xOffset, idx) => {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(36, 18, 1),
        new THREE.MeshBasicMaterial({
          map: makeGridTexture(idx === 0 ? n1 : n2),
          transparent: true,
          opacity: 0.8,
        }),
      );
      marker.position.set(xOffset, 0, 1.8);
      marker.receiveShadow = true;
      tree.add(marker);
    });

  } else if (variant === "podium") {
    // Racing podium: 3 stepped blocks (1st tallest, 2nd medium, 3rd shortest)
    const makePodiumTexture = (num, bg) => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) return new THREE.CanvasTexture(canvas);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 80px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), 64, 64);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    };

    const steps = [
      { x: 0,   zH: 22, num: 1, bg: "#F5C518", color: 0xF5C518 },
      { x: -18, zH: 15, num: 2, bg: "#C0C0C0", color: 0xC0C0C0 },
      { x:  18, zH: 10, num: 3, bg: "#CD7F32", color: 0xCD7F32 },
    ];

    steps.forEach(({ x, zH, num, bg, color }) => {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(16, 16, zH),
        new THREE.MeshLambertMaterial({ color, flatShading: true }),
      );
      block.position.set(x, 0, zH / 2);
      block.castShadow = true;
      block.receiveShadow = true;
      tree.add(block);

      // Number label — upright, facing camera in isometric view
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(14, zH * 0.85),
        new THREE.MeshBasicMaterial({
          map: makePodiumTexture(num, bg),
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        }),
      );
      label.position.set(x, -9, zH / 2);
      label.rotation.y = Math.PI / 2;
      tree.add(label);
    });

  } else if (variant === "trophy") {
    // Racing trophy: base → stem → cup body → handles → top
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xF5C518, flatShading: true });

    const base = new THREE.Mesh(new THREE.BoxGeometry(15, 15, 5), goldMat);
    base.position.z = 2.5;
    base.castShadow = true;
    base.receiveShadow = true;
    tree.add(base);

    const stem = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 15), goldMat);
    stem.position.z = 12.5;
    stem.castShadow = true;
    tree.add(stem);

    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 10), goldMat);
    body.position.z = 25;
    body.castShadow = true;
    tree.add(body);

    const handleGeo = new THREE.BoxGeometry(5, 10, 8);
    const handleL = new THREE.Mesh(handleGeo, goldMat);
    handleL.position.set(-12.5, 0, 25);
    tree.add(handleL);
    const handleR = new THREE.Mesh(handleGeo, goldMat);
    handleR.position.set(12.5, 0, 25);
    tree.add(handleR);

    const top = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 5), goldMat);
    top.position.z = 32.5;
    top.castShadow = true;
    tree.add(top);

  } else {
    // Default: traffic cone
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(18, 18, 3),
      new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true }),
    );
    base.position.z = 1.5;
    base.castShadow = true;
    base.receiveShadow = true;
    tree.add(base);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(9, 32, 8),
      new THREE.MeshLambertMaterial({ color: 0xFF6600, flatShading: true }),
    );
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 19;
    cone.castShadow = true;
    cone.receiveShadow = true;
    tree.add(cone);

    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 7.0, 5, 8),
      new THREE.MeshLambertMaterial({ color: 0xFFFFFF, flatShading: true }),
    );
    stripe.rotation.x = Math.PI / 2;
    stripe.position.z = 11;
    stripe.castShadow = true;
    tree.add(stripe);
  }

  return tree;
}

function Truck(initialTileIndex, direction, color) {
  const truck = new THREE.Group();
  truck.position.x = initialTileIndex * tileSize;
  if (!direction) truck.rotation.z = Math.PI;

  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(70, 35, 35),
    new THREE.MeshLambertMaterial({
      color: 0xf2f2f2,
      flatShading: true,
    }),
  );
  cargo.position.x = -15;
  cargo.position.z = 25;
  cargo.castShadow = true;
  cargo.receiveShadow = true;
  truck.add(cargo);

  const cargoStripe = new THREE.Mesh(
    new THREE.BoxGeometry(72, 37, 3),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  cargoStripe.position.set(-15, 0, 22);
  truck.add(cargoStripe);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), [
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: truckFrontTexture,
    }), // front
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
    }), // back
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: truckLeftSideTexture,
    }),
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: truckRightSideTexture,
    }),
    new THREE.MeshPhongMaterial({ color, flatShading: true }), // top
    new THREE.MeshPhongMaterial({ color, flatShading: true }), // bottom
  ]);
  cabin.position.x = 35;
  cabin.position.z = 20;
  cabin.castShadow = true;
  cabin.receiveShadow = true;

  truck.add(cabin);

  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0 });
  const headlightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 3, 2),
    headlightMat,
  );
  headlightL.position.set(50.5, -10, 12);
  truck.add(headlightL);

  const headlightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 3, 2),
    headlightMat,
  );
  headlightR.position.set(50.5, 10, 12);
  truck.add(headlightR);

  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  const taillightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    taillightMat,
  );
  taillightL.position.set(-50.5, -12, 15);
  truck.add(taillightL);

  const taillightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    taillightMat,
  );
  taillightR.position.set(-50.5, 12, 15);
  truck.add(taillightR);

  const exhaust = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 12),
    new THREE.MeshLambertMaterial({ color: 0x555555, flatShading: true }),
  );
  exhaust.position.set(25, -15, 43);
  truck.add(exhaust);

  const frontWheel = Wheel(37);
  truck.add(frontWheel);

  const middleWheel = Wheel(5);
  truck.add(middleWheel);

  const backWheel = Wheel(-35);
  truck.add(backWheel);

  return truck;
}

function Wheel(x) {
  const wheel = new THREE.Mesh(
    new THREE.BoxGeometry(12, 33, 12),
    new THREE.MeshLambertMaterial({
      color: 0x333333,
      flatShading: true,
    }),
  );
  wheel.position.x = x;
  wheel.position.z = 6;
  return wheel;
}

function calculateFinalPosition(currentPosition, moves) {
  return moves.reduce((position, direction) => {
    if (direction === "forward")
      return {
        rowIndex: position.rowIndex + 1,
        tileIndex: position.tileIndex,
      };
    if (direction === "backward")
      return {
        rowIndex: position.rowIndex - 1,
        tileIndex: position.tileIndex,
      };
    if (direction === "left")
      return {
        rowIndex: position.rowIndex,
        tileIndex: position.tileIndex - 1,
      };
    if (direction === "right")
      return {
        rowIndex: position.rowIndex,
        tileIndex: position.tileIndex + 1,
      };
    return position;
  }, currentPosition);
}

function endsUpInValidPosition(currentPosition, moves) {
  // Calculate where the player would end up after the move
  const finalPosition = calculateFinalPosition(currentPosition, moves);

  // Detect if we hit the edge of the board
  if (
    finalPosition.rowIndex === -1 ||
    finalPosition.tileIndex === minTileIndex - 1 ||
    finalPosition.tileIndex === maxTileIndex + 1
  ) {
    // Invalid move, ignore move command
    return false;
  }

  // Detect if we hit a tree
  const finalRow = metadata[finalPosition.rowIndex - 1];
  if (
    finalRow &&
    finalRow.type === "forest" &&
    finalRow.trees.some((tree) => tree.tileIndex === finalPosition.tileIndex)
  ) {
    // Invalid move, ignore move command
    return false;
  }

  return true;
}

function generateRows(amount, startIndex) {
  const rows = [];
  for (let i = 0; i < amount; i++) {
    const rowIndex = startIndex + i + 1;
    rows.push(generateRow(rowIndex));
  }
  return rows;
}

function generateRow(rowIndex) {
  // Force grass row at every checkpoint position
  if (rowIndex > 0 && rowIndex % CP_INTERVAL === 0) {
    return generateCheckpointMetadata();
  }
  const type = randomElement(["car", "truck", "forest"]);
  if (type === "car") return generateCarLaneMetadata();
  if (type === "truck") return generateTruckLaneMetadata();
  return generateForesMetadata();
}

function generateCheckpointMetadata() {
  return { type: "forest", trees: [], isCheckpoint: true };
}

function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateForesMetadata() {
  const occupiedTiles = new Set();
  const trees = Array.from({ length: 4 }, () => {
    let tileIndex;
    do {
      tileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(tileIndex));
    occupiedTiles.add(tileIndex);

    const height = randomElement([20, 45, 60]);
    const variant = randomElement([
      "cone", "cone", "cone", "cone", "cone", "cone", "cone",
      "tirepile", "tirepile", "tirepile", "tirepile",
      "floodlight", "floodlight",
      "gridmarker", "gridmarker",
      "podium", "podium",
      "trophy",
      "flag",
      "pitboard",
    ]);

    return { tileIndex, height, variant };
  });

  return { type: "forest", trees };
}

function generateCarLaneMetadata() {
  const direction = randomElement([true, false]);
  const speed = randomElement([55, 72, 88]);

  const occupiedTiles = new Set();

  const vehicles = Array.from({ length: 3 }, () => {
    let initialTileIndex;
    do {
      initialTileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(initialTileIndex));
    occupiedTiles.add(initialTileIndex - 1);
    occupiedTiles.add(initialTileIndex);
    occupiedTiles.add(initialTileIndex + 1);

    const color = randomElement([
      0xCC0000, 0x0066CC, 0xFFD700, 0x00AA44, 0xFF6600, 0xF0F0F0,
    ]);

    return { initialTileIndex, color };
  });

  return { type: "car", direction, speed, vehicles };
}

function generateTruckLaneMetadata() {
  const direction = randomElement([true, false]);
  const speed = randomElement([110, 138, 165]);

  const occupiedTiles = new Set();

  const vehicles = Array.from({ length: 2 }, () => {
    let initialTileIndex;
    do {
      initialTileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(initialTileIndex));
    occupiedTiles.add(initialTileIndex - 2);
    occupiedTiles.add(initialTileIndex - 1);
    occupiedTiles.add(initialTileIndex);
    occupiedTiles.add(initialTileIndex + 1);
    occupiedTiles.add(initialTileIndex + 2);

    const color = randomElement([
      0xCC0000, 0x0066CC, 0xFFD700, 0x00AA44, 0xFF6600, 0xF0F0F0,
    ]);

    return { initialTileIndex, color };
  });

  return { type: "truck", direction, speed, vehicles };
}

const moveClock = new THREE.Clock(false);

function animatePlayer() {
  if (!movesQueue.length) return;

  if (!moveClock.running) moveClock.start();

  const stepTime = 0.2; // Seconds it takes to take a step
  const progress = Math.min(1, moveClock.getElapsedTime() / stepTime);

  setPosition(progress);
  setRotation(progress);

  // Once a step has ended
  if (progress >= 1) {
    stepCompleted();
    moveClock.stop();
  }
}

function setPosition(progress) {
  const startX = position.currentTile * tileSize;
  const startY = position.currentRow * tileSize;
  let endX = startX;
  let endY = startY;

  if (movesQueue[0] === "left") endX -= tileSize;
  if (movesQueue[0] === "right") endX += tileSize;
  if (movesQueue[0] === "forward") endY += tileSize;
  if (movesQueue[0] === "backward") endY -= tileSize;

  player.position.x = THREE.MathUtils.lerp(startX, endX, progress);
  player.position.y = THREE.MathUtils.lerp(startY, endY, progress);
  player.children[0].position.z = Math.sin(progress * Math.PI) * 8;
}

function setRotation(progress) {
  let endRotation = 0;
  if (movesQueue[0] == "forward") endRotation = 0;
  if (movesQueue[0] == "left") endRotation = Math.PI / 2;
  if (movesQueue[0] == "right") endRotation = -Math.PI / 2;
  if (movesQueue[0] == "backward") endRotation = Math.PI;

  player.children[0].rotation.z = THREE.MathUtils.lerp(
    player.children[0].rotation.z,
    endRotation,
    progress,
  );
}

const clock = new THREE.Clock();

function animateVehicles() {
  const delta = clock.getDelta();

  // Speed multiplier scales with CP count (bet mode only)
  const speedMultiplier = bet.active
    ? Math.pow(SPEED_MULT_PER_CP, bet.currentCp)
    : 1;

  // Animate cars and trucks
  metadata.forEach((rowData) => {
    if (rowData.type === "car" || rowData.type === "truck") {
      const beginningOfRow = (minTileIndex - 2) * tileSize;
      const endOfRow = (maxTileIndex + 2) * tileSize;
      const effectiveSpeed = rowData.speed * speedMultiplier;

      rowData.vehicles.forEach(({ ref }) => {
        if (!ref) throw Error("Vehicle reference is missing");

        if (rowData.direction) {
          ref.position.x =
            ref.position.x > endOfRow
              ? beginningOfRow
              : ref.position.x + effectiveSpeed * delta;
        } else {
          ref.position.x =
            ref.position.x < beginningOfRow
              ? endOfRow
              : ref.position.x - effectiveSpeed * delta;
        }
      });
    }
  });
}

document
  .getElementById("forward")
  ?.addEventListener("click", () => queueMove("forward"));

document
  .getElementById("backward")
  ?.addEventListener("click", () => queueMove("backward"));

document
  .getElementById("left")
  ?.addEventListener("click", () => queueMove("left"));

document
  .getElementById("right")
  ?.addEventListener("click", () => queueMove("right"));

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  ) {
    return;
  }

  const key = String(event.key || "").toLowerCase();
  if (event.key === "ArrowUp" || key === "w") {
    event.preventDefault(); // Avoid scrolling the page
    queueMove("forward");
  } else if (event.key === "ArrowDown" || key === "s") {
    event.preventDefault(); // Avoid scrolling the page
    queueMove("backward");
  } else if (event.key === "ArrowLeft" || key === "a") {
    event.preventDefault(); // Avoid scrolling the page
    queueMove("left");
  } else if (event.key === "ArrowRight" || key === "d") {
    event.preventDefault(); // Avoid scrolling the page
    queueMove("right");
  }
});

function hitTest() {
  if (gameOver || settlementPending) return;
  const row = metadata[position.currentRow - 1];
  if (!row) return;

  if (row.type === "car" || row.type === "truck") {
    const playerBoundingBox = new THREE.Box3();
    playerBoundingBox.setFromObject(player);

    row.vehicles.forEach(({ ref }) => {
      if (!ref) throw Error("Vehicle reference is missing");

      const vehicleBoundingBox = new THREE.Box3();
      vehicleBoundingBox.setFromObject(ref);

      if (playerBoundingBox.intersectsBox(vehicleBoundingBox)) {
        if (bet.active) {
          void crashBet("collision");
        } else {
          showResult({ type: "gameover" });
        }
      }
    });
  }
}

const scene = new THREE.Scene();
scene.add(player);
scene.add(map);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xb3d9ff, 0x88c070, 0.5);
hemiLight.position.set(0, 0, 200);
scene.add(hemiLight);

const dirLight = DirectionalLight();
dirLight.target = player;
player.add(dirLight);

const camera = Camera();
player.add(camera);

const scoreDOM = document.getElementById("score");
const scoreCpDOM = document.getElementById("score-cp");
const resultDOM = document.getElementById("result-container");

initializeGame();
initBettingUI();

// Re-fetch balance once the React bridge is fully mounted (avoids $0 on first load).
window.addEventListener("chicken:bridge-ready", () => {
  void loadBalance();
});

window.addEventListener("chicken:refresh-balance", () => {
  void loadBalance();
});

function initializeGame() {
  initializePlayer();
  initializeMap();
  gameOver = false;
  bet.reconnecting = false;
  bet.cpStayRemainingMs = 0;
  bet.isDecaying = false;
  setBetButtonState();

  if (scoreDOM) scoreDOM.innerText = "0";
  if (scoreCpDOM) scoreCpDOM.innerText = "0";
  if (resultDOM) resultDOM.style.visibility = "hidden";
}

function initBettingUI() {
  void loadBalance();
  renderTimer(SEGMENT_TIME_MS, false);

  const depositModal = document.getElementById("deposit-modal");
  const depositAmount = document.getElementById("deposit-amount");
  const depositConfirm = document.getElementById("deposit-confirm");
  const depositFaucet = document.getElementById("deposit-faucet");
  const depositManageFunds = document.getElementById("deposit-manage-funds");
  const depositStatus = document.getElementById("deposit-status");
  const depositWalletBalance = document.getElementById(
    "deposit-wallet-balance",
  );
  const depositVaultAvailable = document.getElementById(
    "deposit-vault-available",
  );
  const depositVaultLocked = document.getElementById("deposit-vault-locked");
  const depositAllowance = document.getElementById("deposit-allowance");
  const leaderboardBtn = document.getElementById("leaderboard-btn");
  const leaderboardModal = document.getElementById("leaderboard-modal");
  const leaderboardRefresh = document.getElementById("leaderboard-refresh");
  const leaderboardStatus = document.getElementById("leaderboard-status");
  const leaderboardYourRank = document.getElementById("leaderboard-your-rank");
  const leaderboardList = document.getElementById("leaderboard-list");
  const statsBtn = document.getElementById("stats-btn");
  const statsModal = document.getElementById("stats-modal");
  const statsRefresh = document.getElementById("stats-refresh");
  const statsStatus = document.getElementById("stats-status");
  const statsTotalGames = document.getElementById("stats-total-games");
  const statsTotalWins = document.getElementById("stats-total-wins");
  const statsTotalLosses = document.getElementById("stats-total-losses");
  const statsTotalProfit = document.getElementById("stats-total-profit");
  const statsJoined = document.getElementById("stats-joined");
  const statsList = document.getElementById("stats-list");
  const statsTabButtons = document.querySelectorAll("[data-stats-tab]");
  const gameHelpBtn = document.getElementById("game-help-btn");
  const gameHelpModal = document.getElementById("game-help-modal");
  const gameHelpClose = document.getElementById("game-help-close");
  const gameHelpGotIt = document.getElementById("game-help-got-it");
  let depositBusy = false;
  let startBetBusy = false;
  let leaderboardBusy = false;
  let leaderboardLastLoadedAt = 0;
  let statsBusy = false;
  let statsLastLoadedAt = 0;
  let statsActiveTab = "runs";
  let statsWalletKey = "";
  const statsCache = {
    player: null,
    sessions: [],
    transactions: [],
  };

  function setDepositStatus(message, isError = false) {
    if (!depositStatus) return;
    depositStatus.innerText = message || "";
    if (isError) depositStatus.classList.add("error");
    else depositStatus.classList.remove("error");
  }

  function setDepositBusy(nextBusy) {
    depositBusy = nextBusy;
    if (depositConfirm) depositConfirm.disabled = nextBusy;
    if (depositFaucet) depositFaucet.disabled = nextBusy;
    if (depositManageFunds) {
      if (nextBusy) {
        depositManageFunds.setAttribute("aria-disabled", "true");
        depositManageFunds.setAttribute("tabindex", "-1");
        depositManageFunds.style.pointerEvents = "none";
      } else {
        depositManageFunds.removeAttribute("aria-disabled");
        depositManageFunds.removeAttribute("tabindex");
        depositManageFunds.style.pointerEvents = "";
      }
    }
    if (!nextBusy) {
      setDepositButtonState("DEPOSIT", false);
    }
  }

  function formatDepositAmount(value, fallback = "-") {
    if (!isFinite(value)) return fallback;
    return "$" + Number(value).toFixed(2);
  }

  function shortWalletAddress(address) {
    const value = String(address || "");
    if (!value) return "-";
    if (value.length <= 13) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function normalizeWallet(address) {
    return String(address || "")
      .trim()
      .toLowerCase();
  }

  function leaderboardBestScore(entry) {
    const best = Number(entry?.best_score);
    if (isFinite(best)) return best;
    const fallback = Number(entry?.max_row_reached);
    if (isFinite(fallback)) return fallback;
    return 0;
  }

  function setLeaderboardStatus(message, isError = false) {
    if (!leaderboardStatus) return;
    leaderboardStatus.innerText = message || "";
    if (isError) leaderboardStatus.classList.add("error");
    else leaderboardStatus.classList.remove("error");
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function formatStatsUsd(value, { signed = false } = {}) {
    const amount = toFiniteNumber(value, 0);
    if (!signed) return "$" + amount.toFixed(2);
    const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
    return `${sign}$${Math.abs(amount).toFixed(2)}`;
  }

  function formatStatsDate(value, fallback = "-") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatJoinedText(value) {
    if (!value) return "Joined: -";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Joined: -";
    return (
      "Joined: " +
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    );
  }

  function shortHash(value) {
    const text = String(value || "");
    if (!text) return "-";
    if (text.length <= 13) return text;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
  }

  function setStatsStatus(message, isError = false) {
    if (!statsStatus) return;
    statsStatus.innerText = message || "";
    if (isError) statsStatus.classList.add("error");
    else statsStatus.classList.remove("error");
  }

  function setStatsSummary(playerStats) {
    const totalGames = toFiniteNumber(playerStats?.total_games, 0);
    const totalWins = toFiniteNumber(playerStats?.total_wins, 0);
    const totalLosses = toFiniteNumber(playerStats?.total_losses, 0);
    const totalProfit = toFiniteNumber(playerStats?.total_profit, 0);

    if (statsTotalGames) statsTotalGames.innerText = String(totalGames);
    if (statsTotalWins) statsTotalWins.innerText = String(totalWins);
    if (statsTotalLosses) statsTotalLosses.innerText = String(totalLosses);
    if (statsJoined)
      statsJoined.innerText = formatJoinedText(playerStats?.created_at);

    if (statsTotalProfit) {
      statsTotalProfit.innerText = formatStatsUsd(totalProfit, {
        signed: true,
      });
      statsTotalProfit.classList.remove("positive", "negative");
      if (totalProfit > 0) statsTotalProfit.classList.add("positive");
      if (totalProfit < 0) statsTotalProfit.classList.add("negative");
    }
  }

  function renderStatsEmpty(message) {
    if (!statsList) return;
    statsList.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.innerText = message;
    statsList.appendChild(empty);
  }

  function getRunBadge(status) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "CASHED_OUT") {
      return { label: "WIN", className: "win" };
    }
    if (normalized === "CRASHED") {
      return { label: "CRASH", className: "loss" };
    }
    return { label: normalized || "RUN", className: "other" };
  }

  function getTransactionBadge(type) {
    const normalized = String(type || "").toUpperCase();
    if (normalized === "DEPOSIT")
      return { label: "DEPOSIT", className: "deposit" };
    if (normalized === "WITHDRAW")
      return { label: "WITHDRAW", className: "withdraw" };
    if (normalized === "TREASURY_FUNDED")
      return { label: "FAUCET", className: "deposit" };
    if (normalized === "SESSION_STARTED")
      return { label: "BET", className: "start" };
    if (normalized === "SESSION_SETTLED")
      return { label: "SETTLED", className: "settle" };
    return { label: normalized || "EVENT", className: "other" };
  }

  function createStatsRow({
    badge,
    topText,
    dateText,
    mainText,
    valueText,
    valueTone,
  }) {
    const row = document.createElement("div");
    row.className = "stats-row";

    const top = document.createElement("div");
    top.className = "stats-row-top";

    const meta = document.createElement("div");
    meta.className = "stats-row-meta";

    const badgeEl = document.createElement("span");
    badgeEl.className = `stats-badge ${badge.className}`;
    badgeEl.innerText = badge.label;

    const topSubtle = document.createElement("span");
    topSubtle.className = "stats-row-subtle";
    topSubtle.innerText = topText;

    const dateEl = document.createElement("span");
    dateEl.className = "stats-row-date";
    dateEl.innerText = dateText;

    meta.appendChild(badgeEl);
    meta.appendChild(topSubtle);
    top.appendChild(meta);
    top.appendChild(dateEl);

    const bottom = document.createElement("div");
    bottom.className = "stats-row-bottom";

    const main = document.createElement("span");
    main.className = "stats-row-main";
    main.innerText = mainText;

    const value = document.createElement("strong");
    value.className = "stats-row-value";
    if (valueTone) value.classList.add(valueTone);
    value.innerText = valueText;

    bottom.appendChild(main);
    bottom.appendChild(value);

    row.appendChild(top);
    row.appendChild(bottom);
    return row;
  }

  function renderStatsRows() {
    if (!statsList) return;
    statsList.innerHTML = "";

    if (statsActiveTab === "txs") {
      if (!statsCache.transactions.length) {
        renderStatsEmpty("No transactions yet.");
        return;
      }

      statsCache.transactions.forEach((entry) => {
        const badge = getTransactionBadge(entry?.type);
        const amount = toFiniteNumber(entry?.amount, 0);
        const tone =
          badge.className === "withdraw" || badge.className === "settle"
            ? "positive"
            : badge.className === "deposit" || badge.className === "start"
              ? "negative"
              : "";

        const descriptor = entry?.onchain_session_id
          ? `SESSION ${shortHash(entry?.onchain_session_id)}`
          : `TX ${shortHash(entry?.tx_hash)}`;

        statsList.appendChild(
          createStatsRow({
            badge,
            topText: descriptor,
            dateText: formatStatsDate(entry?.created_at),
            mainText: `HASH ${shortHash(entry?.tx_hash)}`,
            valueText: formatStatsUsd(amount, { signed: false }),
            valueTone: tone,
          }),
        );
      });
      return;
    }

    if (!statsCache.sessions.length) {
      renderStatsEmpty("No completed runs yet.");
      return;
    }

    statsCache.sessions.forEach((entry) => {
      const badge = getRunBadge(entry?.status);
      const stake = toFiniteNumber(entry?.stake_amount, 0);
      const payout = toFiniteNumber(entry?.payout_amount, 0);
      const profit = payout - stake;
      const hops = toFiniteNumber(entry?.max_row_reached, 0);
      const multiplier = toFiniteNumber(entry?.final_multiplier, 0);

      statsList.appendChild(
        createStatsRow({
          badge,
          topText: `STAKE ${formatStatsUsd(stake)}`,
          dateText: formatStatsDate(entry?.ended_at || entry?.created_at),
          mainText: `HOPS ${hops} / ${multiplier.toFixed(2)}x`,
          valueText: formatStatsUsd(profit, { signed: true }),
          valueTone: profit > 0 ? "positive" : profit < 0 ? "negative" : "",
        }),
      );
    });
  }

  function setStatsTab(nextTab) {
    if (nextTab !== "runs" && nextTab !== "txs") return;
    statsActiveTab = nextTab;

    statsTabButtons.forEach((button) => {
      const isActive = button.dataset.statsTab === nextTab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    renderStatsRows();
  }

  function renderLeaderboardRows(entries) {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = "";

    entries.forEach((entry, index) => {
      const row = document.createElement("li");
      row.className = "leaderboard-row";

      const rankEl = document.createElement("span");
      rankEl.className = "leaderboard-rank";
      rankEl.innerText = `#${index + 1}`;

      const walletEl = document.createElement("span");
      walletEl.className = "leaderboard-wallet";
      walletEl.innerText = shortWalletAddress(entry?.wallet_address);

      const scoreEl = document.createElement("strong");
      scoreEl.className = "leaderboard-score";
      scoreEl.innerText = `HOPS ${leaderboardBestScore(entry)}`;

      row.appendChild(rankEl);
      row.appendChild(walletEl);
      row.appendChild(scoreEl);
      leaderboardList.appendChild(row);
    });
  }

  async function refreshLeaderboard(forceReload = false) {
    if (!document.getElementById("leaderboard-modal")) return;
    if (leaderboardBusy) return;

    const hasFreshCache =
      leaderboardList &&
      leaderboardList.children.length > 0 &&
      Date.now() - leaderboardLastLoadedAt < 12000;
    if (!forceReload && hasFreshCache) return;

    leaderboardBusy = true;
    if (leaderboardRefresh) leaderboardRefresh.disabled = true;
    setLeaderboardStatus("Loading leaderboard...");

    try {
      if (!hasLiveBridge()) {
        if (leaderboardList) leaderboardList.innerHTML = "";
        if (leaderboardYourRank) leaderboardYourRank.innerText = "Demo mode";
        setLeaderboardStatus(
          "Connect wallet + backend session to view leaderboard.",
        );
        return;
      }

      const bridge = getBridge();
      if (!bridge?.loadLeaderboard) {
        throw new Error("Leaderboard bridge is not ready yet.");
      }

      const payload = await bridge.loadLeaderboard();
      const leaderboard = Array.isArray(payload?.leaderboard)
        ? [...payload.leaderboard]
        : [];
      leaderboard.sort(
        (a, b) => leaderboardBestScore(b) - leaderboardBestScore(a),
      );

      const topTen = leaderboard.slice(0, 10);
      renderLeaderboardRows(topTen);

      const bridgeWallet = bridge?.getWalletAddress
        ? bridge.getWalletAddress()
        : "";
      const walletAddress = String(
        payload?.walletAddress || bridgeWallet || "",
      );
      const normalizedWallet = normalizeWallet(walletAddress);

      if (leaderboardYourRank) {
        if (!normalizedWallet) {
          leaderboardYourRank.innerText = "Wallet not found";
        } else {
          const rankIndex = leaderboard.findIndex(
            (entry) =>
              normalizeWallet(entry?.wallet_address) === normalizedWallet,
          );

          if (rankIndex >= 0) {
            const bestScore = leaderboardBestScore(leaderboard[rankIndex]);
            leaderboardYourRank.innerText = `#${rankIndex + 1} (HOPS ${bestScore})`;
          } else if (leaderboard.length > 0) {
            leaderboardYourRank.innerText = "Outside Top 100";
          } else {
            leaderboardYourRank.innerText = "-";
          }
        }
      }

      if (topTen.length === 0) {
        setLeaderboardStatus("No leaderboard data yet.");
      } else {
        setLeaderboardStatus("Top 10 players by best hops.");
      }
      leaderboardLastLoadedAt = Date.now();
    } catch (error) {
      if (leaderboardList) leaderboardList.innerHTML = "";
      if (leaderboardYourRank) leaderboardYourRank.innerText = "-";
      setLeaderboardStatus(
        formatBridgeError(error, "Failed to load leaderboard."),
        true,
      );
    } finally {
      leaderboardBusy = false;
      if (leaderboardRefresh) leaderboardRefresh.disabled = false;
    }
  }

  function openLeaderboardModal() {
    const el = document.getElementById("leaderboard-modal");
    if (!el) return;
    closeStatsModal();
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
    leaderboardBtn?.classList.add("open");
    leaderboardBtn?.setAttribute("aria-expanded", "true");
    void refreshLeaderboard();
  }

  function closeLeaderboardModal() {
    const el = document.getElementById("leaderboard-modal");
    if (!el) return;
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
    leaderboardBtn?.classList.remove("open");
    leaderboardBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleLeaderboardModal() {
    const el = document.getElementById("leaderboard-modal");
    if (!el) return;
    const isVisible = el.style.display !== "none";
    if (isVisible) closeLeaderboardModal();
    else openLeaderboardModal();
  }

  async function refreshStats(forceReload = false) {
    if (!document.getElementById("stats-modal")) return;
    if (statsBusy) return;

    const bridge = hasLiveBridge() ? getBridge() : null;
    const currentWalletKey = normalizeWallet(
      bridge?.getWalletAddress ? bridge.getWalletAddress() : "",
    );
    const hasFreshCache =
      statsCache.player &&
      statsWalletKey === currentWalletKey &&
      Date.now() - statsLastLoadedAt < 12000;
    if (!forceReload && hasFreshCache) {
      renderStatsRows();
      return;
    }

    statsBusy = true;
    if (statsRefresh) statsRefresh.disabled = true;
    setStatsStatus("Loading player stats...");
    renderStatsEmpty("Loading stats...");

    try {
      if (!hasLiveBridge()) {
        statsWalletKey = "";
        statsCache.player = null;
        statsCache.sessions = [];
        statsCache.transactions = [];
        setStatsSummary(null);
        renderStatsEmpty("Connect wallet + backend session to view stats.");
        setStatsStatus("Connect wallet + backend session to view stats.");
        return;
      }

      if (
        !bridge?.loadPlayerStats ||
        !bridge?.loadGameHistory ||
        !bridge?.loadPlayerTransactions
      ) {
        throw new Error("Stats bridge is not ready yet.");
      }

      const [playerStats, historyPayload, transactionPayload] =
        await Promise.all([
          bridge.loadPlayerStats(),
          bridge.loadGameHistory(3),
          bridge.loadPlayerTransactions(3),
        ]);

      statsCache.player = playerStats || null;
      statsCache.sessions = Array.isArray(historyPayload?.sessions)
        ? historyPayload.sessions
        : [];
      statsCache.transactions = Array.isArray(transactionPayload?.transactions)
        ? transactionPayload.transactions
        : [];
      statsWalletKey = normalizeWallet(
        playerStats?.wallet_address || currentWalletKey,
      );

      setStatsSummary(statsCache.player);
      renderStatsRows();

      if (!statsCache.sessions.length && !statsCache.transactions.length) {
        setStatsStatus("No player history yet.");
      } else {
        setStatsStatus("Recent runs and onchain activity.");
      }

      statsLastLoadedAt = Date.now();
    } catch (error) {
      statsWalletKey = "";
      statsCache.player = null;
      statsCache.sessions = [];
      statsCache.transactions = [];
      setStatsSummary(null);
      renderStatsEmpty("Could not load player stats.");
      setStatsStatus(
        formatBridgeError(error, "Failed to load player stats."),
        true,
      );
    } finally {
      statsBusy = false;
      if (statsRefresh) statsRefresh.disabled = false;
    }
  }

  function openStatsModal() {
    const el = document.getElementById("stats-modal");
    if (!el) return;
    closeLeaderboardModal();
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
    statsBtn?.classList.add("open");
    statsBtn?.setAttribute("aria-expanded", "true");
    void refreshStats();
  }

  function closeStatsModal() {
    if (!statsModal) return;
    statsModal.style.display = "none";
    statsModal.setAttribute("aria-hidden", "true");
    statsBtn?.classList.remove("open");
    statsBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleStatsModal() {
    const el = document.getElementById("stats-modal");
    if (!el) return;
    const isVisible = el.style.display !== "none";
    if (isVisible) closeStatsModal();
    else openStatsModal();
  }

  function setDepositBalanceCard(snapshot) {
    if (depositWalletBalance) {
      depositWalletBalance.innerText = formatDepositAmount(
        snapshot?.walletBalance,
      );
    }
    if (depositVaultAvailable) {
      depositVaultAvailable.innerText = formatDepositAmount(
        snapshot?.availableBalance,
        "$0.00",
      );
    }
    if (depositVaultLocked) {
      depositVaultLocked.innerText = formatDepositAmount(
        snapshot?.lockedBalance,
        "$0.00",
      );
    }
    if (depositAllowance) {
      const allowance = snapshot?.allowance;
      if (!isFinite(allowance)) depositAllowance.innerText = "-";
      else if (allowance > 999999)
        depositAllowance.innerText = "Unlimited (approved)";
      else depositAllowance.innerText = formatDepositAmount(allowance, "$0.00");
    }
  }

  async function refreshDepositBalanceCard() {
    if (hasLiveBridge()) {
      const bridge = getBridge();
      try {
        if (bridge?.loadDepositBalances) {
          const snapshot = await bridge.loadDepositBalances();
          if (isFinite(snapshot?.availableBalance)) {
            bet.balance = snapshot.availableBalance;
            renderBalance();
          }
          setDepositBalanceCard(snapshot);
          return;
        }
      } catch (error) {
        console.error("Failed to load deposit balance card:", error);
      }

      try {
        if (bridge?.loadAvailableBalance) {
          const availableBalance = await bridge.loadAvailableBalance();
          if (isFinite(availableBalance)) {
            bet.balance = availableBalance;
            renderBalance();
          }
          setDepositBalanceCard({
            walletBalance: Number.NaN,
            availableBalance,
            lockedBalance: Number.NaN,
            allowance: Number.NaN,
          });
          return;
        }
      } catch (error) {
        console.error("Failed to load fallback available balance:", error);
      }
    }

    setDepositBalanceCard({
      walletBalance: Number.NaN,
      availableBalance: bet.balance,
      lockedBalance: 0,
      allowance: Number.NaN,
    });
  }

  function openDepositModal(presetAmount) {
    if (depositAmount && isFinite(presetAmount) && presetAmount > 0) {
      depositAmount.value = String(presetAmount);
    }
    setDepositStatus("");
    void refreshDepositBalanceCard();
    if (depositModal) depositModal.style.display = "flex";
  }

  function closeDepositModal() {
    if (depositBusy) return;
    if (depositModal) depositModal.style.display = "none";
  }

  function openGameHelpModal() {
    if (gameHelpModal) gameHelpModal.style.display = "flex";
  }

  function closeGameHelpModal() {
    if (gameHelpModal) gameHelpModal.style.display = "none";
  }

  function isBetPanelVisible() {
    const panel = document.getElementById("bet-panel");
    if (!panel) return false;
    return panel.style.display !== "none";
  }

  window.addEventListener("chicken:open-deposit-modal", (event) => {
    const detail = event && "detail" in event ? event.detail : undefined;
    const presetAmount = Number(detail?.amount);
    openDepositModal(presetAmount);
  });

  window.addEventListener("chicken:open-leaderboard", () => {
    console.log("script.js: received chicken:open-leaderboard event");
    openLeaderboardModal();
  });

  window.addEventListener("chicken:open-stats", () => {
    console.log("script.js: received chicken:open-stats event");
    openStatsModal();
  });

  leaderboardBtn?.addEventListener("click", () => {
    toggleLeaderboardModal();
  });

  statsBtn?.addEventListener("click", () => {
    toggleStatsModal();
  });

  statsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setStatsTab(button.dataset.statsTab || "runs");
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    const leaderboardVisible =
      leaderboardModal &&
      leaderboardBtn &&
      leaderboardModal.style.display !== "none";
    if (
      leaderboardVisible &&
      !leaderboardModal.contains(target) &&
      !leaderboardBtn.contains(target)
    ) {
      closeLeaderboardModal();
    }

    const statsVisible =
      statsModal && statsBtn && statsModal.style.display !== "none";
    if (
      statsVisible &&
      !statsModal.contains(target) &&
      !statsBtn.contains(target)
    ) {
      closeStatsModal();
    }
  });

  leaderboardRefresh?.addEventListener("click", () => {
    void refreshLeaderboard(true);
  });

  statsRefresh?.addEventListener("click", () => {
    void refreshStats(true);
  });

  gameHelpBtn?.addEventListener("click", () => {
    openGameHelpModal();
  });

  gameHelpClose?.addEventListener("click", () => {
    closeGameHelpModal();
  });

  gameHelpGotIt?.addEventListener("click", () => {
    closeGameHelpModal();
  });

  gameHelpModal?.addEventListener("click", (event) => {
    if (event.target === gameHelpModal) closeGameHelpModal();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeGameHelpModal();
      closeLeaderboardModal();
      closeStatsModal();
    }
  });

  window.addEventListener("chicken:deposit-progress", (event) => {
    const detail = event && "detail" in event ? event.detail : undefined;
    const phase = String(detail?.phase || "");
    const message = String(detail?.message || "");

    if (message) setDepositStatus(message, false);

    if (phase === "done") {
      dispatchPlayStatus({ clear: true });
      setDepositButtonState("DEPOSIT", false);
      return;
    }

    if (message) {
      dispatchPlayStatus({
        message,
        tone: "busy",
        sticky: true,
      });
    }

    if (phase === "approve_sign") {
      setDepositButtonState("SIGN 1/2", true);
      return;
    }
    if (phase === "approve_pending") {
      setDepositButtonState("PENDING...", true);
      return;
    }
    if (phase === "deposit_sign") {
      setDepositButtonState("SIGN 2/2", true);
      return;
    }
    if (phase === "deposit_pending") {
      setDepositButtonState("PENDING...", true);
      return;
    }
  });

  document.getElementById("bet-btn")?.addEventListener("click", () => {
    if (bet.active) return;
    if (startBetBusy) return;
    hideResult();
    showBetPanel(!isBetPanelVisible());
  });

  depositConfirm?.addEventListener("click", async () => {
    const amountText = String(depositAmount?.value || "").trim();
    const amt = parseFloat(amountText);
    if (!isFinite(amt) || amt <= 0) {
      setDepositStatus("Enter a valid USDC amount.", true);
      return;
    }

    if (hasLiveBridge()) {
      const bridge = getBridge();
      if (!bridge?.depositToVault) {
        setDepositStatus("Deposit bridge is not ready yet.", true);
        return;
      }

      setDepositBusy(true);
      setDepositButtonState("PROCESSING...", true);
      setDepositStatus("Submitting deposit...");
      try {
        const result = await bridge.depositToVault(amountText);
        if (isFinite(result?.availableBalance)) {
          bet.balance = result.availableBalance;
          renderBalance();
        }

        if (result?.approveTxHash) {
          setDepositStatus("Approve + deposit confirmed.");
        } else {
          setDepositStatus("Deposit confirmed.");
        }
        dispatchPlayStatus({
          message: "DEPOSIT CONFIRMED.",
          tone: "ready",
          durationMs: 2600,
        });

        window.setTimeout(() => {
          closeDepositModal();
        }, 350);
      } catch (error) {
        const message = formatBridgeError(
          error,
          "Deposit failed.",
          "Deposit was canceled in wallet.",
        );
        setDepositStatus(message, true);
        dispatchPlayStatus({
          message,
          tone: "error",
          durationMs: 4200,
        });
        setDepositButtonState("DEPOSIT", false);
      } finally {
        setDepositBusy(false);
        void loadBalance();
        void refreshDepositBalanceCard();
      }
      return;
    }

    const success = deposit(amt);
    if (success) {
      void refreshDepositBalanceCard();
      closeDepositModal();
    } else setDepositStatus("Deposit failed.", true);
  });

  depositFaucet?.addEventListener("click", async () => {
    if (hasLiveBridge()) {
      const bridge = getBridge();
      if (!bridge?.claimFaucet) {
        setDepositStatus("Faucet bridge is not ready yet.", true);
        return;
      }

      setDepositBusy(true);
      setDepositButtonState("CLAIMING...", true);
      setDepositStatus("Claiming faucet...");
      dispatchPlayStatus({
        message: "CLAIMING FAUCET...",
        tone: "busy",
        sticky: true,
      });
      try {
        await bridge.claimFaucet();
        setDepositStatus("Faucet claimed. Continue to deposit.");
        dispatchPlayStatus({
          message: "FAUCET CLAIMED.",
          tone: "ready",
          durationMs: 2600,
        });
        setDepositButtonState("DEPOSIT", false);
      } catch (error) {
        const message = formatBridgeError(
          error,
          "Faucet claim failed.",
          "Faucet claim was canceled in wallet.",
        );
        setDepositStatus(message, true);
        dispatchPlayStatus({
          message,
          tone: "error",
          durationMs: 4200,
        });
        setDepositButtonState("DEPOSIT", false);
      } finally {
        setDepositBusy(false);
        void loadBalance();
        void refreshDepositBalanceCard();
      }
      return;
    }

    deposit(100);
    void refreshDepositBalanceCard();
    setDepositStatus("Mock +$100 added.");
  });

  document.getElementById("deposit-close")?.addEventListener("click", () => {
    closeDepositModal();
  });

  document.getElementById("bet-panel-close")?.addEventListener("click", () => {
    showBetPanel(false);
  });

  document.querySelectorAll("[data-deposit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (depositAmount) depositAmount.value = btn.dataset.deposit;
    });
  });

  const stakeInput = document.getElementById("stake-input");
  document.querySelectorAll("[data-amount]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (stakeInput) stakeInput.value = btn.dataset.amount;
    });
  });

  function showErrorToast(msg) {
    const panel = document.getElementById("bet-panel");
    if (!panel) return;
    let toast = document.getElementById("bet-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "bet-toast";
      toast.className = "flow-alert";
      toast.style.marginTop = "10px";
      toast.style.marginBottom = "10px";
      const btnContainer =
        document.getElementById("start-bet-btn")?.parentElement;
      if (btnContainer && btnContainer.parentNode) {
        btnContainer.parentNode.insertBefore(toast, btnContainer);
      } else {
        panel.appendChild(toast);
      }
    }
    toast.innerText = msg;
    toast.style.display = "block";
    setTimeout(() => {
      toast.style.display = "none";
    }, 3000);
  }

  const startBetBtn = document.getElementById("start-bet-btn");
  startBetBtn?.addEventListener("click", async () => {
    if (startBetBusy) return;
    const stake = parseFloat(stakeInput?.value || "0");
    if (!isFinite(stake) || stake <= 0) {
      showErrorToast("Enter a valid stake amount");
      return;
    }
    if (!hasLiveBridge() && stake > bet.balance) {
      const msg = `Insufficient balance. Available $${bet.balance.toFixed(2)}. Claim faucet to top up.`;
      showErrorToast(msg);
      showGlobalErrorToast(msg);
      return;
    }

    if (hasLiveBridge()) {
      const bridge = getBridge();
      if (bridge?.loadAvailableBalance) {
        try {
          const available = await bridge.loadAvailableBalance();
          if (!isFinite(available) || available < stake) {
            const msg = `Insufficient balance. Available $${(available || 0).toFixed(2)}. Claim faucet to top up.`;
            showErrorToast(msg);
            showGlobalErrorToast(msg);
            return;
          }
        } catch (error) {
          const message = formatBridgeError(
            error,
            "Failed to check vault balance.",
            "Request was canceled in wallet.",
          );
          console.error("Failed to load available vault balance:", error);
          dispatchPlayStatus({
            message,
            tone: "error",
            durationMs: 4200,
          });
          showErrorToast(message);
          showGlobalErrorToast(message);
          return;
        }
      }
    }

    startBetBusy = true;
    let keepStatusMessage = false;
    dispatchPlayStatus({
      message: "STARTING BET...",
      tone: "busy",
      sticky: true,
    });
    if (startBetBtn) {
      startBetBtn.innerText = "STARTING...";
      startBetBtn.disabled = true;
    }

    try {
      const started = await startBet(stake);
      if (!started) {
        keepStatusMessage = true;
      } else {
        dispatchPlayStatus({ clear: true });
      }
    } finally {
      startBetBusy = false;
      if (startBetBtn) {
        startBetBtn.innerText = "START BET";
        startBetBtn.disabled = false;
      }
      if (!bet.active && !keepStatusMessage) {
        dispatchPlayStatus({ clear: true });
      }
    }
  });

  document.getElementById("free-play-btn")?.addEventListener("click", () => {
    hideResult();
    showBetPanel(false);
    stopBetTicker();
    bet.active = false;
    setBetButtonState();
    initializeGame();
  });

  document.getElementById("cash-out-btn")?.addEventListener("click", () => {
    void cashOut("manual");
  });

  document.getElementById("retry")?.addEventListener("click", () => {
    hideResult();
    showBetPanel(true);
    stopBetTicker();
    bet.active = false;
    setBetButtonState();
    initializeGame();
  });

  showBetPanel(true);
  setBetButtonState();
  setDepositButtonState("DEPOSIT", false);
  setStatsSummary(null);
  setStatsTab("runs");

  window.addEventListener("chicken:game-error", (event) => {
    const message = event?.detail?.message;
    if (message) {
      console.error("Backend game error:", message);
      dispatchPlayStatus({
        message,
        tone: "error",
        durationMs: 4200,
      });
      showErrorToast(message);
      showGlobalErrorToast(message);
    }
  });

  window.addEventListener("chicken:start-bet-failed", (event) => {
    const message =
      event?.detail?.message || "Start bet failed. Please try again.";

    const wasBetActive = bet.active;
    stopBetTicker();
    bet.active = false;
    bet.reconnecting = false;
    bet.cashoutWindow = false;
    bet.segmentActive = false;
    bet.cpStayRemainingMs = 0;
    bet.isDecaying = false;
    setBetButtonState();
    renderBetHud();
    showBetHud(false);
    if (!wasBetActive) {
      showBetPanel(true);
    } else {
      showBetPanel(false);
    }
    dispatchPlayStatus({
      message,
      tone: "error",
      durationMs: 4200,
    });
    showErrorToast(message);
    void loadBalance();
  });

  window.addEventListener("chicken:server-crash", (event) => {
    if (!bet.active) return;
    const payload = event?.detail || {};
    const reason = String(payload.reason || "");
    const isDecayTimeout = reason === "decay_timeout";

    bet.active = false;
    stopBetTicker();
    setBetButtonState();
    showBetHud(false);
    dispatchPlayStatus({ clear: true });

    const mult = payload.multiplier != null ? Number(payload.multiplier) : 0;
    const lostStake = bet.stake;

    playCrashSfx();
    const resultDOM = document.getElementById("result-container");
    const titleEl = document.getElementById("result-title");
    const bodyEl = document.getElementById("result-body");
    if (resultDOM && titleEl && bodyEl) {
      gameOver = true;
      movesQueue.length = 0;
      titleEl.innerText = isDecayTimeout ? "TIME'S UP" : "CRASHED";
      titleEl.style.color = "#c0392b";
      bodyEl.innerHTML = `
        <p>Last checkpoint: <strong>${bet.currentCp}</strong></p>
        <p>Hops survived: <strong>${bet.maxRow}</strong></p>
        <p>Last multiplier: <strong>${mult.toFixed(2)}x</strong></p>
        <p class="profit-negative">Lost: -$${lostStake.toFixed(2)}</p>
      `;
      resultDOM.style.visibility = "visible";

      if (_resultAutoHideTimer) clearTimeout(_resultAutoHideTimer);
      _resultAutoHideTimer = setTimeout(() => {
        _resultAutoHideTimer = null;
        if (resultDOM.style.visibility === "visible") {
          hideResult();
          showBetPanel(true);
          initializeGame();
        }
      }, 3000);
    }

    dispatchPlayStatus({
      message: isDecayTimeout
        ? "TIME'S UP — Multiplier decayed to 0."
        : "Run ended by server.",
      tone: "warning",
      durationMs: 5000,
    });

    void loadBalance();
  });

  window.addEventListener("chicken:game-disconnected", () => {
    if (!bet.active) return;

    pauseActiveBetForReconnect();
    dispatchPlayStatus({
      message: "RUN PAUSED. RECONNECTING...",
      tone: "busy",
      sticky: true,
    });
  });

  window.addEventListener("chicken:active-session-found", (event) => {
    const snapshot = event?.detail;
    // Only show if not already in a bet and dialog isn't already up
    if (!bet.active && _pendingRecoverySnapshot === null) {
      showSessionRecoveryDialog(snapshot);
    }
  });

  window.addEventListener("chicken:game-reconnected", (event) => {
    const snapshot = event?.detail;

    if (bet.reconnecting) {
      // Connection drop within same session — auto-restore without asking
      const restored = restoreActiveBetFromSnapshot(snapshot);
      if (!restored) return;
      dispatchPlayStatus({
        message: "RUN RECONNECTED.",
        tone: "ready",
        durationMs: 2600,
      });
      return;
    }

    // Fresh page load — skip if HTTP check already showed the dialog
    if (_pendingRecoverySnapshot !== null || bet.active) return;
    showSessionRecoveryDialog(snapshot);
  });

  document.getElementById("session-recovery-continue")?.addEventListener("click", () => {
    const snapshot = _pendingRecoverySnapshot;
    hideSessionRecoveryDialog();
    if (!snapshot) return;
    const restored = restoreActiveBetFromSnapshot(snapshot);
    if (restored) {
      dispatchPlayStatus({
        message: "RUN RECONNECTED.",
        tone: "ready",
        durationMs: 2600,
      });
    }
  });

  document.getElementById("session-recovery-cancel")?.addEventListener("click", async () => {
    hideSessionRecoveryDialog();
    const bridge = getBridge();
    if (bridge && !bridge.backgroundMode) {
      try {
        await bridge.crash("session_abandoned");
      } catch (err) {
        console.error("Failed to end abandoned session:", err);
      }
      void loadBalance();
    }
    showBetPanel(true);
  });

  window.addEventListener("chicken:game-reconnect-expired", (event) => {
    const message =
      event?.detail?.message ||
      "Connection to server was lost too long. Run stopped.";

    resetBetAfterReconnectFailure();
    initializeGame();
    showBetPanel(true);
    dispatchPlayStatus({
      message,
      tone: "error",
      durationMs: 4200,
    });
    showErrorToast(message);
    void loadBalance();
  });

  window.addEventListener("chicken:cp-expired", (event) => {
    // Backend closed the CP window — update local state and HUD
    bet.cashoutWindow = false;
    bet.cpStayRemainingMs = 0;
    bet.isDecaying = false;
    renderBetHud();
    const msg =
      event?.detail?.message || "Checkpoint window expired — keep moving!";
    dispatchPlayStatus({
      message: msg,
      tone: "info",
      durationMs: 3200,
    });
    showErrorToast("⏰ " + msg);
  });

  document
    .getElementById("leaderboard-close-btn")
    ?.addEventListener("click", () => {
      closeLeaderboardModal();
    });

  document.getElementById("stats-close-btn")?.addEventListener("click", () => {
    closeStatsModal();
  });

  document
    .getElementById("leaderboard-modal")
    ?.addEventListener("click", (e) => {
      if (e.target.id === "leaderboard-modal") closeLeaderboardModal();
    });

  document.getElementById("stats-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "stats-modal") closeStatsModal();
  });
}

const renderer = Renderer();
renderer.setAnimationLoop(animate);

window.addEventListener("resize", () => {
  const size = 300;
  const viewRatio = window.innerWidth / window.innerHeight;
  const width = viewRatio < 1 ? size : size * viewRatio;
  const height = viewRatio < 1 ? size / viewRatio : size;

  camera.left = width / -2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = height / -2;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
});

function animate() {
  animateVehicles();
  animatePlayer();
  hitTest();

  renderer.render(scene, camera);
}
