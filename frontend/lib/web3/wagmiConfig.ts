import type { Chain } from "viem";
import { RIALO_CHAIN } from "./rialo";

const FALLBACK_CHAIN_ID = 10143;
const FALLBACK_RPC_URL = "https://testnet-rpc.monad.xyz";

function buildRialoWagmiChain(): Chain {
  const chainId = RIALO_CHAIN.chainIdDecimal > 0 ? RIALO_CHAIN.chainIdDecimal : FALLBACK_CHAIN_ID;
  const rpcUrl = RIALO_CHAIN.rpcUrls[0] || FALLBACK_RPC_URL;
  const explorerUrl = RIALO_CHAIN.blockExplorerUrls[0] || "";

  return {
    id: chainId,
    name: RIALO_CHAIN.chainName || "Rialo",
    nativeCurrency: {
      name: RIALO_CHAIN.nativeCurrency.name,
      symbol: RIALO_CHAIN.nativeCurrency.symbol,
      decimals: RIALO_CHAIN.nativeCurrency.decimals,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: explorerUrl
      ? {
          default: {
            name: "Rialo Explorer",
            url: explorerUrl,
          },
        }
      : undefined,
    testnet: true,
  };
}

export const rialoWagmiChain = buildRialoWagmiChain();

export const appKitNetworks: [Chain, ...Chain[]] = [rialoWagmiChain];

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "demo-project-id";

export const appKitMetadata = {
  name: "Rial Chick",
  description: "Crossy chicken game with mock betting HUD on Rialo devnet.",
  url: "http://localhost:3000",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};
