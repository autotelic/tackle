import * as Alchemist from "alchemy/Alchemist"
import * as Effect from "effect/Effect"
import { expect, test } from "vitest"
import stack from "../alchemy.run.ts"

type DurableObjectBinding = {
  readonly type: string
  readonly name: string
  readonly className: string
}

/**
 * The authoring path is the claim: a plan with no resources is not a stack
 * declaration. The Worker and the Room classes are read from the same plan an
 * operator would approve, not from a second derivation of the source.
 */
test("the shop plans the board Worker and its Room Durable Objects", async () => {
  const plan = await Effect.runPromise(
    Effect.scoped(Alchemist.plan({ stack, operation: "deploy", stage: "test" })),
  )

  const worker = Object.values(plan.native.resources).find(
    (node) => node.resource.Type === "Cloudflare.Worker",
  )
  expect(worker, "the plan names the board Worker").toBeDefined()

  const durableObjects = (worker?.bindings ?? []).flatMap(
    (binding) =>
      (binding.data as { readonly bindings?: ReadonlyArray<DurableObjectBinding> }).bindings ?? [],
  )
  const roomClasses = durableObjects.filter(
    (binding) =>
      binding.type === "durable_object_namespace" && binding.className.startsWith("RoomModel."),
  )
  const classNames = roomClasses.map((binding) => binding.className)
  expect(classNames, "the plan names the Room aggregate").toContain("RoomModel.RoomAggregate")
  expect(
    classNames.some((name) => name.includes("RoomView")),
    "the plan names the Room view",
  ).toBe(true)
})
