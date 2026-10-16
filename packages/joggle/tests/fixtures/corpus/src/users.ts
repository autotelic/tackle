export interface User {
  id: string
  name: string
}

export function findUserById(users: User[], id: string): User | undefined {
  return users.find((user) => user.id === id)
}

export function activeUsers(users: User[]): User[] {
  return users.filter((user) => user.name.length > 0)
}

export function userProfile(id: string): string {
  return `/users/${id}`
}
