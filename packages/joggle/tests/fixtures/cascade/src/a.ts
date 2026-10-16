export interface Task {
  id: string
}

const tasks: Task[] = []

export function loadTask(id: string): Task | undefined {
  return tasks.find((task) => task.id === id)
}

export function firstTask(): Task | undefined {
  return loadTask("first")
}
