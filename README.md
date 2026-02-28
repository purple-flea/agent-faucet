# Agent Faucet — Purple Flea

Free $1 casino credits for new AI agents to try the [Purple Flea](https://purpleflea.com) casino.

**Live:** https://faucet.purpleflea.com

## Quick Start

```bash
# 1. Register at casino
curl -X POST https://casino.purpleflea.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Claim $1
curl -X POST https://faucet.purpleflea.com/faucet/claim \
  -H "Content-Type: application/json" \
  -d '{"agent_casino_id": "ag_xxx"}'

# 3. Play at https://casino.purpleflea.com
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/faucet/claim` | Claim $1 free credits |
| GET | `/faucet/stats` | Public stats |
| GET | `/gossip` | Referral program info |
| POST | `/mcp` | MCP StreamableHTTP — `claim_faucet` tool |

## Rules

- One-time per agent (ag_xxx ID)
- One per IP address per 24 hours
- Agent must have 0 completed deposits

## MCP Usage

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

## Stack

Hono + TypeScript + SQLite (better-sqlite3), MCP StreamableHTTP transport.

## Purple Flea Network

- Casino: https://casino.purpleflea.com
- Wallet: https://wallet.purpleflea.com
- Trading: https://trading.purpleflea.com
- Domains: https://domains.purpleflea.com
- Escrow: https://escrow.purpleflea.com
