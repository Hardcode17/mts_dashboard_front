import {CircleExclamation} from '@gravity-ui/icons'
import {Button, Card, Flex, Icon, Label, Modal, Text} from '@gravity-ui/uikit'
import type {AlertGroup} from './types'
import './CriticalAlertOverlay.css'

export interface CriticalAlertEvent {
  key: string
  incident: AlertGroup
}

interface CriticalAlertOverlayProps {
  open: boolean
  events: CriticalAlertEvent[]
  onConfirm: () => void
}

interface CriticalAlertPinnedProps {
  events: CriticalAlertEvent[]
  secondsLeft: number
  onConfirm: () => void
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(value?: string): string {
  return value ? dateFormatter.format(new Date(value)) : 'Срок не указан'
}

function isOverdue(value?: string): boolean {
  return Boolean(value && new Date(value).getTime() < Date.now())
}

function eventsWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100

  if (mod10 === 1 && mod100 !== 11) {
    return 'событие'
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'события'
  }

  return 'событий'
}

export function CriticalAlertOverlay({
  open,
  events,
  onConfirm,
}: CriticalAlertOverlayProps) {
  return (
    <Modal
      open={open}
      disableEscapeKeyDown
      disableOutsideClick
      disableVisuallyHiddenDismiss
      contentOverflow="auto"
      contentClassName="oncall-critical-modal"
      aria-labelledby="oncall-critical-title"
      qa="critical-alert-modal"
    >
      <section className="oncall-critical-alert">
        <Flex alignItems="center" gap="spacing-2">
          <Icon data={CircleExclamation} size={28} color="danger" />
          <Text id="oncall-critical-title" variant="header-2" as="h2">
            {events.length === 1
              ? 'Критический инцидент'
              : 'Критические инциденты'}
          </Text>
        </Flex>

        <Text variant="body-1" color="secondary">
          Обзор закрыт до подтверждения. Проверьте номер, продукт, срок и
          текущую команду. «Увидел» подтверждает перечисленные события.
        </Text>

        <div className="oncall-critical-alert__list">
          {events.map((event) => {
            const {incident} = event
            const overdue = isOverdue(incident.slaDeadline)

            return (
              <Card
                key={event.key}
                view="outlined"
                className="oncall-critical-alert__item"
              >
                <Flex
                  alignItems="center"
                  justifyContent="space-between"
                  gap="spacing-2"
                  wrap
                >
                  <Flex alignItems="center" gap="spacing-2" wrap>
                    <Text variant="code-inline-1">{incident.id}</Text>
                    <Label theme="danger" size="xs">
                      {incident.priority}
                    </Label>
                    <Text variant="caption-2" color="secondary">
                      {incident.product}
                    </Text>
                  </Flex>
                  <Text
                    variant="caption-2"
                    color={overdue ? 'danger' : 'secondary'}
                  >
                    SLA: {formatDate(incident.slaDeadline)}
                    {overdue ? ' · просрочен' : ''}
                  </Text>
                </Flex>

                <Text variant="subheader-1" as="h3">
                  {incident.title}
                </Text>

                <Flex gap="spacing-3" wrap>
                  <Text variant="caption-2" color="secondary">
                    Текущая команда: {incident.team}
                  </Text>
                  <Text variant="caption-2" color="secondary">
                    Создан: {formatDate(incident.createdAt)}
                  </Text>
                </Flex>
              </Card>
            )
          })}
        </div>

        <Flex
          alignItems="center"
          justifyContent="space-between"
          gap="spacing-2"
          wrap
        >
          <Text variant="caption-2" color="secondary">
            {events.length} {eventsWord(events.length)}
          </Text>
          <Button view="action" size="l" onClick={onConfirm}>
            Увидел
          </Button>
        </Flex>
      </section>
    </Modal>
  )
}

export function CriticalAlertPinned({
  events,
  secondsLeft,
  onConfirm,
}: CriticalAlertPinnedProps) {
  return (
    <Card view="outlined" className="oncall-critical-pinned">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2">
        <Flex alignItems="center" gap="spacing-2">
          <Icon data={CircleExclamation} size={18} color="danger" />
          <Text variant="subheader-1" aria-live="polite">
            Новые критические: {events.length}
          </Text>
        </Flex>
        <Text variant="caption-2" color="secondary">
          {secondsLeft} с
        </Text>
      </Flex>

      <Text variant="caption-2" color="secondary">
        Обзор доступен ещё {secondsLeft} с. Новые события можно подтвердить
        сразу.
      </Text>

      <div className="oncall-critical-pinned__list">
        {events.map((event) => {
          const {incident} = event
          const overdue = isOverdue(incident.slaDeadline)

          return (
            <div key={event.key} className="oncall-critical-pinned__item">
              <Flex
                alignItems="center"
                justifyContent="space-between"
                gap="spacing-2"
              >
                <Text variant="code-inline-1">{incident.id}</Text>
                <Text
                  variant="caption-2"
                  color={overdue ? 'danger' : 'secondary'}
                >
                  {overdue ? 'SLA просрочен' : formatDate(incident.slaDeadline)}
                </Text>
              </Flex>
              <Text variant="body-1" ellipsis>
                {incident.title}
              </Text>
            </div>
          )
        })}
      </div>

      <Button view="action" size="m" width="max" onClick={onConfirm}>
        Увидел
      </Button>
    </Card>
  )
}
