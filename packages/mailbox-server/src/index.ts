export * from "@autotelic/mailbox-domain/procedures"
export { startMailboxService, type MailboxService } from "./service.ts"
export { openEnvelope, sealEnvelope, type EncryptedEnvelope } from "./envelope.ts"
export { didKeyFromEd25519, ed25519FromDidKey, signDetached, verifyDetached } from "./did.ts"
