import { resolve } from "node:path"
import { API } from "@typescript/native-preview/unstable/async"

/**
 * The checker's type for a node, by file and offset.
 *
 * The declaration-level trace (`typetrace.ts`) joins a NAME to its resolved type,
 * and the join is awkward: aliases expand, one name is several entries, and some
 * names never appear under their own name. This is the other half -- PER
 * EXPRESSION -- and it joins by BYTE OFFSET, which both the checker and the oxc
 * parser read from the same file, so the join is exact.
 *
 * It is the native-preview API (`getTypeAtPosition`), which ships with the `tsgo`
 * binary joggle already runs, so there is no fork: one program, a lookup per
 * position, and the checker's own printed type.
 *
 * It is deliberately a REQUEST LIST rather than a whole-project dump. The output
 * for 1,870 files would be enormous, and a rule only asks about the nodes its
 * candidates are built from.
 */
export interface NodeTypeRequest {
  readonly file: string
  readonly position: number
}

export interface NodeType {
  readonly file: string
  readonly position: number
  /** The checker's printed type: `number`, `{ id: string }`, `string | null`. */
  readonly type: string
}

/** What a rule reads: the checker's type at an offset, or undefined. */
export type NodeTypeIndex = (file: string, position: number) => string | undefined

/**
 * Index node types by file and position.
 *
 * @param entries - what {@link typesAtPositions} returned.
 * @returns a lookup a rule can call.
 */
export const indexOfNodeTypes = (entries: ReadonlyArray<NodeType>): NodeTypeIndex => {
  const byKey = new Map<string, string>()
  for (const entry of entries) byKey.set(entry.file + "\u0000" + String(entry.position), entry.type)
  return (file, position) => byKey.get(file + "\u0000" + String(position))
}

/**
 * The project, its tsconfig, and the positions to resolve types at.
 */
export interface NodeTypeQuery {
  readonly cwd: string
  readonly tsconfig: string
  readonly requests: ReadonlyArray<NodeTypeRequest>
}

/** What the checker resolved, and the positions it had nothing for. */
export interface NodeTypeResult {
  readonly found: ReadonlyArray<NodeType>
  /** Positions with no project or no type: a miss a caller can see, not silence. */
  readonly unresolved: number
}

/**
 * Ask the checker for the type at each position, in one program.
 *
 * @param input - the project root, the tsconfig to open, and the positions.
 * @returns the resolved entries, in request order, and how many positions the
 *   checker had no project or no type for.
 */
export const typesAtPositions = async (input: NodeTypeQuery): Promise<NodeTypeResult> => {
  if (input.requests.length === 0) return { found: [], unresolved: 0 }
  const api = new API({ cwd: input.cwd })
  // The identifier is a PATH, and it must be absolute: a relative one is not found.
  const absolute = (file: string): string => resolve(input.cwd, file)
  const collect = async (): Promise<NodeTypeResult> => {
    const snapshot = await api.updateSnapshot({ openProjects: [absolute(input.tsconfig)] })
    const found: Array<NodeType> = []
    let unresolved = 0
    for (const request of input.requests) {
      const project = await snapshot.getDefaultProjectForFile(absolute(request.file))
      const type =
        project === undefined
          ? undefined
          : await project.checker.getTypeAtPosition(absolute(request.file), request.position)
      if (project === undefined || type === undefined) {
        unresolved += 1
        continue
      }
      found.push({
        file: request.file,
        position: request.position,
        type: await project.checker.typeToString(type),
      })
    }
    return { found, unresolved }
  }
  // `.finally`, not `try/finally`: the checker is a child process and it must be
  // closed whatever happens, and `.finally` does not swallow the failure.
  return await collect().finally(() => api.close())
}
