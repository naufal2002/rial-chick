import { Router } from "express";
import { supabase } from "../config/supabase.js";

const router = Router();

/**
 * GET /api/stats/public
 * Public aggregate stats — no auth required.
 */
router.get("/public", async (_req, res) => {
  try {
    const [playersResult, gamesResult, cashoutsResult] = await Promise.all([
      supabase.from("players").select("*", { count: "exact", head: true }),
      supabase.from("game_sessions").select("*", { count: "exact", head: true }),
      supabase
        .from("game_sessions")
        .select("*", { count: "exact", head: true })
        .eq("status", "CASHED_OUT"),
    ]);

    res.json({
      total_players: playersResult.count ?? 0,
      total_games: gamesResult.count ?? 0,
      total_cashouts: cashoutsResult.count ?? 0,
    });
  } catch (err) {
    console.error("❌ Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats." });
  }
});

export default router;
