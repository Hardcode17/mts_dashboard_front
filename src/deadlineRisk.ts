import type {DeadlineRisk, DeadlineRiskLevel, DeadlineRiskReason} from './demoData.ts'

export const deadlineRiskLevels = ['low', 'medium', 'high', 'unknown'] as const

function isRiskLevel(value: unknown): value is DeadlineRiskLevel {
  return (deadlineRiskLevels as readonly unknown[]).includes(value)
}

function validReasons(value: unknown): DeadlineRiskReason[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): DeadlineRiskReason[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const {code, text} = entry as Record<string, unknown>
    return typeof code === 'string' && typeof text === 'string' && code && text ? [{code, text}] : []
  })
}

/**
 * Приводит поле deadlineRisk из ответа API к отображаемому виду.
 * Карточка не должна ломаться на неполных данных: объект без
 * распознанной категории риска трактуется как «анализ недоступен»,
 * повреждённые основания отбрасываются, score не используется.
 */
export function normalizeDeadlineRisk(value: unknown): DeadlineRisk | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!isRiskLevel(raw.risk)) return undefined
  const evaluatedAt =
    typeof raw.evaluatedAt === 'string' && Number.isFinite(Date.parse(raw.evaluatedAt)) ? raw.evaluatedAt : undefined
  return {risk: raw.risk, evaluatedAt, reasons: validReasons(raw.reasons)}
}
