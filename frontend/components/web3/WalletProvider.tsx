"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { backendFetch, backendPost } from "../../lib/backend/api";
import { BACKEND_API_URL, hasBackendApiConfig } from "../../lib/backend/config";

// Auth via window.ethereum (Rabby/MetaMask). Backend and game remain mock.

type WalletContextValue = {
  account: string;
  chainIdHex: string;
  isMonadChain: boolean;
  isConnecting: boolean;
  error: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToMonad: () => Promise<void>;
  clearWalletError: () => void;
  hasMonadChainConfig: boolean;
  monadChainIdHex: string;
  monadChainName: string;
  backendApiUrl: string;
  hasBackendApiConfig: boolean;
  isBackendAuthenticated: boolean;
  isBackendAuthLoading: boolean;
  backendAuthError: string;
  authenticateBackend: () => Promise<boolean>;
  ensureBackendSession: () => Promise<boolean>;
  logoutBackend: () => Promise<void>;
  refreshBackendSession: () => Promise<boolean>;
};

type WalletProviderProps = {
  children: ReactNode;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: WalletProviderProps) {
  const [account, setAccount] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const hasBackendConfig = hasBackendApiConfig();

  const sessionRef = useRef<{
    inFlight: Promise<boolean> | null;
    lastCheckedAt: number;
    lastResult: boolean;
  }>({ inFlight: null, lastCheckedAt: 0, lastResult: false });

  // On mount, try to restore session from existing cookie
  useEffect(() => {
    void refreshBackendSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshBackendSession(): Promise<boolean> {
    if (!hasBackendConfig) return false;

    const now = Date.now();
    const snap = sessionRef.current;
    if (snap.inFlight) return snap.inFlight;
    if (now - snap.lastCheckedAt < 4_000) return snap.lastResult;

    const task = (async (): Promise<boolean> => {
      try {
        const response = await backendFetch<{
          authenticated: boolean;
          address: string;
        }>("/auth/me");

        if (response.authenticated && response.address) {
          setAccount(response.address.toLowerCase());
          sessionRef.current = { inFlight: null, lastCheckedAt: Date.now(), lastResult: true };
          return true;
        }
        setAccount("");
        sessionRef.current = { inFlight: null, lastCheckedAt: Date.now(), lastResult: false };
        return false;
      } catch {
        setAccount("");
        sessionRef.current = { inFlight: null, lastCheckedAt: Date.now(), lastResult: false };
        return false;
      } finally {
        sessionRef.current.inFlight = null;
      }
    })();

    sessionRef.current = { ...sessionRef.current, inFlight: task };
    return task;
  }

  async function connectWallet(): Promise<void> {
    setError("");
    setIsConnecting(true);
    try {
      if (!window.ethereum) {
        setError("Please install Rabby wallet to play.");
        return;
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      }) as string[];

      const address = accounts[0];
      if (!address) {
        setError("No account found. Please unlock your wallet.");
        return;
      }

      // Fetch nonce and request signature
      const { nonce } = await backendFetch<{ nonce: string }>("/auth/nonce");
      const message = `Sign in to Rial Chick\nNonce: ${nonce}`;
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, address],
      }) as string;

      const response = await backendPost<{ success: boolean; address: string }>(
        "/auth/verify",
        { username: address, signature, message, nonce },
      );

      if (response.success && response.address) {
        setAccount(response.address.toLowerCase());
        sessionRef.current = { inFlight: null, lastCheckedAt: Date.now(), lastResult: true };
      }
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message || "")
          : "";
      setError(msg || "Connection failed. Please unlock your wallet and try again.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function logoutBackend(): Promise<void> {
    try {
      await backendPost<{ success: boolean }>("/auth/logout");
    } catch {
      // Ignore logout failures on local dev
    }
  }

  async function disconnectWallet(): Promise<void> {
    setError("");
    setAccount("");
    sessionRef.current = { inFlight: null, lastCheckedAt: 0, lastResult: false };
    await logoutBackend();
  }

  async function authenticateBackend(): Promise<boolean> {
    if (account) return true;
    await connectWallet();
    return Boolean(account);
  }

  async function ensureBackendSession(): Promise<boolean> {
    if (account) return true;
    const existing = await refreshBackendSession();
    if (existing) return true;
    await connectWallet();
    return Boolean(account);
  }

  const isConnected = Boolean(account);
  const isBackendAuthenticated = isConnected;

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      chainIdHex: "",
      isMonadChain: isConnected, // always "on chain" in mock mode when logged in
      isConnecting,
      error,
      connectWallet,
      disconnectWallet,
      switchToMonad: async () => {}, // noop in mock mode
      clearWalletError: () => setError(""),
      hasMonadChainConfig: true,
      monadChainIdHex: "",
      monadChainName: "Mock Mode",
      backendApiUrl: BACKEND_API_URL,
      hasBackendApiConfig: hasBackendConfig,
      isBackendAuthenticated,
      isBackendAuthLoading: false,
      backendAuthError: "",
      authenticateBackend,
      ensureBackendSession,
      logoutBackend,
      refreshBackendSession,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, isConnecting, error, hasBackendConfig, isBackendAuthenticated],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return value;
}
