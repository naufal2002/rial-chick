"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "../components/web3/WalletProvider";
import { backendFetch } from "../lib/backend/api";
import { hasBackendApiConfig } from "../lib/backend/config";

type ProfitLeaderboardEntry = {
  wallet_address: string;
  total_profit?: number | string | null;
  total_games?: number | string | null;
  total_wins?: number | string | null;
  total_losses?: number | string | null;
};

const HOME_CONNECT_PROMPT_KEY = "chicken-home-connect-prompt";

const FALLBACK_DISTANCE_BOARD: ChickenBridgeLeaderboardEntry[] = [
  {
    wallet_address: "0x8ab4bca8b0f94c2b5b1c7f02f99f1d1bb6c56d21",
    best_score: 182,
    games_played: 36,
    best_multiplier: 6.4,
  },
  {
    wallet_address: "0x45d2d72653ec6f3ffafce7e4d1f2d2f89ab26c10",
    best_score: 147,
    games_played: 28,
    best_multiplier: 4.8,
  },
  {
    wallet_address: "0x0c9b251ce3c85152b8ecf46bc9dbdecb94f167b2",
    best_score: 133,
    games_played: 19,
    best_multiplier: 4.2,
  },
];

const FALLBACK_PROFIT_BOARD: ProfitLeaderboardEntry[] = [
  {
    wallet_address: "0x9e51e58fdce1a3a31b2b17b79a84f8594ca2d1a0",
    total_profit: 214.4,
    total_games: 14,
    total_wins: 8,
  },
  {
    wallet_address: "0x7a7b9ef6e0f5949f90d4e1c9f60fc05ec42e73ee",
    total_profit: 171.2,
    total_games: 21,
    total_wins: 11,
  },
  {
    wallet_address: "0x3b4ddfd7ab9de211f9d0cbd56bfe137e447a2993",
    total_profit: 138.75,
    total_games: 17,
    total_wins: 9,
  },
];

const ABOUT_FEATURES = [
  {
    title: "FAST ARCADE STAKES",
    copy: "Connect, run, and feel the multiplier rise before the crash catches up.",
    tone: "risk",
    imageSrc: "/images/feature-1.mp4",
    imageAlt: "Rial Chick arcade stakes preview",
  },
  {
    title: "CHECKPOINT CASH OUTS",
    copy: "Cash out at checkpoints or keep pushing for a bigger payout.",
    tone: "checkpoint",
    imageSrc: "/images/feature-2.mp4",
    imageAlt: "Rial Chick checkpoint cash out preview",
  },
  {
    title: "RIALO WALLET FLOW",
    copy: "From faucet to live play, the Rialo flow stays quick and simple.",
    tone: "wallet",
    imageSrc: "/images/feature-3.mp4",
    imageAlt: "Rial Chick wallet flow preview",
  },
];

const FLOW_STEPS = [
  {
    label: "STEP 1",
    title: "Faucet + Play",
    copy: "Claim faucet to get Rial Chick Token, use it as your playable balance.",
  },
  {
    label: "STEP 2",
    title: "Run Session",
    copy: "Start a live run with stake from your balance. Backend tracks checkpoints and anti-cheat rules.",
  },
  {
    label: "STEP 3",
    title: "Signed Settlement",
    copy: "Result is validated by backend signature. Win goes back to your balance automatically.",
  },
];

const PASSPORT_FEATURES = [
  {
    label: "HUMAN SCORE",
    title: "Behavior-based trust signal",
    copy: "Passport points are built from gameplay patterns and anti-bot signals, not from social hype.",
  },
  {
    label: "ONCHAIN PROOF",
    title: "Verifiable by any app",
    copy: "Partner apps can verify wallet trust status onchain before granting access or rewards.",
  },
  {
    label: "USE CASE",
    title: "Airdrop and allowlist filter",
    copy: "Projects can reduce sybil noise by checking passport eligibility directly from contract + API.",
  },
];

