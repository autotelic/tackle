/**
 * Six declarations that always carry the same three fields -- a tenant, a region
 * and an owner -- with no type naming that trio. Whether the trio is one concept
 * is the question; the co-occurrence is the fact.
 */
export interface CrewPayroll {
  tenantId: string
  region: string
  owner: string
  amount: number
}

export interface CrewInvoice {
  tenantId: string
  region: string
  owner: string
  total: number
}

export interface CrewReport {
  tenantId: string
  region: string
  owner: string
  period: string
}

export interface CrewSchedule {
  tenantId: string
  region: string
  owner: string
  shift: string
}

export interface CrewRoster {
  tenantId: string
  region: string
  owner: string
  role: string
}

export interface CrewAudit {
  tenantId: string
  region: string
  owner: string
  action: string
}
