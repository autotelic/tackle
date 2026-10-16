export interface User {
  id: string
  name: string
}

export function lookupUserById(users: User[], id: string): User | undefined {
  return users.find((user) => user.id === id)
}

export function recentOrders(orders: Order[]): Order[] {
  return orders.filter((order) => order.total > 0)
}

export function getUserProfile(id: string, tenant: string): string {
  return `/users/${tenant}/${id}`
}

export interface Order {
  id: string
  total: number
}
