import {useEffect, useState} from 'react'
import {Button, Drawer, Flex, Label, Loader, Text} from '@gravity-ui/uikit'
import {ApiError} from '../../../shared/api/http'
import {incidentsApi} from '../api/client'
import type {IncidentDetailResponse} from '../../../entities/incident/model/api-types'

type LoadState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'ready'; detail: IncidentDetailResponse}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : 'Не указан'
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
      .then((detail) => setState({status: 'ready', detail}))
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

  return (
    <main className="workspace api-incident-route">
      <Text as="h1" variant="header-2">
        Карточка инцидента
      </Text>
      <Text color="secondary" variant="body-1">
        Загрузка данных из API рабочего места MCC.
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
                {state.detail.incident.header}
              </Text>
              <dl className="quick-fields">
                {[
                  ['Продукт', state.detail.incident.productName ?? 'Не указан'],
                  ['Сервис', state.detail.incident.service ?? 'Не указан'],
                  ['Статус', state.detail.incident.stateEnum],
                  [
                    'Назначенная команда',
                    state.detail.incident.assignedGroupName ?? 'Не назначена',
                  ],
                  [
                    'Исполнитель',
                    state.detail.incident.assignedEmployee ?? 'Не назначен',
                  ],
                  ['Срок решения', formatDate(state.detail.incident.deadline)],
                  ['Регистрация', formatDate(state.detail.incident.submitDate)],
                  ['Обновлено', formatDate(state.detail.incident.updatedAt)],
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
                <Button view="action" href={state.detail.itsmUrl} target="_blank">
                  Детальнее в ITSM
                </Button>
                {state.detail.meetingUrl && (
                  <Button view="outlined" href={state.detail.meetingUrl} target="_blank">
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
        </section>
      </Drawer>
    </main>
  )
}
