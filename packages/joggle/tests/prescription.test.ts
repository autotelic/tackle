import { expect, test } from "vitest"
import { prescriptionFor } from "../src/rules/cluster-verdict.ts"

test("the same duplication gets opposite prescriptions", () => {
  // Two independently deployed services share a SHAPE, not a module. Telling one
  // to import from the other is worse advice than saying nothing.
  expect(prescriptionFor({ role: "wire_contract", relationship: "different_deployables" })).toContain("Expected")
  // The same shape as a domain concept is the defect the architecture exists to
  // prevent, and the remedy is a package both can depend on.
  expect(prescriptionFor({ role: "domain_concept", relationship: "different_deployables" })).toContain("shared package")
})

test("inside one package none of that matters", () => {
  // Whatever it is, if the files can see each other the answer is mechanical.
  for (const role of ["wire_contract", "domain_concept", "implementation_detail", "framework_glue"]) {
    expect(prescriptionFor({ role, relationship: "same_module" })).toContain("Delete the copies")
    expect(prescriptionFor({ role, relationship: "same_package" })).toContain("Delete the copies")
  }
})

test("framework glue is repeated by construction", () => {
  expect(prescriptionFor({ role: "framework_glue", relationship: "different_deployables" })).toContain("leave them")
})

test("an unknown role still gets advice", () => {
  // The model can answer with an option this did not anticipate, and the fallback
  // has to be something a reader can act on rather than an empty string.
  const advice = prescriptionFor({ role: "something_new", relationship: "different_deployables" })
  expect(advice.length).toBeGreaterThan(20)
})
