import Database, { type Database as DatabaseType } from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";

// Faucet's own DB for tracking claims and referral stats
const FAUCET_DB_PATH = process.env.FAUCET_DB_PATH || "./data/faucet.db";
const dir = "./data";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

export const faucetDb: DatabaseType = new Database(FAUCET_DB_PATH);
faucetDb.pragma("journal_mode = WAL");
faucetDb.pragma("foreign_keys = ON");
faucetDb.pragma("busy_timeout = 30000");

// Casino DB — read/write for balance credits
const CASINO_DB_PATH = process.env.CASINO_DB_PATH || "/home/dev/casino/data/casino.db";
export const casinoDb: DatabaseType = new Database(CASINO_DB_PATH);
casinoDb.pragma("journal_mode = WAL");
casinoDb.pragma("busy_timeout = 30000");

// ─── Faucet schema ───
faucetDb.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    ip TEXT NOT NULL,
    referral_code TEXT,
    referrer_id TEXT,
    amount_usd REAL NOT NULL DEFAULT 1.0,
    credited_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_agent ON claims(agent_id);
  CREATE INDEX IF NOT EXISTS idx_claims_ip ON claims(ip);
  CREATE INDEX IF NOT EXISTS idx_claims_referrer ON claims(referrer_id);

  CREATE TABLE IF NOT EXISTS ip_cooldowns (
    ip TEXT PRIMARY KEY,
    last_claim INTEGER NOT NULL
  );
`);

// ─── Faucet DB helpers ───

export function hasAgentClaimed(agentId: string): boolean {
  const row = faucetDb.prepare("SELECT 1 FROM claims WHERE agent_id = ?").get(agentId);
  return !!row;
}

export function getIpLastClaim(ip: string): number | null {
  const row = faucetDb.prepare("SELECT last_claim FROM ip_cooldowns WHERE ip = ?").get(ip) as { last_claim: number } | undefined;
  return row?.last_claim ?? null;
}

export function recordClaim(
  id: string,
  agentId: string,
  ip: string,
  referralCode: string | null,
  referrerId: string | null,
  amountUsd: number
): void {
  faucetDb.transaction(() => {
    faucetDb.prepare(`
      INSERT INTO claims (id, agent_id, ip, referral_code, referrer_id, amount_usd)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, agentId, ip, referralCode, referrerId, amountUsd);

    faucetDb.prepare(`
      INSERT INTO ip_cooldowns (ip, last_claim) VALUES (?, unixepoch())
      ON CONFLICT(ip) DO UPDATE SET last_claim = unixepoch()
    `).run(ip);
  })();
}

export function getFaucetStats(): { total_claims: number; total_agents: number; total_value_usd: number } {
  const row = faucetDb.prepare(`
    SELECT COUNT(*) as total_claims, COUNT(DISTINCT agent_id) as total_agents, COALESCE(SUM(amount_usd), 0) as total_value_usd
    FROM claims
  `).get() as { total_claims: number; total_agents: number; total_value_usd: number };
  return row;
}

// ─── Casino DB helpers ───

interface CasinoAgent {
  id: string;
  balance_usd: number;
  total_deposited: number;
  referred_by: string | null;
  referral_code: string | null;
}

export function getCasinoAgent(agentId: string): CasinoAgent | null {
  return casinoDb.prepare(`
    SELECT id, balance_usd, total_deposited, referred_by, referral_code
    FROM agents WHERE id = ?
  `).get(agentId) as CasinoAgent | null;
}

export function getAgentDepositCount(agentId: string): number {
  const row = casinoDb.prepare(`
    SELECT COUNT(*) as cnt FROM deposits WHERE agent_id = ? AND status = 'completed'
  `).get(agentId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

export function creditCasinoBalance(agentId: string, amount: number, reason: string, reference: string): void {
  casinoDb.transaction(() => {
    casinoDb.prepare(`
      UPDATE agents SET balance_usd = balance_usd + ? WHERE id = ?
    `).run(amount, agentId);

    const agent = casinoDb.prepare(`SELECT balance_usd FROM agents WHERE id = ?`).get(agentId) as { balance_usd: number };

    casinoDb.prepare(`
      INSERT INTO ledger_entries (id, agent_id, type, amount, balance_after, reason, reference, service, created_at)
      VALUES (?, ?, 'credit', ?, ?, ?, ?, 'faucet', unixepoch())
    `).run(reference + "_ledger", agentId, amount, agent.balance_usd, reason, reference);
  })();
}

export function getCasinoAgentByReferralCode(code: string): CasinoAgent | null {
  return casinoDb.prepare(`
    SELECT id, balance_usd, total_deposited, referred_by, referral_code
    FROM agents WHERE referral_code = ?
  `).get(code) as CasinoAgent | null;
}
