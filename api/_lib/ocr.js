// ─── Screenshot verification via Claude vision (Haiku) ───────────────────────
// Best-effort OCR check of a Brawl Stars result screenshot. Given the winning
// team's expected player names, it asks the vision model whether the image
// shows a VICTORY and reads the names on the winning side, then fuzzy-matches.
//
// This ONLY ever accelerates a confirmation — a confident match lets the caller
// skip the dispute timer. It never throws and never rejects: any failure (no
// API key, unreadable image, network error, name mismatch) returns
// confident:false so the caller falls back to the normal 3-minute timer.
//
// Requires the ANTHROPIC_API_KEY env var. If it's unset, OCR is simply skipped.

const MODEL = "claude-haiku-4-5-20251001"; // cheap, fast vision

// Strip emojis/case/punctuation so "Alex 🎮" ≈ "alex".
const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

// An expected (registered) name matches one of the OCR-read names if they're
// equal, one contains the other, or they're within a small edit distance
// (tolerates a typo / OCR slip). In-game names drift from registration, so this
// is deliberately forgiving — false negatives just defer to the timer.
function nameMatches(expected, found) {
  const e = norm(expected);
  if (!e) return false;
  for (const f of found) {
    const g = norm(f);
    if (!g) continue;
    if (e === g) return true;
    if (e.length >= 3 && (g.includes(e) || e.includes(g))) return true;
    const tol = Math.max(1, Math.floor(Math.min(e.length, g.length) / 4));
    if (editDistance(e, g) <= tol) return true;
  }
  return false;
}

export async function verifyVictoryScreenshot({ imageUrl, winnerNames, loserNames }) {
  const key = process.env.ANTHROPIC_API_KEY;
  const winners = (winnerNames || []).filter(Boolean);
  const losers = (loserNames || []).filter(Boolean);
  if (!key || !imageUrl || !winners.length) {
    return { confident: false, reason: "ocr_disabled_or_no_names" };
  }
  try {
    const prompt = [
      "You verify a Brawl Stars screenshot submitted by a player to prove their team WON a tournament match.",
      "The submitter's own team is ALWAYS the LEFT side. There are two screenshot types:",
      "",
      "1) END-OF-GAME SCREEN: a large 'VICTORY!' or 'DEFEAT!' banner in the TOP-LEFT.",
      "   The blue team on the LEFT is the submitter. 'VICTORY!' = the left team won; 'DEFEAT!' = the left team lost.",
      "   The left/blue team's players are the winners on VICTORY; the right/red team are the losers.",
      "",
      "2) BATTLE LOG: a vertical list of recent matches. In every row the LEFT three players are the submitter's team,",
      "   and the centre shows 'VICTORY' (green) or 'DEFEAT' (red) FOR THAT LEFT TEAM. Use ONLY the MOST RECENT row (the topmost one).",
      "   In that row the left three players are one team and the right three are the opponent.",
      "",
      'Reply with ONLY a JSON object, no prose: {"leftTeamWon": boolean, "resultReadable": boolean, "winningPlayerNames": string[], "losingPlayerNames": string[], "screenType": "end_screen"|"battle_log"|"other"}.',
      "- leftTeamWon: true if the submitter's LEFT team clearly WON (VICTORY). false if it clearly LOST (DEFEAT).",
      "- resultReadable: true only if you can clearly read the VICTORY/DEFEAT result; false if blurry, cropped, a menu, or not a Brawl Stars result.",
      "- winningPlayerNames: EVERY player name on the team that WON, exactly as written (keep symbols/emojis).",
      "- losingPlayerNames: EVERY player name on the team that LOST, exactly as written.",
      "- screenType: which of the two layouts (or 'other').",
      "If you are not sure, set resultReadable=false.",
    ].join("\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { confident: false, reason: `vision_http_${resp.status}`, detail: detail.slice(0, 200) };
    }
    const data = await resp.json();
    const text = (data.content || []).map((c) => c.text || "").join("").trim();
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < 0) return { confident: false, reason: "no_json" };
    const parsed = JSON.parse(text.slice(start, end + 1));

    // The submitter's (left) team must have clearly WON, its registered name
    // must appear among the winners, and the OPPONENT's registered name must
    // appear among the losers. Matching both sides proves it's the right match
    // between the right two teams — not a random game or a screenshot swap.
    const leftTeamWon = parsed.leftTeamWon === true;
    const readable = parsed.resultReadable === true;
    const winSideNames = Array.isArray(parsed.winningPlayerNames) ? parsed.winningPlayerNames : [];
    const loseSideNames = Array.isArray(parsed.losingPlayerNames) ? parsed.losingPlayerNames : [];
    const screenType = parsed.screenType || "other";

    // Any registered winner name must be readable among the winning side.
    const winnerFound = winners.some((n) => nameMatches(n, winSideNames));
    // If we know the loser's registered name, it must show among the losers.
    // (If the loser never registered a name, we can't cross-check — allow it.)
    const loserFound = losers.length === 0 || losers.some((n) => nameMatches(n, loseSideNames));

    const confident = readable && leftTeamWon && winnerFound && loserFound;
    return { confident, leftTeamWon, readable, winnerFound, loserFound, winSideNames, loseSideNames, screenType, reason: confident ? "verified" : "insufficient_match" };
  } catch (e) {
    return { confident: false, reason: "ocr_error", detail: String(e).slice(0, 200) };
  }
}
