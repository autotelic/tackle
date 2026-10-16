export interface Task {
  id: string
}

const tasks: Task[] = []

export function loadTask(id: string): Task | undefined {
  return tasks.find((task) => task.id === id)
}
