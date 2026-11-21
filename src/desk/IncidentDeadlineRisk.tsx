import {Accordion, Flex, Label, Text} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import type {DeadlineRisk, DeadlineRiskLevel} from '../entities/incident/model/api-types'
import {normalizeDeadlineRisk} from '../entities/incident/model/deadlineRisk'
import {dueInstant, moscowTime} from './types'

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
 * Оценка риска нарушения срока (KAN-83). Показывается только у карточек
 * с дедлайном и живёт рядом, но отдельно от блока «Срок решения»
 * (KAN-46): это прогноз, а не оставшиеся минуты. Оценка не меняет
 * срок, приоритет и статус; score в интерфейсе не показывается.
 */
export function IncidentDeadlineRisk({incident}: {incident: Incident}) {
  const due = dueInstant(incident)
  if (due === null) return null
  const risk: DeadlineRisk | undefined = normalizeDeadlineRisk(incident.deadlineRisk)
  const badge: RiskBadge = risk ? riskBadges[risk.risk] : {text: 'Анализ недоступен', theme: 'normal'}
  const evaluatedAt = risk?.evaluatedAt !== undefined ? Date.parse(risk.evaluatedAt) : Number.NaN
  return (
    <div className="incident-deadline-risk">
      <Text as="span" variant="body-1" color="secondary">
        Прогноз нарушения срока
      </Text>
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Label size="s" theme={badge.theme}>
          {badge.text}
        </Label>
        {Number.isFinite(evaluatedAt) && (
          <Text color="secondary" variant="caption-2">
            Оценка на {moscowTime(evaluatedAt)} МСК
          </Text>
        )}
      </Flex>
      {risk && risk.reasons.length > 0 && (
        <Accordion className="incident-deadline-risk-reasons">
          <Accordion.Item summary={'Основания оценки (' + risk.reasons.length + ')'}>
            <ul className="incident-deadline-risk-reason-list">
              {risk.reasons.map((reason) => (
                <li key={reason.code}>{reason.text}</li>
              ))}
            </ul>
          </Accordion.Item>
        </Accordion>
      )}
    </div>
  )
}
