import { ModelRuntime, SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent'
const rt = await ModelRuntime.create()
const model = rt.getModel('opencode-go', 'glm-5.3-flash')
const { session } = await createAgentSession({ cwd: process.cwd(), sessionManager: SessionManager.inMemory(), model, modelRuntime: rt })
const big = 'You are one work session of Treadle. ' + 'Context line. '.repeat(4000)
session.subscribe((e) => { if (e.type === 'auto_retry_start') console.log('retry:', e.errorMessage) })
try { await session.prompt(big); console.log('OK:', String(session.getLastAssistantText()).slice(0,80)) }
catch (e) { console.log('THREW:', String(e).slice(0,200)) }
console.log('state error:', session.agent.state.errorMessage)
process.exit(0)