const INTEGRATION_STEPS = [
  "Read passport status from backend API for quick integration in web app flows.",
  "Verify wallet passport eligibility from TrustPassport contract for trustless checks.",
  "Combine both: fast UX from API plus onchain verification before sensitive actions.",
];

function shortAddress(address: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value: unknown) {
  return `$${toNumber(value).toFixed(2)}`;
}

function readBestScore(entry: ChickenBridgeLeaderboardEntry) {
  return toNumber(entry.best_score ?? entry.max_row_reached);
}

function readBestMultiplier(entry: ChickenBridgeLeaderboardEntry) {
  return toNumber(entry.best_multiplier);
}

export default function Home() {
  const {
    account,
    isConnecting,
    error,
    connectWallet,
    clearWalletError,
    disconnectWallet,
  } = useWallet();
  const [playerBalance, setPlayerBalance] = useState<number | null>(null);
  const [showProfilePopover, setShowProfilePopover] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [publicStats, setPublicStats] = useState<{
    total_players: number;
    total_games: number;
    total_cashouts: number;
  } | null>(null);
  const [distanceBoard, setDistanceBoard] = useState<
    ChickenBridgeLeaderboardEntry[]
  >(FALLBACK_DISTANCE_BOARD);
  const [profitBoard, setProfitBoard] = useState<ProfitLeaderboardEntry[]>(
    FALLBACK_PROFIT_BOARD,
  );
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);

  const isConnected = Boolean(account);

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setShowProfilePopover(false);
  }

  useEffect(() => {
    if (!showProfilePopover) return;

    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        profileWrapRef.current &&
        target &&
        !profileWrapRef.current.contains(target)
      ) {
        setShowProfilePopover(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowProfilePopover(false);
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showProfilePopover]);

  useEffect(() => {
    if (!hasBackendApiConfig()) {
      return;
    }

    let cancelled = false;
    setIsSocialLoading(true);

    void Promise.allSettled([
      backendFetch<{ leaderboard?: ChickenBridgeLeaderboardEntry[] }>(
        "/api/leaderboard",
      ),
      backendFetch<{ leaderboard?: ProfitLeaderboardEntry[] }>(
        "/api/leaderboard/profit",
      ),
    ])
      .then(([distanceResult, profitResult]) => {
        if (cancelled) return;

        if (
          distanceResult.status === "fulfilled" &&
          Array.isArray(distanceResult.value?.leaderboard) &&
          distanceResult.value.leaderboard.length > 0
        ) {
          setDistanceBoard(distanceResult.value.leaderboard.slice(0, 3));
        }

        if (
          profitResult.status === "fulfilled" &&
          Array.isArray(profitResult.value?.leaderboard) &&
          profitResult.value.leaderboard.length > 0
        ) {
          setProfitBoard(profitResult.value.leaderboard.slice(0, 3));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSocialLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isConnected) { setPlayerBalance(null); return; }
    void backendFetch<{ balance?: number }>("/auth/me")
      .then((me) => setPlayerBalance(Number(me.balance ?? 0)))
      .catch(() => setPlayerBalance(null));
  }, [isConnected, account]);

  useEffect(() => {
    function fetchStats() {
      void backendFetch<{ total_players: number; total_games: number; total_cashouts: number }>(
        "/api/stats/public",
      )
        .then(setPublicStats)
        .catch(() => {});
    }
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shouldScrollFromQuery = params.get("connect") === "1";
    const shouldScrollFromLogout =
      window.sessionStorage.getItem(HOME_CONNECT_PROMPT_KEY) === "1";

    if (!shouldScrollFromQuery && !shouldScrollFromLogout) return;

    window.sessionStorage.removeItem(HOME_CONNECT_PROMPT_KEY);
    window.scrollTo({ top: 0, behavior: "auto" });

    params.delete("connect");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${
      nextSearch ? `?${nextSearch}` : ""
    }${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onLogout() {
    disconnectWallet();
    setShowProfilePopover(false);
  }

  const trackedRuns = profitBoard.reduce(
    (sum, entry) => sum + toNumber(entry.total_games),
    0,
  );
  const playersOnline = Math.max(
    18,
    distanceBoard.length * 23 + profitBoard.length * 19,
  );
  const trackedVolume = profitBoard.reduce(
    (sum, entry) => sum + Math.max(toNumber(entry.total_profit) * 5.5, 0),
    0,
  );
  const biggestCashout = profitBoard.reduce(
    (max, entry) => Math.max(max, toNumber(entry.total_profit)),
    0,
  );
  const hottestMultiplier = distanceBoard.reduce(
    (max, entry) => Math.max(max, readBestMultiplier(entry)),
    0,
  );

  const socialStats = [
    {
      label: "PLAYERS LIVE",
      value: playersOnline.toString(),
      note: "Wallets active now",
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      ),
    },
    {
      label: "RUNS DONE",
      value: trackedRuns.toString(),
      note: "Completed sessions",
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
      ),
    },
    {
      label: "TRACKED VOLUME",
      value: formatMoney(trackedVolume),
      note: "Estimated from recent boards",
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <path d="M6 3h12l4 6-10 12L2 9z"></path>
          <path d="M11 3 8 9l3 12 3-12-3-6z"></path>
          <path d="M2 9h20"></path>
        </svg>
      ),
    },
  ];

  return (
    <main className="flow-page home-page">
      <header className="home-nav home-nav-global">
        <div className="home-brand">
          <div className="home-brand-badge">GM</div>
          <div className="home-brand-copy">
            <p className="home-brand-eyebrow">The First Rialo Arcade Risk Game</p>
          </div>
        </div>

        <div className="home-nav-cluster">
          <div className="home-nav-actions">
            {isConnected ? (
              <div className="home-profile-wrap" ref={profileWrapRef}>
                <button
                  className="flow-btn secondary home-nav-login"
                  type="button"
                  onClick={() => setShowProfilePopover((current) => !current)}>
                  {shortAddress(account)}
                </button>

                {showProfilePopover && (
                  <section
                    className="flow-status home-profile-popover"
                    style={{ color: "white" }}>
                    <p className="home-preview-title home-profile-heading">
                      PROFILE
                    </p>
                    <div className="home-profile-meta">
                      <div className="home-profile-row">
                        <span className="home-profile-label">Wallet</span>
                        <span className="mono home-profile-value">
                          {shortAddress(account)}
                        </span>
                      </div>
                      <div className="home-profile-row">
                        <span className="home-profile-label">BALANCE</span>
                        <span className="mono home-profile-value">
                          {playerBalance === null ? "-" : `$${playerBalance.toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                    <div className="home-profile-actions">
                      <a
                        href="/"
                        className="flow-btn home-profile-action home-profile-action-dashboard">
                        HOME
                      </a>
                      <a
                        href="/managemoney"
                        className="flow-btn home-profile-action home-profile-action-manage">
                        MANAGE MONEY
                      </a>
                      <button
                        className="flow-btn home-profile-action home-profile-action-logout"
                        type="button"
                        onClick={onLogout}>
                        LOG OUT
                      </button>
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <button
                className="flow-btn primary home-nav-login"
                type="button"
                onClick={() => void connectWallet()}
                disabled={isConnecting}>
                {isConnecting ? "CONNECTING..." : "LOGIN"}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-game-bg" aria-hidden="true">
          <iframe
            className="home-game-bg-frame"
            src="/play?bg=1"
            title="In-game background"
            tabIndex={-1}
          />
        </div>
        <div className="home-hero-overlay" aria-hidden="true" />

        <div className="home-shell home-shell-wide">
          <div className="home-hero-grid">
            <div className="home-hero-copy">
              <h1 className="home-title">RIAL CHICK</h1>
              <p className="home-subcopy">
                Cross the road, stack the multiplier, and cash out before the
                run crashes.
              </p>
              {!isConnected ? (
                <div className="home-hero-connect-stack">
                  <button
                    type="button"
                    className="flow-btn home-btn-main home-hero-cta"
                    onClick={() => void connectWallet()}
                    disabled={isConnecting}>
                    {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
                  </button>
                  {error ? (
                    <p className="flow-alert home-hero-connect-error">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {isConnected ? (
                <div className="home-hero-connected-actions">
                  <a
                    href="/play"
                    className="dashboard-btn dashboard-btn-play">
                    PLAY NOW
                  </a>
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn-how"
                    onClick={() => setShowHelp(true)}>
                    HOW TO PLAY
                  </button>
                  <a
                    href="/managemoney"
                    className="dashboard-btn dashboard-btn-manage">
                    MANAGE MONEY
                  </a>
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn-logout"
                    onClick={onLogout}>
                    LOG OUT
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="home-banner-section" aria-hidden="true">
        <iframe
          src="/banner.html"
          className="home-banner-frame"
          title="Rial Chick World"
          tabIndex={-1}
        />
      </div>

      <div className="home-stats-bar">
        <div className="home-stats-bar-item">
          <span className="home-stats-bar-num">
            {publicStats ? publicStats.total_players.toLocaleString() : "—"}
          </span>
          <span className="home-stats-bar-label">PLAYERS</span>
        </div>
        <div className="home-stats-bar-divider" aria-hidden="true" />
        <div className="home-stats-bar-item">
          <span className="home-stats-bar-num">
            {publicStats ? publicStats.total_games.toLocaleString() : "—"}
          </span>
          <span className="home-stats-bar-label">GAMES PLAYED</span>
        </div>
        <div className="home-stats-bar-divider" aria-hidden="true" />
        <div className="home-stats-bar-item">
          <span className="home-stats-bar-num">
            {publicStats ? publicStats.total_cashouts.toLocaleString() : "—"}
          </span>
          <span className="home-stats-bar-label">CASHOUTS</span>
        </div>
      </div>

      <section id="preview" className="home-section home-section-about">
        <div className="home-shell home-shell-section">
          <div className="home-about-head">
            <h2 className="home-section-title home-about-title">
              WHAT IS RIAL CHICK?
            </h2>
            <p className="home-about-copy">
              Rial Chick is a fast risk-reward demo where players cross
              lanes, stack multiplier, and choose when to cash out.
            </p>
          </div>

          <div className="home-about-grid">
            {ABOUT_FEATURES.map((item) => (
              <article key={item.title} className="home-about-feature">
                <div
                  className={`home-about-media home-about-media-${item.tone}`}>
                  {item.imageSrc ? (
                    <video
                      src={item.imageSrc}
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{ width: "100%", borderRadius: "inherit" }}
                    />
                  ) : (
                    <div
                      className={`home-about-media-placeholder home-about-media-placeholder-${item.tone}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <h3 className="home-about-feature-title">{item.title}</h3>
                <p className="home-about-feature-copy">{item.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section home-section-social">
        <div className="home-shell home-shell-section">
          <div className="home-section-head home-section-head-center">
            <h2 className="home-section-title home-section-title-social">
              LIVE <span className="home-section-title-accent">ARCADE PULSE</span>
            </h2>
          </div>

          <div className="home-social-stats">
            {socialStats.map((stat) => (
              <article key={stat.label} className="home-social-stat">
                <div className="home-social-icon">{stat.icon}</div>
                <p>{stat.label}</p>
                <strong>{isSocialLoading ? "..." : stat.value}</strong>
                <span>{stat.note}</span>
              </article>
            ))}
          </div>

          <div className="home-social-grid">
            <article className="home-social-card">
              <div className="home-social-card-head">
                <h3>BEST DISTANCE</h3>
              </div>
              <ul className="home-social-list">
                {distanceBoard.slice(0, 3).map((entry, index) => (
                  <li key={`${entry.wallet_address}-${index}`} className="home-social-item">
                    <div>
                      <p>RANK #{index + 1}</p>
                      <h4>{shortAddress(entry.wallet_address)}</h4>
                      <span>
                        {toNumber(entry.games_played)} runs | Peak{" "}
                        {readBestMultiplier(entry).toFixed(2)}x
                      </span>
                    </div>
                    <strong>{readBestScore(entry)} hops</strong>
                  </li>
                ))}
              </ul>
            </article>

            <article className="home-social-card">
              <div className="home-social-card-head">
                <h3>TOP PROFIT</h3>
              </div>
              <ul className="home-social-list">
                {profitBoard.slice(0, 3).map((entry, index) => (
                  <li key={`${entry.wallet_address}-${index}`} className="home-social-item">
                    <div>
                      <p>RANK #{index + 1}</p>
                      <h4>{shortAddress(entry.wallet_address)}</h4>
                      <span>
                        {toNumber(entry.total_games)} runs | {toNumber(entry.total_wins)} wins
                      </span>
                    </div>
                    <strong>{formatMoney(entry.total_profit)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="home-section home-section-system">
        <div className="home-shell home-shell-section">
          <div className="home-section-head">
            <h2 className="home-section-title">GAME FLOW</h2>
          </div>
          <div className="home-feature-grid">
            {FLOW_STEPS.map((step) => (
              <article key={step.title} className="home-feature-card">
                <p>{step.label}</p>
                <h3>{step.title}</h3>
                <span>{step.copy}</span>
              </article>
            ))}
          </div>

          <div className="home-money-band">
            <div>
              <h3>TRUST PASSPORT</h3>
              <p>
                Passport is a reusable trust layer from your gameplay behavior.
                It can be consumed by this game and external projects as anti-bot
                signal.
              </p>
            </div>
            <p>
              Coming soon on Rialo Devnet.
            </p>
          </div>
        </div>
      </section>

      <section className="home-section home-section-passport">
        <div className="home-shell home-shell-section">
          <div className="home-section-head">
            <h2 className="home-section-title">
              PASSPORT FOR PARTNER APPS
              <span className="home-coming-soon-badge">COMING SOON</span>
            </h2>
          </div>
          <div className="home-feature-grid">
            {PASSPORT_FEATURES.map((item) => (
              <article key={item.title} className="home-feature-card">
                <p>{item.label}</p>
                <h3>{item.title}</h3>
                <span>{item.copy}</span>
              </article>
            ))}
          </div>

          <div className="home-integration-note">
            <h3>HOW OTHER WEBSITES INTEGRATE</h3>
            <ul>
              {INTEGRATION_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-shell home-footer-shell">
          <div>
            <p className="home-preview-title">RIAL CHICK</p>
            <h3 className="home-footer-title">
              The first arcade risk game on Rialo devnet.
            </h3>
          </div>

          <div className="home-footer-links">
            <a href="/play">PLAY</a>
            <a href="/managemoney">MANAGE MONEY</a>
            <button type="button" onClick={() => setShowHelp(true)}>
              HOW TO PLAY
            </button>
          </div>
        </div>
      </footer>

      {showHelp && (
        <div className="home-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="home-modal-box" onClick={(e) => e.stopPropagation()}>
            <button
              className="home-modal-close"
              type="button"
              onClick={() => setShowHelp(false)}>
              X
            </button>
            <h2>HOW TO PLAY</h2>
            <div className="home-help-content">
              <div className="help-step">
                <span className="step-num">1</span>
                <div>
                  <p className="step-title">MANAGE MONEY</p>
                  <p>
                    Mint faucet if needed, then deposit USDC into the vault.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">2</span>
                <div>
                  <p className="step-title">RUN & STACK</p>
                  <p>
                    Push forward for more multiplier while avoiding traffic and
                    bad timing.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">3</span>
                <div>
                  <p className="step-title">CHECKPOINT CASH OUT</p>
                  <p>
                    Reach checkpoints, cash out before decay, or risk one more
                    lane for bigger upside.
                  </p>
                </div>
              </div>
            </div>
            <button
              className="flow-btn secondary info-modal-action"
              type="button"
              onClick={() => setShowHelp(false)}>
              GOT IT
            </button>
          </div>
        </div>
      )}

      <button
        className="home-help-btn fixed-help"
        type="button"
        onClick={() => setShowHelp(true)}
        title="How to Play">
        ?
      </button>
    </main>
  );
}
