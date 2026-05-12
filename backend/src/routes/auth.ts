import { Router } from "express";
import { createHash } from "node:crypto";
import { verifyMessage } from "viem";
import {
  generateNonce,
  generateSessionToken,
  createSession,
  deleteSession,
} from "../services/sessionStore.js";
import { SESSION_COOKIE, requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";

const router = Router();

/**
 * GET /auth/nonce
 * Generate a random nonce (kept for API compatibility).
 */
router.get("/nonce", (_req, res) => {
  const nonce = generateNonce();
  res.json({ nonce });
});

/**
 * POST /auth/verify
 * Mock mode: accept { username } and create a session with a deterministic fake address.
 */
router.post("/verify", async (req, res) => {
  try {
    const { username, signature, message } = req.body;

    if (!username || typeof username !== "string" || !username.trim()) {
      res.status(400).json({ error: "Missing username." });
      return;
    }

    const cleanUsername = username.trim().toLowerCase();

    let walletAddress: string;

    if (signature && message) {
      // Wallet login: verify EIP-191 personal_sign signature
      const isValid = await verifyMessage({
        address: cleanUsername as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (!isValid) {
        res.status(401).json({ error: "Invalid signature." });
        return;
      }

      walletAddress = cleanUsername;
      console.log(`✅ Wallet login (sig verified): ${walletAddress}`);
    } else {
      // Mock username login: derive deterministic fake address from hash
      const hash = createHash("sha256").update(cleanUsername).digest("hex");
      walletAddress = `0x${hash.slice(0, 40)}`;
      console.log(`✅ Mock login: "${cleanUsername}" → ${walletAddress}`);
    }

    // Upsert player — ignoreDuplicates: true so balance is only set to 1000 for new players
    const { error: dbError } = await supabase
      .from("players")
      .upsert(
        { wallet_address: walletAddress, balance: 1000 },
        { onConflict: "wallet_address", ignoreDuplicates: true }
      );

    if (dbError) {
      console.error("❌ Supabase Error (player-upsert):", {
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint,
        code: dbError.code,
      });
    }

    const token = generateSessionToken();
    createSession(token, walletAddress);

    // req.secure is true on Railway (trust proxy 1 is set), ensuring
    // sameSite:none + secure:true for cross-domain cookies to Vercel frontend.
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.json({
      success: true,
      address: walletAddress,
    });
  } catch (err) {
    console.error("❌ Auth verify error:", err);
    res.status(500).json({ error: "Authentication failed." });
  }
});

/**
 * POST /auth/logout
 * Clear the session cookie and delete server-side session.
 */
router.post("/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    deleteSession(token);
  }

  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "none" : "lax",
  });
  res.json({ success: true });
});

/**
 * GET /auth/me
 * Check current session and return address + balance for mock mode.
 */
router.get("/me", requireAuth, async (req, res) => {
  const { data: player } = await supabase
    .from("players")
    .select("balance")
    .eq("wallet_address", req.walletAddress)
    .maybeSingle();

  res.json({
    authenticated: true,
    address: req.walletAddress,
    balance: Number(player?.balance ?? 1000),
  });
});

export default router;
