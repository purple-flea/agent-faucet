/**
 * Faucet MCP Server — StreamableHTTP transport
 * Runs on port 4006, proxied by nginx at /mcp
 */
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  hasAgentClaimed,
  getIpLastClaim,
  recordClaim,
  getCasinoAgent,
  getAgentDepositCount,
  creditCasinoBalance,
  getCasinoAgentByReferralCode,
} from "./db.js";

const PORT = parseInt(process.env.MCP_PORT || "4006");
const FAUCET_AMOUNT = 1.0;

function makeServer() {
  const server = new McpServer({ name: "agent-faucet", version: "1.0.0" });

  server.tool(
    "claim_faucet",
    [
      "Claim $1 of free casino credits from the Purple Flea faucet.",
      "One-time per agent. Agent must be registered at casino.purpleflea.com with no prior deposits.",
      "Steps: 1) Register at https://casino.purpleflea.com/api/v1/auth/register to get an agent ID.",
      "2) Call this tool with your agent_casino_id to receive $1 free credit.",
      "3) Play at https://casino.purpleflea.com — coin flip, dice, roulette, crash and more.",
    ].join(" "),
    {
      agent_casino_id: z.string().describe("Your casino agent ID (ag_xxx format). Get one by registering at casino.purpleflea.com."),
      referral_code: z.string().optional().describe("Optional referral code (ref_xxx). If you registered via someone's referral link, include it here."),
    },
    async ({ agent_casino_id, referral_code }) => {
      function err(code: string, msg: string) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: code, message: msg }) }], isError: true };
      }

      const agentId = agent_casino_id?.trim();
      if (!agentId?.startsWith("ag_")) {
        return err("invalid_request", "agent_casino_id must be in ag_xxx format. Register at https://casino.purpleflea.com/api/v1/auth/register");
      }

      const agent = getCasinoAgent(agentId);
      if (!agent) {
        return err("agent_not_found", "Agent not found. Register at https://casino.purpleflea.com/api/v1/auth/register");
      }

      if (hasAgentClaimed(agentId)) {
        return err("already_claimed", "This agent has already claimed the faucet bonus. Make a deposit to keep playing.");
      }

      if (getAgentDepositCount(agentId) > 0) {
        return err("has_deposits", "Faucet is only for brand-new agents with no deposits.");
      }

      // Referrer resolution
      let referrerId: string | null = agent.referred_by;
      if (referral_code) {
        const referrer = getCasinoAgentByReferralCode(referral_code);
        if (referrer && referrer.id !== agentId) referrerId = referrer.id;
      }

      const claimId = randomUUID();
      creditCasinoBalance(agentId, FAUCET_AMOUNT, "faucet_claim: $1 free credits", claimId);
      recordClaim(claimId, agentId, "mcp-client", referral_code ?? null, referrerId, FAUCET_AMOUNT);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            credited: FAUCET_AMOUNT,
            message: "Free $1 credited. Use it to try the casino!",
            casino_url: "https://casino.purpleflea.com",
            agent_id: agentId,
            referral_tracked: referrerId !== null,
            tip: "Deposit more to keep playing after your free credit runs out. Coin flip is 50/50 at 1.96x payout.",
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  next();
});

app.options("/mcp", (_req, res) => { res.sendStatus(204); });

app.post("/mcp", async (req, res) => {
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) => {
  res.json({
    service: "agent-faucet-mcp",
    transport: "StreamableHTTP",
    endpoint: "POST /mcp",
    tools: ["claim_faucet"],
    description: "MCP server for Purple Flea Agent Faucet. Claim $1 free casino credits.",
  });
});

app.listen(PORT, () => {
  console.log(`[faucet-mcp] listening on port ${PORT}`);
});
