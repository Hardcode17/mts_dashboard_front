import {Accordion, Flex, Label, Text} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
import {normalizeDeadlineRisk, type DeadlineRiskLevel} from './deadlineRisk'
import {dueInstant, moscowTime} from './desk/types'

const riskBadges: Record<DeadlineRiskLevel, {text: string; theme: 'success' | 'warning' | 'danger' | 'normal'}> = {
  low: {text: 'Низкий риск', theme: 'success'},
  medium: {text: 'Средний риск', theme: 'warning'},
  high: {text: 'Высокий риск', theme: 'danger'},
  unknown: {text: 'Риск неизвестен', theme: 'normal'},
}

export function DeadlineRiskPanel({incident}: {incident: Incident}) {
  if (dueInstant(incident) === null) return null
  const risk = normalizeDeadlineRisk(incident.deadlineRisk)
  const badge = risk ? riskBadges[risk.risk] : {text: 'Анализ недоступен', theme: 'normal' as const}
  const evaluatedAt = risk?.evaluatedAt ? Date.parse(risk.evaluatedAt) : Number.NaN
  return (
    <Flex direction="column" gap="spacing-1">
      <Text color="secondary" variant="caption-2">Прогноз нарушения срока</Text>
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Label size="s" theme={badge.theme}>{badge.text}</Label>
        {Number.isFinite(evaluatedAt) && (
          <Text color="secondary" variant="caption-2">Оценка на {moscowTime(evaluatedAt)} МСК</Text>
        )}
      </Flex>
      {risk && risk.reasons.length > 0 && (
        <Accordion qa="deadline-risk-reasons">
          <Accordion.Item summary={'Основания оценки (' + risk.reasons.length + ')'}>
            <ul>
              {risk.reasons.map((reason, index) => <li key={reason.code + index}>{reason.text}</li>)}
            </ul>
          </Accordion.Item>
        </Accordion>
      )}
    </Flex>
  )
}
