"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "../../components/web3/WalletProvider";
import { backendFetch } from "../../lib/backend/api";

const HOME_CONNECT_PROMPT_KEY = "chicken-home-connect-prompt";

function shortAddress(address: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function DashboardPage() {
  const [showHelp, setShowHelp] = useState(false);
  const [showProfilePopover, setShowProfilePopover] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [playerBalance, setPlayerBalance] = useState<number | null>(null);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  const {
    account,
    isConnecting,
    connectWallet,
    disconnectWallet,
  } = useWallet();
  const isConnected = Boolean(account);
  const showConnectedDashboardUi = isConnected && !isLoggingOut;

  // Load balance from backend (mock mode)
  useEffect(() => {
    if (!isConnected) { setPlayerBalance(null); return; }
    void backendFetch<{ balance?: number }>("/auth/me")
      .then((me) => setPlayerBalance(Number(me.balance ?? 0)))
      .catch(() => setPlayerBalance(null));
  }, [isConnected, account]);

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

  function onConnect() {
    void connectWallet();
  }

  async function onLogout() {
    setShowProfilePopover(false);
    setIsLoggingOut(true);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(HOME_CONNECT_PROMPT_KEY, "1");
      }
      await disconnectWallet();
    } finally {
      window.location.assign("/?connect=1");
    }
  }

  return (
    <main className="flow-page dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-bg" aria-hidden="true">
          <iframe
            className="dashboard-bg-frame"
            src="/play?bg=1"
            title="In-game background"
            tabIndex={-1}
          />
        </div>
        <div className="dashboard-overlay" aria-hidden="true" />

        <header className="home-nav home-nav-global">
          <a className="home-brand" href="/">
            <span className="home-brand-badge">GM</span>
            <span className="home-brand-copy">
              <p className="home-brand-eyebrow">The First Rialo Arcade Risk Game</p>
            </span>
          </a>

          <div className="home-nav-cluster">
            <div className="home-nav-actions">
              {showConnectedDashboardUi || isLoggingOut ? (
                <div className="home-profile-wrap" ref={profileWrapRef}>
                  <button
                    type="button"
                    className="flow-btn secondary home-nav-login"
                    disabled={isLoggingOut}
                    onClick={() => setShowProfilePopover((current) => !current)}
                  >
                    {isLoggingOut ? "LOGGING OUT..." : shortAddress(account)}
                  </button>

                  {showProfilePopover && !isLoggingOut && (
                    <section
                      className="flow-status home-profile-popover"
                      style={{ color: "white" }}
                    >
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
                          className="flow-btn home-profile-action home-profile-action-dashboard"
                        >
                          HOME
                        </a>
                        <a
                          href="/managemoney"
                          className="flow-btn home-profile-action home-profile-action-manage"
                        >
                          MANAGE MONEY
                        </a>
                        <button
                          className="flow-btn home-profile-action home-profile-action-logout"
                          type="button"
                          onClick={onLogout}
                        >
                          LOG OUT
                        </button>
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="flow-btn primary home-nav-login"
                  onClick={onConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? "CONNECTING..." : "LOGIN"}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="dashboard-center">
          <div className="dashboard-title" aria-label="Rial Chick">
            <span className="dashboard-title-line">CHICKEN</span>
            <span className="dashboard-title-line">RIALO</span>
          </div>
          <div className="dashboard-actions">
            {showConnectedDashboardUi ? (
              <>
                <a
                  href="/play"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-play"
                >
                  PLAY NOW
                </a>
                <button
                  type="button"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-how"
                  onClick={() => setShowHelp(true)}
                >
                  HOW TO PLAY
                </button>
                <a
                  href="/managemoney"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-manage"
                >
                  MANAGE MONEY
                </a>
                <button
                  type="button"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-logout"
                  onClick={onLogout}
                >
                  LOG OUT
                </button>
              </>
            ) : isLoggingOut ? (
              <button
                type="button"
                className="flow-btn home-btn-main dashboard-btn dashboard-btn-logout"
                disabled
              >
                LOGGING OUT...
              </button>
            ) : (
              <button
                type="button"
                className="flow-btn home-btn-main dashboard-btn dashboard-btn-play"
                onClick={onConnect}
                disabled={isConnecting}
              >
                {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
              </button>
            )}
          </div>
        </div>
      </section>

      {showHelp ? (
        <div className="home-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="home-modal-box" onClick={(event) => event.stopPropagation()}>
            <button
              className="home-modal-close"
              type="button"
              onClick={() => setShowHelp(false)}
            >
              X
            </button>
            <h2>HOW TO PLAY</h2>
            <div className="home-help-content">
              <div className="help-step">
                <span className="step-num">1</span>
                <div>
                  <p className="step-title">MANAGE MONEY</p>
                  <p>Claim faucet if needed, then deposit USDC into your vault.</p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">2</span>
                <div>
                  <p className="step-title">RUN & STACK</p>
                  <p>Move lane by lane to increase multiplier while avoiding traffic.</p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">3</span>
                <div>
                  <p className="step-title">CHECKPOINT CASH OUT</p>
                  <p>Cash out at checkpoints before crash or decay eats the payout.</p>
                </div>
              </div>
            </div>
            <button
              className="flow-btn secondary info-modal-action"
              type="button"
              onClick={() => setShowHelp(false)}
            >
              GOT IT
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
