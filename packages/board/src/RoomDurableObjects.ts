import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare"

/**
 * The same Room model, hosted on Durable Objects. This is the production
 * hosting Layer; stories and tests use Domain.InMemory instead. Swapping one
 * for the other changes nothing in room.
 */
export const RoomDurableObjects = DomainCloudflare.layerDurableObjects()
