import { execFileSync } from "node:child_process"

/*
 * The budget governor. §9: "a budget is a document, not a feeling" — so it is a committed
 * JSON file, and every dispatch asks this module before it spends.
 *
 * Two meters, and this reads the one that gates the opencode account:
 *
 *   - the **opencode meter** (`opencode2 stats`) is what sessions and crew cost, and is the
 *     ceiling a round yields to;
 *   - the **TypeSafe meter** is joggle's judged rules, spent elsewhere and replayed from a
 *     committed cache — not modelled here.
 *
 * The committed `spent` is the snapshot the round opened at; the round's own spend is the
 * meter now minus that snapshot. Hitting a ceiling does not slow a dispatch — it stops it
 * from starting, and lets in-flight work finish (§9).
 */

export interface Budget {
  readonly window: string
  readonly ceilingTokens: number
  readonly ceilingUsd: number
  readonly spent: { readonly tokens: number; readonly usd: number; readonly at?: string }
  readonly concurrency: number
  readonly pausedUntil: number | null
  readonly note: string
}

export interface AccountUsage {
  readonly tokens: number
  readonly usd: number
  readonly sessions: number
  readonly subagents: number
}

export interface BudgetDecision {
  readonly ok: boolean
  readonly reason: string
  readonly roundTokens: number
  readonly roundUsd: number
}

/** Read the committed budget; malformed or absent is a document with no headroom. */
export const readBudget = (path: string): Budget | undefined => {
  try {
    return JSON.parse(execFileSync("cat", [path], { encoding: "utf8" })) as Budget
  } catch {
    return undefined
  }
}

/** The account's usage, straight from the meter — the truth for the opencode side (§9). */
export const accountUsage = (project: string): AccountUsage | undefined => {
  try {
    const text = execFileSync("opencode2", ["stats", "--json", "--full", "--project", project], {
      encoding: "utf8",
    })
    const doc = JSON.parse(text) as {
      tokens: { input: number; output: number; reasoning: number }
      cost: number
      sessions: number
      subagents: number
    }
    return {
      tokens: doc.tokens.input + doc.tokens.output + doc.tokens.reasoning,
      usd: doc.cost,
      sessions: doc.sessions,
      subagents: doc.subagents,
    }
  } catch {
    return undefined
  }
}

/** Whether a new dispatch may start. `inflight` is the count of running tasks right now. */
export const decide = (
  budget: Budget,
  usage: AccountUsage | undefined,
  inflight: number,
  now: number = Date.now(),
): BudgetDecision => {
  if (budget.pausedUntil !== null && now < budget.pausedUntil) {
    return {
      ok: false,
      reason: `paused until ${new Date(budget.pausedUntil).toISOString()}`,
      roundTokens: 0,
      roundUsd: 0,
    }
  }
  if (inflight >= budget.concurrency) {
    return {
      ok: false,
      reason: `concurrency ${inflight}/${budget.concurrency} reached`,
      roundTokens: 0,
      roundUsd: 0,
    }
  }
  if (usage === undefined) {
    // §9: read both meters. A meter that cannot be read is not headroom.
    return {
      ok: false,
      reason: "the opencode meter could not be read",
      roundTokens: 0,
      roundUsd: 0,
    }
  }
  const roundTokens = Math.max(0, usage.tokens - budget.spent.tokens)
  const roundUsd = Math.max(0, usage.usd - budget.spent.usd)
  if (roundTokens >= budget.ceilingTokens || roundUsd >= budget.ceilingUsd) {
    return {
      ok: false,
      reason: `ceiling reached: ${roundTokens} tokens / $${roundUsd.toFixed(4)} this round`,
      roundTokens,
      roundUsd,
    }
  }
  return { ok: true, reason: "under ceiling", roundTokens, roundUsd }
}
