import { BrowserHost } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import "./style.css"
import { BoardView } from "./main.ts"

const Main = BrowserHost.mount(BoardView, {}, document.getElementById("root")!)

Layer.launch(Main).pipe(Effect.runFork)
