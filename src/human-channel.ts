import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createTelePiHumanChannel,
  loadTelePiConfig,
  type QuestionContext,
  telePiConfigExists,
} from './telepi.ts'
import { createTerminalHumanChannel } from './terminal-human.ts'

/**
 * Pick the human channel (#14): TelePi when its config exists, terminal
 * otherwise. `--channel terminal|telepi` forces a choice.
 */
export type HumanChannel = {
  askHuman: (question: string) => Promise<string>
  askWithOptions: (question: string, options: string[]) => Promise<string>
  close: () => void
}

export async function createHumanChannel(
  kind: 'terminal' | 'telepi' | undefined,
  context?: () => QuestionContext,
): Promise<HumanChannel> {
  const resolved = kind ?? ((await telePiConfigExists()) ? 'telepi' : 'terminal')
  if (resolved === 'telepi') {
    const config = await loadTelePiConfig()
    const channel = createTelePiHumanChannel({
      config,
      questionsDir: join(homedir(), '.treadle', 'questions'),
      answersDir: join(homedir(), '.treadle', 'answers'),
      ...(context ? { context } : {}),
    })
    return { ...channel, close: () => {} }
  }
  const terminal = createTerminalHumanChannel()
  return {
    askHuman: terminal.askHuman,
    askWithOptions: (question, options) =>
      terminal.askHuman(`${question} (${options.join(' / ')})`),
    close: terminal.close,
  }
}
