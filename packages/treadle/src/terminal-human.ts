import { createInterface } from 'node:readline'

/**
 * The terminal human channel: answer ask_human questions on stdin. Used until
 * the TelePi channel lands (#14). Rejects when stdin closes, so a dead
 * terminal ends the Session blocked-on-human instead of hanging forever.
 */
export function createTerminalHumanChannel(): {
  askHuman: (question: string) => Promise<string>
  close: () => void
} {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let rlClosed = false
  let pendingReject: ((error: Error) => void) | null = null
  rl.once('close', () => {
    rlClosed = true
    pendingReject?.(new Error('stdin closed'))
  })
  const askHuman = (question: string): Promise<string> =>
    new Promise((resolveAnswer, reject) => {
      if (rlClosed) {
        reject(new Error('stdin is closed'))
        return
      }
      pendingReject = reject
      try {
        rl.question(`\n[ask_human] ${question}\nanswer> `, (answer) => {
          pendingReject = null
          resolveAnswer(answer)
        })
      } catch (error) {
        pendingReject = null
        reject(error)
      }
    })
  return { askHuman, close: () => rl.close() }
}
