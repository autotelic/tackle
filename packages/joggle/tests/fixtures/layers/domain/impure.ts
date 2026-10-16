import { useState } from "react"
import { z } from "zod"

// A domain package that reaches for a framework. "Pure" is not a judgement --
// this is an import-graph fact with an exact answer.
export const useThing = () => useState(z.string())
