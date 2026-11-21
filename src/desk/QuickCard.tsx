import {Button, Drawer, Flex, Label, Link, Text} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace, useRelated} from './context'
import {active, fullTime, dueInstant, priorityNames} from './types'
export function QuickCard({item, back}: {item: Incident; back: string}) {
  const related = useRelated(item)
  const {desk, mode, act, busy} = useWorkspace(),
    due = dueInstant(item)
  return (
    <Drawer
      placement="right"
      open
      onOpenChange={(open) => {
        if (!open) window.location.hash = back
      }}
    >
      <section className="quick-card" aria-label="Быстрый просмотр инцидента">
        <Flex justifyContent="space-between" alignItems="center" gap="spacing-3">
          <Text variant="code-1">{item.id}</Text>
          <Button
            view="flat"
            aria-label="Закрыть быстрый просмотр"
            onClick={() => {
              window.location.hash = back
            }}
          >
            Закрыть
          </Button>
        </Flex>
        <Label theme={item.priority === 4 && active(item) ? 'danger' : 'normal'}>{priorityNames[item.priority - 1] ?? item.priority} приоритет</Label>
        <Text as="h2" variant="header-2">
          {item.title}
        </Text>
        {item.absent && <Text color="secondary">Отсутствует в последнем снимке</Text>}
        <dl className="quick-fields">
          {[
            ['Продукт', item.product],
            ['Сервис', item.service || 'Не указан'],
            ['Статус', item.state],
            ['Назначение', item.team || 'Не назначена'],
            ['Исполнитель', item.assignee || 'Не указан'],
            ['Срок', due === null ? 'Не указан' : fullTime(due)],
            ['Регистрация', item.registeredAt != null ? fullTime(item.registeredAt) : item.registered],
            ...(item.updatedAt != null ? [['Обновлено', fullTime(item.updatedAt)]] : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <Button
          view="action"
          href={
            mode === 'api'
              ? '/incidents/' + encodeURIComponent(item.id)
              : '#incident/' + item.key
          }
        >
          Полная карточка
        </Button>
        {mode !== 'api' && (
          <>
            <Button
              disabled={busy}
              onClick={async () => {
                await act({type: 'analyze', key: item.key})
                location.hash = 'investigation/' + item.key
              }}
            >
              Разобрать причину агентом
            </Button>
            <Link href={'#incident/' + item.key + '?tab=history'}>История изменений</Link>
            <Link href={'#itsm/' + item.key}>Открыть в ITSM</Link>
            {related.length > 0 && (
              <Link href={'#incident/' + item.key + '?tab=work'}>
                Похожие случаи: {related.length} · проверить связь →
              </Link>
            )}
            {desk.work[item.key]?.links.length ? (
              <Text>Подтверждённых связей: {desk.work[item.key].links.length}</Text>
            ) : null}
          </>
        )}
      </section>
    </Drawer>
  )
}
