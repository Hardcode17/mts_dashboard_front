// Members are local incident keys. ITSM incident numbers and assignments stay independent.
export interface OutageGroup {
  id: string
  title: string
  method: 'parent' | 'evidence' | 'model' | 'manual' | 'single'
  evidence: string[]
  members: string[]
  included: string[]
  excluded: string[]
  owner?: string
  acceptedAt?: number
  createdAt: number
  updatedAt: number
  revision: number
  openedRevision?: number
}

export interface GroupReview {
  groupId: string
  fingerprint: string
  dependency: string
  errorCode: string
  services: string[]
  incidents: number
  samples: string[]
  firstAt: number
  lastAt: number
}

export interface GroupVerdict {
  agree: boolean
  reason: string
  model: string
}

export interface GroupDecisions {
  included: string[]
  excluded: string[]
  owner?: string
  acceptedAt?: number
  createdAt: number
  title?: string
  seed?: string
  retainedMembers?: string[]
  // A bounded episode prevents the same dependency failing hours later from inheriting a live claim.
  episode?: {signature: string; first: number; last: number}
  verdict?: GroupVerdict & {fingerprint: string; retained: string[]; reviewedIncidents: number}
}
