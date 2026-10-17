import { DatabaseSync } from "node:sqlite"

/*
 * The foreman's durable memory.
 *
 * FOREMAN §10: "A plain session's only durable memory is the repository." This is the file
 * that gives the foreman more than a session — a task chain that survives a crash. Every
 * round is a sequence of `Task` rows; every document (the plan, the budget, the journal) is a
 * row too, so the whole foreground state is one SQLite file the repository can commit.
 *
 * Two rules the schema encodes rather than documents:
 *
 *   - A `requestId` is the task's identity, derived from the finding it works on, so a
 *     restart never redoes a done thing (§5.3).
 *   - `status = 'running'` at open means the process died mid-dispatch. Dispatch is NOT
 *     replay-safe (§Appendix), so the store reports it; it never silently repeats it.
 */

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked"

export interface Task {
  readonly requestId: string
  readonly round: number
  readonly phase: string
  readonly role: string
  readonly status: TaskStatus
  readonly prompt: string
  readonly worktree?: string
  readonly agent?: string
  readonly session?: string
  readonly result?: string
  readonly updatedAt: number
}

interface TaskRow {
  requestId: string
  round: number
  phase: string
  role: string
  status: string
  prompt: string
  worktree: string | null
  agent: string | null
  session: string | null
  result: string | null
  updatedAt: number
}

const toTask = (row: TaskRow): Task => ({
  requestId: row.requestId,
  round: row.round,
  phase: row.phase,
  role: row.role,
  status: row.status as TaskStatus,
  prompt: row.prompt,
  ...(row.worktree === null ? {} : { worktree: row.worktree }),
  ...(row.agent === null ? {} : { agent: row.agent }),
  ...(row.session === null ? {} : { session: row.session }),
  ...(row.result === null ? {} : { result: row.result }),
  updatedAt: row.updatedAt,
})

/** The durable store: documents and the round's task chain. */
export class Store {
  readonly #db: DatabaseSync

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        requestId TEXT PRIMARY KEY,
        round INTEGER NOT NULL,
        phase TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        worktree TEXT,
        agent TEXT,
        session TEXT,
        result TEXT,
        updatedAt INTEGER NOT NULL
      );
    `)
  }

  close(): void {
    this.#db.close()
  }

  /** A named document — plan, budget, journal, queue — read back as JSON. */
  document<T>(name: string): T | undefined {
    const row = this.#db.prepare("SELECT json FROM documents WHERE name = ?").get(name) as
      | { json: string }
      | undefined
    if (row === undefined) return undefined
    try {
      return JSON.parse(row.json) as T
    } catch {
      return undefined
    }
  }

  setDocument(name: string, value: unknown): void {
    this.#db
      .prepare(
        "INSERT INTO documents (name, json, updatedAt) VALUES (?, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt",
      )
      .run(name, JSON.stringify(value), Date.now())
  }

  putTask(task: Task): void {
    this.#db
      .prepare(
        "INSERT INTO tasks (requestId, round, phase, role, status, prompt, worktree, agent, session, result, updatedAt) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(requestId) DO UPDATE SET status = excluded.status, agent = excluded.agent, " +
          "session = excluded.session, result = excluded.result, updatedAt = excluded.updatedAt",
      )
      .run(
        task.requestId,
        task.round,
        task.phase,
        task.role,
        task.status,
        task.prompt,
        task.worktree ?? null,
        task.agent ?? null,
        task.session ?? null,
        task.result ?? null,
        task.updatedAt,
      )
  }

  task(requestId: string): Task | undefined {
    const row = this.#db
      .prepare("SELECT * FROM tasks WHERE requestId = ?")
      .get(requestId) as unknown as TaskRow | undefined
    return row === undefined ? undefined : toTask(row)
  }

  tasks(round?: number): ReadonlyArray<Task> {
    const rows = (round === undefined
      ? this.#db.prepare("SELECT * FROM tasks ORDER BY updatedAt").all()
      : this.#db
          .prepare("SELECT * FROM tasks WHERE round = ? ORDER BY updatedAt")
          .all(round)) as unknown as TaskRow[]
    return rows.map(toTask)
  }

  /** Tasks that were mid-flight when the process died — reported, never auto-repeated. */
  interrupted(): ReadonlyArray<Task> {
    const rows = this.#db
      .prepare("SELECT * FROM tasks WHERE status = 'running'")
      .all() as unknown as TaskRow[]
    return rows.map(toTask)
  }
}
