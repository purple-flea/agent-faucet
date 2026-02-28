import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  hasAgentClaimed,
  getIpLastClaim,
  recordClaim,
  getCasinoAgent,
  getAgentDepositCount,
  creditCasinoBalance,
  getCasinoAgentByReferralCode,
  getFaucetStats,
} from "./db.js";
import { randomUUID } from "crypto";

const PORT = parseInt(process.env.PORT || "3006");
const FAUCET_AMOUNT = 1.0;
const IP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const app = new Hono();

// ─── Rate limiter ───
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();
function rateLimit(maxRequests: number, windowMs: number) {
  return async (c: any, next: () => Promise<void>) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      || c.req.header("x-real-ip")
      || "unknown";
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      rateLimitBuckets.set(key, { count: 1, windowStart: now });
    } else {
      bucket.count++;
      if (bucket.count > maxRequests) {
        return c.json(
          { error: "rate_limited", message: `Too many requests. Limit: ${maxRequests} per ${windowMs / 1000}s` },
          429
        );
      }
    }
    await next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.windowStart < cutoff) rateLimitBuckets.delete(key);
  }
}, 300_000);

// ─── Global middleware ───
app.use("*", cors({ origin: "*" }));
app.use("*", logger());

// ─── _info metadata injector ───
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return;
  try {
    const body = await c.res.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      body._info = {
        service: "agent-faucet",
        docs: "https://faucet.purpleflea.com/llms.txt",
        referral: "GET /gossip for referral info",
        version: "1.0.0",
      };
      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: { "content-type": "application/json; charset=UTF-8" },
      });
    }
  } catch { /* non-JSON */ }
});

// ─── Static files ───
app.use("/llms.txt", serveStatic({ path: "./public/llms.txt" }));
app.use("/robots.txt", serveStatic({ path: "./public/robots.txt" }));

// ─── GET / ───
app.get("/", (c) =>
  c.json({
    service: "agent-faucet",
    version: "1.0.0",
    description: "Free $1 casino credits for new AI agents. One-time per agent.",
    endpoints: {
      "POST /faucet/claim": "Claim $1 free credits (one-time per agent, 1 per IP/24h)",
      "GET /faucet/stats": "Public faucet statistics",
      "GET /gossip": "Referral program info",
      "POST /mcp": "MCP StreamableHTTP — tool: claim_faucet",
    },
    docs: "https://faucet.purpleflea.com/llms.txt",
    casino: "https://casino.purpleflea.com",
  })
);

// ─── POST /faucet/claim ───
app.post("/faucet/claim", rateLimit(5, 60_000), async (c) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const body = await c.req.json().catch(() => ({})) as {
    agent_casino_id?: string;
    referral_code?: string;
  };

  const agentId = body.agent_casino_id?.trim();
  if (!agentId || !agentId.startsWith("ag_")) {
    return c.json(
      { error: "invalid_request", message: "agent_casino_id is required (ag_xxx format)" },
      400
    );
  }

  // IP cooldown: 1 claim per IP per 24h
  const lastClaimTs = getIpLastClaim(ip);
  if (lastClaimTs !== null && Date.now() - lastClaimTs * 1000 < IP_COOLDOWN_MS) {
    const remainingHrs = Math.ceil(
      (IP_COOLDOWN_MS - (Date.now() - lastClaimTs * 1000)) / 3_600_000
    );
    return c.json(
      { error: "ip_rate_limited", message: `Already claimed from this IP today. Try again in ~${remainingHrs}h.` },
      429
    );
  }

  // Agent must exist in casino DB
  const agent = getCasinoAgent(agentId);
  if (!agent) {
    return c.json(
      {
        error: "agent_not_found",
        message: "Agent not found in casino. Register at https://casino.purpleflea.com/api/v1/auth/register",
      },
      404
    );
  }

  // One-time per agent
  if (hasAgentClaimed(agentId)) {
    return c.json({ error: "already_claimed", message: "This agent has already claimed the faucet bonus." }, 409);
  }

  // Agent must have 0 completed deposits (brand new agents only)
  const depositCount = getAgentDepositCount(agentId);
  if (depositCount > 0) {
    return c.json(
      { error: "has_deposits", message: "Faucet is for new agents with no deposits. Deposit real funds to keep playing." },
      403
    );
  }

  // Resolve referrer: explicit code in request > referral saved at registration
  let referrerId: string | null = null;
  const referralCode = body.referral_code ?? null;
  if (referralCode) {
    const referrer = getCasinoAgentByReferralCode(referralCode);
    if (referrer && referrer.id !== agentId) {
      referrerId = referrer.id;
    }
  } else if (agent.referred_by) {
    referrerId = agent.referred_by;
  }

  // Credit $1 to casino balance
  const claimId = randomUUID();
  try {
    creditCasinoBalance(agentId, FAUCET_AMOUNT, "faucet_claim: $1 free credits", claimId);
    recordClaim(claimId, agentId, ip, referralCode, referrerId, FAUCET_AMOUNT);
  } catch (err: any) {
    console.error("[faucet/claim] error:", err?.message);
    return c.json({ error: "internal_error", message: "Failed to credit balance. Please try again." }, 500);
  }

  return c.json({
    credited: FAUCET_AMOUNT,
    message: "Free $1 credited. Use it to try the casino!",
    casino_url: "https://casino.purpleflea.com",
    claim_id: claimId,
    agent_id: agentId,
    referral_tracked: referrerId !== null,
  });
});

// ─── GET /faucet/stats ───
app.get("/faucet/stats", async (c) => {
  const stats = getFaucetStats();
  return c.json({
    total_claims: stats.total_claims,
    total_agents: stats.total_agents,
    total_value_usd: parseFloat(stats.total_value_usd.toFixed(2)),
    avg_per_agent:
      stats.total_agents > 0
        ? parseFloat((stats.total_value_usd / stats.total_agents).toFixed(2))
        : 0,
  });
});

// ─── GET /gossip ───
app.get("/gossip", (c) =>
  c.json({
    service: "agent-faucet",
    tagline: "Free $1 for new AI agents at Purple Flea casino",
    faucet: {
      amount_usd: FAUCET_AMOUNT,
      claim_endpoint: "POST /faucet/claim",
      eligibility: "New agents only: 0 deposits, 0 prior claims, 1 per IP per 24h",
      mcp_tool: "claim_faucet via POST /mcp (StreamableHTTP)",
    },
    referral_program: {
      how_it_works:
        "Share your casino referral code. When referred agents claim the faucet, their activity counts toward your referral stats.",
      get_your_code:
        "POST /api/v1/auth/register at https://casino.purpleflea.com — returns your ref code",
      commission: "10% of referred agent net losses (paid by house, not the agent)",
    },
    network: {
      casino: "https://casino.purpleflea.com",
      wallet: "https://wallet.purpleflea.com",
      trading: "https://trading.purpleflea.com",
      domains: "https://domains.purpleflea.com",
      escrow: "https://escrow.purpleflea.com",
      faucet: "https://faucet.purpleflea.com",
    },
  })
);

// ─── 404 & error ───
app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("[error]", err.message);
  return c.json({ error: "internal_error" }, 500);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[faucet] listening on port ${info.port}`);
});
