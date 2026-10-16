import { loadTask } from "./dup.ts"
import type { Task } from "./dup.ts"

export function describe(task: Task): string {
  return task.id
}

export function show(id: string): string | undefined {
  const task = loadTask(id)
  return task === undefined ? undefined : describe(task)
}
