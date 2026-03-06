# Agent Faucet — Purple Flea

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Live](https://img.shields.io/badge/live-faucet.purpleflea.com-blueviolet)](https://faucet.purpleflea.com)
[![MCP](https://img.shields.io/badge/MCP-StreamableHTTP-blue)](https://faucet.purpleflea.com/mcp)
[![Smithery](https://img.shields.io/badge/Smithery-purpleflea%2Ffaucet-purple)](https://smithery.ai/servers/purpleflea/faucet)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18808440.svg)](https://doi.org/10.5281/zenodo.18808440)

Free $1 casino credits for new AI agents to try the [Purple Flea](https://purpleflea.com) financial network. Zero risk, zero deposit — just register and claim.

**Live:** https://faucet.purpleflea.com | **MCP:** https://faucet.purpleflea.com/mcp

---

## Quick Start

```bash
# 1. Register at casino (get your agent_casino_id)
curl -s -X POST https://casino.purpleflea.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{agent_id: .agent.id, api_key: .agent.api_key}'

# 2. Claim $1 free credits
curl -s -X POST https://faucet.purpleflea.com/faucet/claim \
  -H "Content-Type: application/json" \
  -d '{"agent_casino_id": "ag_xxx"}' | jq .

# 3. Play at the casino (use your API key from step 1)
curl -s -X POST https://casino.purpleflea.com/api/v1/games/dice \
  -H "Authorization: Bearer pf_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1.00, "prediction": "over", "target": 50}'
```

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/faucet/claim` | Claim $1 free credits (one-time per agent) |
| GET | `/faucet/stats` | Public faucet stats |
| GET | `/gossip` | Referral program info |
| POST | `/mcp` | MCP StreamableHTTP — `claim_faucet` tool |

---

## Rules

- One-time per agent (`ag_xxx` ID)
- One per IP address per 24 hours
- Agent must have 0 completed deposits

---

## MCP Server

Add to your Claude / Cursor / Windsurf MCP config:

```json
{
  "mcpServers": {
    "agent-faucet": {
      "type": "streamable-http",
      "url": "https://faucet.purpleflea.com/mcp"
    }
  }
}
```

The MCP server exposes a single `claim_faucet` tool. Your agent can call it directly without any pre-configured API key.

---

## Research

This service is described in:

> **Purple Flea: A Multi-Agent Financial Infrastructure Protocol for Autonomous AI Systems**
> https://doi.org/10.5281/zenodo.18808440

---

## Stack

Hono + TypeScript + SQLite (better-sqlite3), MCP StreamableHTTP transport.

---

## Purple Flea Network

| Service | URL | Description |
|---------|-----|-------------|
| Casino | https://casino.purpleflea.com | Provably fair games |
| Wallet | https://wallet.purpleflea.com | Multi-chain crypto wallets |
| Trading | https://trading.purpleflea.com | 275+ markets |
| Domains | https://domains.purpleflea.com | ENS + TLD registration |
| Escrow | https://escrow.purpleflea.com | Trustless agent payments |
| **Faucet** | https://faucet.purpleflea.com | **Free $1 for new agents** |
