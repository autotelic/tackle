import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneSessions } from '../src/sessions.ts'

const day = 24 * 60 * 60 * 1000

/** A session log written `daysAgo`, named the way the Loop names them. */
const log = (dir: string, issue: number, pass: number, daysAgo: number): string => {
  const name = `issue-${issue}-pass-${pass}-2026-01-01T00-00-00-000Z.jsonl`
  const path = join(dir, name)
  writeFileSync(path, '{"ts":"2026-01-01T00:00:00.000Z"}\n')
  const at = Date.now() - daysAgo * day
  utimesSync(path, at / 1000, at / 1000)
  return name
}

describe('pruneSessions', () => {
  it('removes logs past the age limit and keeps the recent ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'treadle-prune-'))
    try {
      const oldName = log(dir, 1, 1, 30)
      const recentName = log(dir, 2, 1, 1)
      const result = await pruneSessions({ sessionsDir: dir, keepDays: 7 })
      expect(result.removed).toBe(1)
      const names = (await import('node:fs')).readdirSync(dir)
      expect(names).not.toContain(oldName)
      expect(names).toContain(recentName)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps an open issue's newest log however old, because re-entry reads it", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'treadle-prune-'))
    try {
      const newest = log(dir, 7, 3, 40)
      const older = log(dir, 7, 2, 41)
      const result = await pruneSessions({
        sessionsDir: dir,
        keepDays: 7,
        openIssues: new Set([7]),
      })
      expect(result.removed).toBe(1)
      const names = (await import('node:fs')).readdirSync(dir)
      expect(names).toContain(newest)
      expect(names).not.toContain(older)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("removes a finished issue's old transcripts, newest included", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'treadle-prune-'))
    try {
      log(dir, 9, 1, 40)
      log(dir, 9, 2, 39)
      const result = await pruneSessions({ sessionsDir: dir, keepDays: 7, openIssues: new Set() })
      expect(result.removed).toBe(2)
      expect((await import('node:fs')).readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves files it does not recognise alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'treadle-prune-'))
    try {
      writeFileSync(join(dir, 'notes.md'), 'keep me')
      utimesSync(
        join(dir, 'notes.md'),
        Date.now() / 1000 - 400 * 24 * 60 * 60,
        Date.now() / 1000 - 400 * 24 * 60 * 60,
      )
      const result = await pruneSessions({ sessionsDir: dir, keepDays: 1 })
      expect(result.removed).toBe(0)
      expect((await import('node:fs')).readdirSync(dir)).toContain('notes.md')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a no-op on a directory that does not exist', async () => {
    const result = await pruneSessions({ sessionsDir: '/nonexistent-sessions-dir', keepDays: 7 })
    expect(result).toEqual({ removed: 0, removedBytes: 0, kept: 0 })
  })
})
