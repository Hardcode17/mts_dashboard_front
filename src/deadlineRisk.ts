export type DeadlineRiskLevel = 'low' | 'medium' | 'high' | 'unknown'
export interface DeadlineRiskReason {
  code: string
  text: string
}
export interface DeadlineRisk {
  risk: DeadlineRiskLevel
  evaluatedAt?: string
  reasons: DeadlineRiskReason[]
}

export function normalizeDeadlineRisk(value: unknown): DeadlineRisk | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.risk !== 'string' || !['low', 'medium', 'high', 'unknown'].includes(raw.risk)) return undefined
  const evaluatedAt = typeof raw.evaluatedAt === 'string' && Number.isFinite(Date.parse(raw.evaluatedAt))
    ? raw.evaluatedAt : undefined
  const reasons = Array.isArray(raw.reasons) ? raw.reasons.flatMap((entry): DeadlineRiskReason[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const {code, text} = entry as Record<string, unknown>
    return typeof code === 'string' && code && typeof text === 'string' && text ? [{code, text}] : []
  }) : []
  return {risk: raw.risk as DeadlineRiskLevel, evaluatedAt, reasons}
}
