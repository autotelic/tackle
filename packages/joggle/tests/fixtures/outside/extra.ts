/**
 * Fixture living in a sibling directory, so that analysing it from
 * corpus/src produces "../" paths and exercises the cache boundary guard.
 */
export interface User {
  id: string
  name: string
}

export function findUserById(users: User[], id: string): User | undefined {
  return users.find((user) => user.id === id)
}
