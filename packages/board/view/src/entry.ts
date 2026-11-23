import { Runtime } from "foldkit"
import "./style.css"
import { Message, Model, init, subscriptions, update, view } from "./main.ts"

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions: { presenceTicks: subscriptions },
  container: document.getElementById("root"),
  devTools: { Message },
})

Runtime.run(application)
