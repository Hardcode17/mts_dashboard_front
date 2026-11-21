import {useEffect, useState} from 'react'
import {Button, Drawer, Flex, Label, Loader, Text} from '@gravity-ui/uikit'
import {ApiError} from '../../../shared/api/http'
import {externalHttpAddress} from '../../../desk/types'
import {incidentsApi} from '../api/client'
import {displayState} from '../model/toDesk'
import type {IncidentDetailResponse} from '../../../entities/incident/model/api-types'
import {IncidentRelationships} from './IncidentRelationships'

type LoadState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'ready'; detail: IncidentDetailResponse}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})
const relativeFormatter = new Intl.RelativeTimeFormat('ru-RU')

function formatDate(value?: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : 'Не указан'
}

function formatDeadline(deadline: string | null, remaining: number | null, overdue: boolean) {
  const date = formatDate(deadline)
  if (remaining === null || remaining === 0) return date
  const seconds = Math.abs(remaining)
  const amount = seconds < 60 ? seconds : Math.ceil(seconds / 60)
  return date + ' · ' + relativeFormatter.format(overdue ? -amount : amount, seconds < 60 ? 'second' : 'minute')
}

function priorityLabel(priorityId: number): string {
  return {
    1: 'Низкий',
    2: 'Средний',
    3: 'Высокий',
    4: 'Наивысший',
  }[priorityId] ?? 'Неизвестный'
}

export function IncidentApiRoute({number}: {number: string}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({status: 'loading'})

  useEffect(() => {
    const controller = new AbortController()

    void incidentsApi
      .getIncident(number, controller.signal)
      .then((detail) => {
        if (detail.incident.id !== number) throw Error('Ответ ITSM относится к другому инциденту.')
        if (!controller.signal.aborted) setState({status: 'ready', detail})
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message =
          error instanceof ApiError && error.status === 404
            ? `Инцидент ${number} не найден.`
            : error instanceof Error
              ? error.message
              : 'Не удалось загрузить карточку.'
        setState({status: 'error', message})
      })

    return () => controller.abort()
  }, [attempt, number])

  const itsm = state.status === 'ready' ? externalHttpAddress(state.detail.itsmUrl) : null
  const meeting = state.status === 'ready' ? externalHttpAddress(state.detail.meetingUrl) : null
  return (
    <main className="workspace api-incident-route">
      <Text as="h1" variant="header-2">
        Карточка инцидента
      </Text>
      <Drawer
        placement="right"
        open
        onOpenChange={(open) => {
          if (!open) window.location.assign('/')
        }}
      >
        <section className="quick-card" aria-label={`Карточка ${number}`}>
          <Flex alignItems="center" justifyContent="space-between" gap="spacing-3">
            <Text variant="code-1">{number}</Text>
            <Button view="flat" href="/">
              Закрыть
            </Button>
          </Flex>

          {state.status === 'loading' ? (
            <div role="status" aria-label="Загрузка карточки">
              <Loader />
            </div>
          ) : state.status === 'error' ? (
            <>
              <Text role="alert" color="danger">
                {state.message}
              </Text>
              <Flex gap="spacing-2" wrap>
                <Button
                  view="action"
                  onClick={() => {
                    setState({status: 'loading'})
                    setAttempt((value) => value + 1)
                  }}
                >
                  Повторить
                </Button>
                <Button view="outlined" href="/">
                  К дашборду
                </Button>
              </Flex>
            </>
          ) : (
            <>
              <Label
                theme={
                  state.detail.incident.priorityId === 4 ? 'danger' : 'normal'
                }
              >
                {priorityLabel(state.detail.incident.priorityId)} приоритет
              </Label>
              <Text as="h2" variant="header-2">
                {state.detail.incident.header || state.detail.incident.id}
              </Text>
              <dl className="quick-fields">
                {[
                  ['Продукт', state.detail.incident.productName ?? 'Не указан'],
                  ['Сервис', state.detail.incident.service ?? 'Не указан'],
                  ['Статус', displayState(state.detail.incident.stateEnum)],
                  [
                    'Назначенная команда',
                    state.detail.incident.assignedGroupName ?? 'Не назначена',
                  ],
                  [
                    'Исполнитель',
                    state.detail.incident.assignedEmployee ?? 'Не назначен',
                  ],
                  ['Срок решения', formatDeadline(
                    state.detail.incident.deadline,
                    state.detail.incident.remainingSeconds,
                    state.detail.incident.overdue,
                  )],
                  ['Регистрация', formatDate(state.detail.incident.submitDate)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {state.detail.incident.description && (
                <Text variant="body-1">{state.detail.incident.description}</Text>
              )}
              <Flex gap="spacing-2" wrap>
                {itsm && <Button view="action" href={itsm} target="_blank" rel="noopener noreferrer">
                  Детальнее в ITSM
                </Button>}
                {meeting && (
                  <Button view="outlined" href={meeting} target="_blank" rel="noopener noreferrer">
                    Аварийная комната
                  </Button>
                )}
              </Flex>
              {state.detail.itsmDemo && (
                <Text variant="caption-2" color="secondary">
                  Демонстрационная ссылка ITSM
                </Text>
              )}
            </>
          )}
          {state.status !== 'error' && (
            <IncidentRelationships key={number} incidentId={number} />
          )}
        </section>
      </Drawer>
    </main>
  )
}
