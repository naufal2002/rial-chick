"use client";

import { useEffect, useState } from "react";
import { useWallet } from "../../components/web3/WalletProvider";
import { backendFetch, backendPost } from "../../lib/backend/api";

function shortAddress(address: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ManageMoneyPage() {
  const { account, isConnecting, connectWallet } = useWallet();
  const isConnected = Boolean(account);

  const [balance, setBalance] = useState<number | null>(null);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [swapFrom, setSwapFrom] = useState("USDC");
  const [swapTo, setSwapTo] = useState("ETH");
  const [swapAmount, setSwapAmount] = useState("");

  const [bridgeAmount, setBridgeAmount] = useState("");
  const [bridgeFromChain, setBridgeFromChain] = useState("Ethereum");

  function fetchBalance() {
    if (!isConnected) { setBalance(null); return; }
    void backendFetch<{ balance?: number }>("/auth/me")
      .then((me) => setBalance(Number(me.balance ?? 0)))
      .catch(() => setBalance(null));
  }

  useEffect(() => {
    fetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, account]);

  async function onClaimFaucet() {
    setFaucetMsg(null);
    setFaucetLoading(true);
    try {
      const result = await backendPost<{ walletBalance: number }>("/api/player/faucet", {});
      setBalance(result.walletBalance);
      setFaucetMsg({ ok: true, text: "+1000 added to your balance." });
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err
        ? String((err as { message?: string }).message)
        : "";
      setFaucetMsg({ ok: false, text: msg || "Faucet failed. Try again." });
    } finally {
      setFaucetLoading(false);
    }
  }

  function onSwapTokens() {
    setSwapFrom(swapTo);
    setSwapTo(swapFrom);
  }

  return (
    <main className="mm-page">
      {/* ── Navbar ── */}
      <header className="mm-nav">
        <a className="mm-brand" href="/">
          <span className="mm-brand-badge">GM</span>
          <span className="mm-brand-name">Rial Chick</span>
        </a>
        <div className="mm-nav-right">
          {isConnected ? (
            <span className="mm-address">{shortAddress(account)}</span>
          ) : (
            <button
              type="button"
              className="mm-btn mm-btn-primary"
              onClick={() => void connectWallet()}
              disabled={isConnecting}
            >
              {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
            </button>
          )}
          <a href="/play" className="mm-btn mm-btn-secondary">PLAY</a>
        </div>
      </header>

      <div className="mm-shell">
        <h1 className="mm-page-title">MANAGE MONEY</h1>

        {/* ── 1. FAUCET ── */}
        <section className="mm-card mm-card-gold">
          <div className="mm-card-header">
            <h2 className="mm-card-title">FAUCET</h2>
            <span className="mm-badge mm-badge-green">LIVE</span>
          </div>
          <p className="mm-card-desc">
            Claim free Rial Chick Token to use as your playable balance.
          </p>

          <div className="mm-balance-row">
            <span className="mm-balance-label">CURRENT BALANCE</span>
            <span className="mm-balance-value">
              {!isConnected ? "—" : balance === null ? "..." : `$${balance.toFixed(2)}`}
            </span>
          </div>

          {isConnected ? (
            <button
              type="button"
              className="mm-btn mm-btn-faucet"
              onClick={onClaimFaucet}
              disabled={faucetLoading}
            >
              {faucetLoading ? "CLAIMING..." : "CLAIM FAUCET (+1000)"}
            </button>
          ) : (
            <button
              type="button"
              className="mm-btn mm-btn-faucet"
              onClick={() => void connectWallet()}
              disabled={isConnecting}
            >
              {isConnecting ? "CONNECTING..." : "CONNECT WALLET TO CLAIM"}
            </button>
          )}

          {faucetMsg && (
            <p className={`mm-msg ${faucetMsg.ok ? "mm-msg-ok" : "mm-msg-err"}`}>
              {faucetMsg.text}
            </p>
          )}
        </section>

        {/* ── 2. SWAP ── */}
        <section className="mm-card mm-card-gray">
          <div className="mm-card-header">
            <h2 className="mm-card-title">SWAP</h2>
            <span className="mm-badge mm-badge-soon">COMING SOON</span>
          </div>
          <p className="mm-card-desc">
            Swap tokens directly on Rialo Devnet.
          </p>

          <div className="mm-swap-row">
            <div className="mm-swap-field">
              <label className="mm-label">FROM</label>
              <div className="mm-input-group">
                <input
                  type="number"
                  className="mm-input"
                  placeholder="0.00"
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  disabled
                />
                <select
                  className="mm-select"
                  value={swapFrom}
                  onChange={(e) => setSwapFrom(e.target.value)}
                  disabled
                >
                  <option>USDC</option>
                  <option>ETH</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              className="mm-swap-icon-btn"
              onClick={onSwapTokens}
              disabled
              title="Coming soon on Rialo Devnet"
            >
              ⇄
            </button>

            <div className="mm-swap-field">
              <label className="mm-label">TO</label>
              <div className="mm-input-group">
                <input
                  type="number"
                  className="mm-input"
                  placeholder="0.00"
                  disabled
                />
                <select
                  className="mm-select"
                  value={swapTo}
                  onChange={(e) => setSwapTo(e.target.value)}
                  disabled
                >
                  <option>USDC</option>
                  <option>ETH</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="mm-btn mm-btn-disabled"
            disabled
            title="Coming soon on Rialo Devnet"
          >
            SWAP — COMING SOON ON RIALO DEVNET
          </button>
        </section>

        {/* ── 3. BRIDGE ── */}
        <section className="mm-card mm-card-gray">
          <div className="mm-card-header">
            <h2 className="mm-card-title">BRIDGE</h2>
            <span className="mm-badge mm-badge-soon">COMING SOON</span>
          </div>
          <p className="mm-card-desc">
            Bridge assets from other chains to Rialo Devnet.
          </p>

          <div className="mm-bridge-grid">
            <div className="mm-field">
              <label className="mm-label">AMOUNT</label>
              <input
                type="number"
                className="mm-input mm-input-full"
                placeholder="0.00"
                value={bridgeAmount}
                onChange={(e) => setBridgeAmount(e.target.value)}
                disabled
              />
            </div>
            <div className="mm-field">
              <label className="mm-label">FROM CHAIN</label>
              <select
                className="mm-select mm-select-full"
                value={bridgeFromChain}
                onChange={(e) => setBridgeFromChain(e.target.value)}
                disabled
              >
                <option>Ethereum</option>
                <option>BSC</option>
                <option>Arbitrum</option>
                <option>Polygon</option>
              </select>
            </div>
            <div className="mm-field">
              <label className="mm-label">TO CHAIN</label>
              <select className="mm-select mm-select-full" disabled>
                <option>Rialo Devnet</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            className="mm-btn mm-btn-disabled"
            disabled
            title="Coming soon on Rialo Devnet"
          >
            BRIDGE — COMING SOON ON RIALO DEVNET
          </button>
        </section>
      </div>
    </main>
  );
}
