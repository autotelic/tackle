import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conflictKind, describeConflicts } from '../src/loop/rebase.ts'

describe('conflictKind', () => {
  it('classifies a note, a ledger, a generated artifact and a source file', () => {
    expect(conflictKind('PROGRESS.md')).toBe('scratch')
    expect(conflictKind('.jig-baseline.json')).toBe('ledger')
    expect(
      conflictKind('site/tools/ui-catalog/catalog.json', { generated: ['site/tools/ui-catalog'] }),
    ).toBe('generated')
    expect(conflictKind('site/src/middleware.ts', { generated: ['site/tools/ui-catalog'] })).toBe(
      'source',
    )
  })

  it('a prefix match is a directory match, never a partial name', () => {
    /* `site/tools/ui-catalog` names a directory: a sibling with a similar
     * name is a different file and stays a source conflict. */
    expect(
      conflictKind('site/tools/ui-catalog.json', { generated: ['site/tools/ui-catalog/'] }),
    ).toBe('source')
    expect(
      conflictKind('site/tools/ui-catalog/menu.json', { generated: ['site/tools/ui-catalog/'] }),
    ).toBe('generated')
  })

  it('is a source conflict when the repo declared nothing', () => {
    expect(conflictKind('generated/menu.json')).toBe('source')
  })
})

describe('describeConflicts', () => {
  it('names the files and what each one is, so the note is actionable', () => {
    const text = describeConflicts(
      ['PROGRESS.md', 'site/src/middleware.ts', 'site/tools/ui-catalog/menu.json'],
      { generated: ['site/tools/ui-catalog'] },
    )
    expect(text).toContain('3 conflicted file(s)')
    expect(text).toContain('PROGRESS.md (scratch)')
    expect(text).toContain('site/src/middleware.ts (source)')
    expect(text).toContain('site/tools/ui-catalog/menu.json (generated)')
  })

  it('says so when nothing is conflicted', () => {
    expect(describeConflicts([])).toBe('no conflicted paths')
  })
})
