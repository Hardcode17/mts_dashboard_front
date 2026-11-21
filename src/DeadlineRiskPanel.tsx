import {Accordion, Flex, Label, Text} from '@gravity-ui/uikit'
import type {DeadlineRiskLevel, Incident} from './demoData'
import {dueInstant, moscowTime} from './desk/types'
import {normalizeDeadlineRisk} from './deadlineRisk'

interface RiskBadge {
  text: string
  theme: 'success' | 'warning' | 'danger' | 'normal'
}
const riskBadges: Record<DeadlineRiskLevel, RiskBadge> = {
  low: {text: 'Низкий риск', theme: 'success'},
  medium: {text: 'Средний риск', theme: 'warning'},
  high: {text: 'Высокий риск', theme: 'danger'},
  unknown: {text: 'Риск неизвестен', theme: 'normal'},
}

/**
 * Оценка риска нарушения срока (KAN-83). Блок показывается только у
 * карточек с дедлайном и отображается рядом, но независимо от
 * предупреждения по остатку времени (KAN-46): это прогноз, а не
 * оставшиеся минуты. Оценка не меняет срок, приоритет и статус.
 */
export function DeadlineRiskPanel({incident}: {incident: Incident}) {
  const due = dueInstant(incident)
  if (due === null) return null
  const risk = normalizeDeadlineRisk(incident.deadlineRisk)
  const badge: RiskBadge = risk ? riskBadges[risk.risk] : {text: 'Анализ недоступен', theme: 'normal'}
  const evaluatedAt = risk?.evaluatedAt !== undefined ? Date.parse(risk.evaluatedAt) : Number.NaN
  return (
    <Flex direction="column" gap="spacing-1" className="deadline-risk">
      <Text color="secondary" variant="caption-2">Прогноз нарушения срока</Text>
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Label size="s" theme={badge.theme} className="deadline-risk-badge">{badge.text}</Label>
        {Number.isFinite(evaluatedAt) && (
          <Text color="secondary" variant="caption-2">Оценка на {moscowTime(evaluatedAt)} МСК</Text>
        )}
      </Flex>
      {risk && risk.reasons.length > 0 && (
        <Accordion className="deadline-risk-reasons" qa="deadline-risk-reasons">
          <Accordion.Item summary={'Основания оценки (' + risk.reasons.length + ')'}>
            <ul className="deadline-risk-reason-list">
              {risk.reasons.map((reason) => (
                <li key={reason.code}>{reason.text}</li>
              ))}
            </ul>
          </Accordion.Item>
        </Accordion>
      )}
    </Flex>
  )
}
