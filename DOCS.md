# Rial Chick — Dokumentasi Proyek

Rial Chick adalah game arcade risk-reward berbasis blockchain yang berjalan di Rialo devnet. Pemain menyetor mock USDC ke vault, memulai sesi game dengan stake, melihat multiplier naik secara real-time, lalu cashout di checkpoint atau terus bermain dan berisiko crash. Validasi game dilakukan server-side (anti-cheat), dan settlement final dilakukan onchain via signature EIP-712.

**App live**: https://rial-chick.vercel.app/

---

## Daftar Isi

1. [Arsitektur Sistem](#arsitektur-sistem)
2. [Alur Game End-to-End](#alur-game-end-to-end)
3. [Smart Contracts](#smart-contracts)
4. [Backend](#backend)
5. [Frontend](#frontend)
6. [Environment Variables](#environment-variables)
7. [Local Development](#local-development)
8. [Deploy Smart Contracts](#deploy-smart-contracts)
9. [Alamat Kontrak Testnet](#alamat-kontrak-testnet)
10. [Common Issues](#common-issues)

---

## Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│        Next.js 14 · Wagmi · Viem · Reown AppKit            │
│  Wallet ──► SIWE Auth ──► GameCanvas ──► Settlement UI      │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP + WebSocket (Socket.io)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                        BACKEND                              │
│          Express 5 · Socket.io · Viem · Supabase           │
│   Auth │ Game Gateway │ Settlement Signer │ Relayer         │
└──────────────────────┬──────────────────────────────────────┘
                       │ onchain calls (Viem)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    SMART CONTRACTS                          │
│              Foundry · Solidity 0.8 · OpenZeppelin          │
│   GameUSDC · USDCFaucet · GameVault · GameSettlement        │
│                    · TrustPassport                          │
│                  Rialo Devnet (chain 10143)                 │
└─────────────────────────────────────────────────────────────┘
```

Semua validasi game bersifat **server-authoritative**: frontend mengirim gerakan via WebSocket, backend yang menentukan hasil, lalu backend menandatangani payload settlement menggunakan private key yang diregistrasi onchain.

---

## Alur Game End-to-End

```
1. Claim faucet       USDCFaucet.claim()               → +100 USDC
2. Deposit            GameVault.deposit(amount)         → vault.available += amount
3. Start session      GameSettlement.startSession(...)  → vault.locked += stake
4. Gameplay loop      Frontend ──WebSocket──► Backend   → server validate, hitung multiplier
5a. Cashout           Backend sign EIP-712 payload
                      Frontend submit claimWithSignature → vault.available += payout
5b. Crash             Backend detect crash              → vault.treasury += stake
```

Setiap wallet hanya boleh memiliki **satu sesi aktif** pada satu waktu.

---

## Smart Contracts

Semua kontrak di-deploy sebagai **UUPS upgradeable proxy** (ERC1967Proxy + implementasi terpisah).

### GameUSDC

Mock ERC20 token yang meniru USDC dengan 6 desimal.

| Field | Value |
|---|---|
| Nama | Mock USD Coin |
| Simbol | USDC |
| Desimal | 6 |
| Supply awal | 0 (hanya minter yang bisa mint) |

- Hanya alamat yang disetujui owner yang bisa `mint`.
- Upgradeable via UUPS.

### USDCFaucet

Faucet testnet untuk bootstrap pemain baru.

- `claim()` — mint `100 USDC` ke pemanggil, tanpa cooldown.
- Owner bisa `pause()`, `unpause()`, dan `setClaimAmount()`.
- Upgradeable via UUPS.

### GameVault

Lapisan kustodi yang melacak tiga saldo terpisah per user.

| Saldo | Keterangan |
|---|---|
| `available` | Dana bebas — bisa withdraw atau stake |
| `locked` | Dana yang sedang di-stake dalam sesi aktif |
| `treasury` | Akumulasi stake dari crash, digunakan untuk bayar cashout |

- User perlu `approve` USDC terlebih dahulu, lalu `deposit(amount)`.
- Withdraw hanya bisa dari saldo `available`.
- `fundTreasury(amount)` — bootstrap likuiditas treasury oleh owner.
- Hanya `GameSettlement` yang bisa lock stake dan settle.
- Upgradeable via UUPS.

### GameSettlement

Manajer sesi yang memverifikasi signature EIP-712 dari backend.

- `startSession(onchainSessionId, stakeAmount)` — lock stake di vault, satu wallet satu sesi.
- `settleWithSignature(...)` — verifikasi payload backend dan eksekusi payout.
- `expireSession(sessionId)` — tutup sesi stale sebagai `CRASHED`.
- `sessionExpiryDelay` bisa dikonfigurasi.
- Owner bisa `pause()` dan `unpause()`.
- Upgradeable via UUPS.

> **Catatan penting**: Nama domain EIP-712 onchain sengaja tidak diubah saat rebranding dari "Pass Chick" ke "Rial Chick" agar tetap kompatibel dengan deployment live.

### TrustPassport

Credential onchain untuk proof-of-human / anti-bot.

- Backend menerbitkan signature passport yang diverifikasi kontrak.
- TTL passport: 30 hari (dapat dikonfigurasi).
- Digunakan sebagai gating untuk fitur reward di masa depan.

### Submodules (Dependencies)

```
sc/lib/forge-std                         — Foundry test utilities
sc/lib/openzeppelin-contracts            — OZ standard contracts
sc/lib/openzeppelin-contracts-upgradeable — OZ upgradeable contracts
```

---

## Backend

Ekspres 5 + TypeScript server yang menangani auth, validasi game real-time, penandatanganan settlement, dan relay onchain.

**Port default**: `8000`

### Tech Stack

| Teknologi | Kegunaan |
|---|---|
| Express 5 | HTTP server + REST API |
| Socket.io 4.8 | WebSocket game gateway (real-time) |
| Viem 2.48 | Interaksi onchain (sign, submit, listen) |
| SIWE 3.0 | Sign-In With Ethereum (autentikasi wallet) |
| Supabase | Database PostgreSQL (sessions, leaderboard, stats) |
| Helmet 8.1 | HTTP security headers |

### Struktur Services

```
backend/src/
├── index.ts                — Entry point, Express + Socket.io init
├── routes/
│   ├── auth.ts             — /auth/nonce, /auth/verify, /auth/logout, /auth/me
│   ├── game.ts             — /api/game/*
│   ├── leaderboard.ts      — /api/leaderboard/*
│   ├── player.ts           — /api/player/*
│   └── passport.ts         — /api/passport/*
└── services/
    ├── gameGateway.ts      — WebSocket validator + server-authoritative timer
    ├── gameState.ts        — In-memory game state per wallet
    ├── gameValidator.ts    — Rule engine: multiplier, checkpoint, crash detection
    ├── signatureService.ts — EIP-712 signer untuk settlement & passport
    ├── settlementExecutor.ts — Submit settlement ke onchain
    ├── blockchainListener.ts — Listen event vault (deposit, withdraw, sync)
    └── timerAuthority.ts   — Server-side timer (cegah speed hack)
```

### REST API Routes

**Auth**

| Method | Path | Deskripsi |
|---|---|---|
| `GET` | `/auth/nonce` | Dapatkan nonce untuk SIWE |
| `POST` | `/auth/verify` | Verifikasi SIWE signature, set session cookie |
| `POST` | `/auth/logout` | Hapus session |
| `GET` | `/auth/me` | Info player yang sedang login |

**Game & Player**

| Method | Path | Deskripsi |
|---|---|---|
| `GET` | `/api/game/active` | Sesi game aktif milik user |
| `GET` | `/api/game/pending-settlement` | Settlement yang menunggu submit |
| `POST` | `/api/game/submit-settlement` | Submit settlement ke onchain |
| `GET` | `/api/leaderboard/...` | Leaderboard (profit / distance) |
| `GET` | `/api/player/stats` | Statistik dan riwayat game player |

**Passport**

| Method | Path | Deskripsi |
|---|---|---|
| `GET` | `/api/passport/status` | Status passport user |
| `POST` | `/api/passport/issue-signature` | Terbitkan signature passport |

**Misc**

| Method | Path | Deskripsi |
|---|---|---|
| `GET` | `/health` | Status server + jumlah game aktif |

### Database (Supabase)

Schema lengkap ada di `backend/database/schema.sql`. Tabel utama:

- `game_sessions` — riwayat semua sesi game
- `players` — profil & statistik kumulatif per wallet
- `transactions` — riwayat deposit/withdraw

---

## Frontend

Next.js 14 app yang menangani wallet connection, autentikasi, gameplay, dan settlement.

**Port default**: `3000`

### Tech Stack

| Teknologi | Kegunaan |
|---|---|
| Next.js 14.2 + React 18 | Framework UI |
| Wagmi 3.6 | React hooks untuk EVM interaction |
| Viem 2.48 | Library Web3 primitif |
| Reown AppKit 1.8 | UI wallet connection (multi-wallet) |
| Socket.io-client 4.8 | WebSocket ke backend game gateway |
| TanStack Query 5.99 | Server state + caching |
| SIWE 3.0 | Sign-In With Ethereum |
| Zod 3.25 | Schema validation |

### Halaman (Pages)

| Path | Deskripsi |
|---|---|
| `/` | Home — leaderboard preview & feature showcase |
| `/play` | Main game canvas, real-time multiplier, cashout |
| `/dashboard` | Statistik player & riwayat sesi |
| `/managemoney` | Deposit, withdraw, dan claim faucet |

### Komponen Kunci

```
frontend/
├── app/
│   ├── page.tsx               — Home page
│   ├── play/page.tsx          — Game canvas page
│   ├── dashboard/page.tsx     — Player stats page
│   └── managemoney/page.tsx   — Money management page
└── components/
    ├── game/
    │   ├── GameCanvas.tsx     — Main game rendering & multiplier display
    │   └── PlayTopNav.tsx     — In-game navigation bar
    └── web3/
        └── WalletProvider.tsx — Wagmi + Reown AppKit setup
```

### Wallet yang Didukung

- MetaMask
- Coinbase Wallet
- WalletConnect

---

## Environment Variables

### Frontend (`frontend/.env`)

```bash
# Rialo Chain Config
NEXT_PUBLIC_RIALO_CHAIN_ID=0x279F
NEXT_PUBLIC_RIALO_CHAIN_NAME=Rialo Devnet
NEXT_PUBLIC_RIALO_RPC_URLS=https://your-rialo-rpc
NEXT_PUBLIC_RIALO_EXPLORER_URLS=https://your-explorer
NEXT_PUBLIC_RIALO_NATIVE_NAME=MON
NEXT_PUBLIC_RIALO_NATIVE_SYMBOL=MON
NEXT_PUBLIC_RIALO_NATIVE_DECIMALS=18

# Contract Addresses
NEXT_PUBLIC_USDC_ADDRESS=0x5631dF2e613141a4E57ca7BCD25e634825b16c7d
NEXT_PUBLIC_USDC_FAUCET_ADDRESS=0x52E02a81D373f3597D2d696299CA1ca1B278dfeF
NEXT_PUBLIC_GAME_VAULT_ADDRESS=0x45B893d50dfDC750Ab8d3696cAC5556A697153ca
NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=0xD1873ddd24Cf2C41192e11a87CC7d3026557dab8
NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=0x31029a59E40eb062f3C5D33AdFF8561F0549199e

# Backend & Auth
NEXT_PUBLIC_DEPOSIT_DATA_SOURCE=onchain
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:8000
NEXT_PUBLIC_REOWN_PROJECT_ID=your_reown_project_id
```

### Backend (`backend/.env`)

```bash
PORT=8000
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your_session_secret

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Blockchain
RIALO_RPC_URL=https://your-rialo-rpc
RIALO_CHAIN_ID=10143

# Contract Addresses
GAME_VAULT_ADDRESS=0x45B893d50dfDC750Ab8d3696cAC5556A697153ca
GAME_SETTLEMENT_ADDRESS=0xD1873ddd24Cf2C41192e11a87CC7d3026557dab8
TRUST_PASSPORT_ADDRESS=0x31029a59E40eb062f3C5D33AdFF8561F0549199e

# Signer
BACKEND_PRIVATE_KEY=0x...

# TTL (seconds)
SETTLEMENT_SIGNATURE_TTL_SECONDS=86400
PASSPORT_SIGNATURE_TTL_SECONDS=900
PASSPORT_VALIDITY_SECONDS=2592000
```

### Smart Contracts (`sc/.env`)

```bash
RIALO_RPC_URL=https://your-rialo-rpc
PRIVATE_KEY=0xyour_private_key
INITIAL_OWNER=0xyour_owner_address
BACKEND_SIGNER=0xyour_backend_signer_address
USDC_FAUCET_CLAIM_AMOUNT=100000000
SESSION_EXPIRY_DELAY=86400
```

> **Penting**: `BACKEND_PRIVATE_KEY` (backend) dan `BACKEND_SIGNER` (sc) harus merujuk ke keypair yang sama. Jika tidak sinkron, cashout akan gagal.

---

## Local Development

Jalankan masing-masing package di terminal terpisah.

```bash
# Terminal 1 — Frontend
cd frontend
npm install
npm run dev
# http://localhost:3000

# Terminal 2 — Backend
cd backend
npm install
npm run dev
# http://localhost:8000

# Terminal 3 — Smart Contracts (opsional, untuk test)
cd sc
forge build
forge test --offline
```

Pastikan `.env` masing-masing package sudah diisi sebelum menjalankan.

---

## Deploy Smart Contracts

### Prasyarat

- Foundry terinstall (`forge`, `cast`, `anvil`)
- RPC URL Rialo devnet
- Private key deployer dengan MON untuk gas

### Build

```bash
cd sc
forge build
```

### Deploy ke Rialo Devnet

```bash
source .env
forge script script/DeployGameContracts.s.sol:DeployGameContracts \
  --rpc-url "$RIALO_RPC_URL" \
  --broadcast
```

Script deploy akan:
1. Deploy implementasi semua kontrak
2. Deploy UUPS proxy untuk masing-masing kontrak
3. Grant minting rights ke USDCFaucet
4. Set GameSettlement sebagai vault settlement operator
5. Print alamat proxy yang di-deploy

### Build untuk RialoVision / Sourcify

```bash
FOUNDRY_PROFILE=rialo_vision forge build
FOUNDRY_PROFILE=rialo_vision forge script script/DeployGameContracts.s.sol:DeployGameContracts \
  --rpc-url "$RIALO_RPC_URL" --broadcast
```

### Verifikasi Kontrak

**RialoVision / Sourcify:**
```bash
FOUNDRY_PROFILE=rialo_vision forge verify-contract \
  <contract_address> <contract_name> \
  --chain 10143 \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

**Socialscan:**
```bash
forge verify-contract \
  <contract_address> <contract_name> \
  --chain 10143 \
  --watch \
  --etherscan-api-key test \
  --verifier-url https://api.socialscan.io/monad-testnet/v1/explorer/command_api/contract \
  --verifier etherscan
```

### Rotasi Backend Signer

Jika perlu mengganti backend signer setelah deployment:

```bash
source .env
forge script script/UpdateBackendSigner.s.sol:UpdateBackendSigner \
  --rpc-url "$RIALO_RPC_URL" --broadcast
```

Gunakan owner key dari kontrak target. Set `NEW_BACKEND_SIGNER` di `.env` terlebih dahulu.

---

## Alamat Kontrak Testnet

Alamat proxy yang aktif di Rialo devnet:

| Kontrak | Alamat |
|---|---|
| `GameUSDC` | `0x5631dF2e613141a4E57ca7BCD25e634825b16c7d` |
| `USDCFaucet` | `0x52E02a81D373f3597D2d696299CA1ca1B278dfeF` |
| `GameVault` | `0x45B893d50dfDC750Ab8d3696cAC5556A697153ca` |
| `GameSettlement` | `0xD1873ddd24Cf2C41192e11a87CC7d3026557dab8` |
| `TrustPassport` | `0x31029a59E40eb062f3C5D33AdFF8561F0549199e` |

---

## Common Issues

### Wallet tidak bisa konek

- Pastikan `NEXT_PUBLIC_REOWN_PROJECT_ID` valid.
- Pastikan wallet sudah switch ke **Rialo Devnet** (chain id `10143` / `0x279F`).
- Restart frontend setelah mengubah `.env`.

### SIWE auth gagal

- Pastikan backend berjalan di URL yang sama dengan `NEXT_PUBLIC_BACKEND_API_URL`.
- Pastikan `FRONTEND_URL` di backend sesuai dengan origin frontend.
- Cek browser menerima cookie untuk environment tersebut (localhost vs HTTPS).

### Cashout gagal

Penyebab umum dan solusinya:

| Penyebab | Solusi |
|---|---|
| Relayer kehabisan MON untuk gas | Top-up wallet backend signer dengan MON |
| RPC rate-limited | Ganti ke dedicated RPC provider |
| `backendSigner` onchain tidak cocok dengan `BACKEND_PRIVATE_KEY` | Rotasi signer atau sync env |
| Treasury tidak cukup untuk bayar cashout | `fundTreasury()` dari owner |

### RPC rate limit

Public Rialo RPC dibatasi ~15 req/sec. Untuk gameplay yang stabil, gunakan dedicated RPC provider di frontend (`NEXT_PUBLIC_RIALO_RPC_URLS`) dan backend (`RIALO_RPC_URL`).

---

## Catatan Penting

- **EIP-712 domain name** tidak diubah saat rebranding dari "Pass Chick" ke "Rial Chick" untuk menjaga kompatibilitas dengan deployment live.
- **Server-authoritative timer** di backend mencegah speed hack dari sisi client.
- **Blockchain listener** di backend menjaga sinkronisasi state off-chain dengan event onchain (deposit, withdraw), termasuk recovery sesi yang orphan.
- **TrustPassport** saat ini digunakan sebagai credential foundation; gating reward berbasis passport direncanakan untuk fitur berikutnya.
