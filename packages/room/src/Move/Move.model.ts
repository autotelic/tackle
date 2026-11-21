import * as Domain from "@alchemy.run/domain"
import { Move } from "./Move.aggregate.ts"

/** The move protocol on its own; the shop orchestrates the copy outside it. */
export class MoveModel extends Domain.Model("MoveModel", { aggregates: [Move] }) {}
