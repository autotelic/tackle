import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare"

/**
 * The same Bench model, hosted on Durable Objects. This is the production
 * hosting Layer; stories and tests use Domain.InMemory instead. Swapping one
 * for the other changes nothing in bench-domain.
 */
export const BenchDurableObjects = DomainCloudflare.layerDurableObjects()
