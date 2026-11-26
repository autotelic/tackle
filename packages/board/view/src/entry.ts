import { BrowserHost } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import "./style.css"
import { BoardView } from "./main.ts"

const Main = BrowserHost.mount(BoardView, {}, document.getElementById("root")!)

// SAFETY: BrowserHost.mount returns the app layer; the host requirements are already supplied
// by the browser mount, but @effect/ui and this Effect patch type the launch as R=any.
Effect.runFork(Layer.launch(Main) as Effect.Effect<never, never>)
