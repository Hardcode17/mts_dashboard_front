import {Button, Drawer, Flex, Label, Link, Text} from '@gravity-ui/uikit'
import type {Incident} from './types'
import {InvestigationAction} from '../InvestigationAction'
import {cardCoordination, groupHref} from '../control-room/attention'
import {useRelated, useWorkspace} from './context'
import {IncidentDeadline} from './IncidentDeadline'
import {itsmLink} from './itsmLink'
import {useOfficialIncident} from '../features/incidents/model/useOfficialIncident'
import {usesRealBackend} from '../shared/api/mode'
import {active, externalHttpAddress, priorityNames} from './types'
import '../IncidentView.css'

export function QuickCard({item: record, back}: {item: Incident; back: string}) {
  const {incident: item, error, retry} = useOfficialIncident(record)
  const {desk, act, busy, person, now, itsmExternal} = useWorkspace()
  const {group, ownerLabel} = cardCoordination(desk, item)
  const others = useRelated(item, group?.members)
  const pending = desk.tasks.find((t) => t.key === item.key && !t.finished)?.attempts.at(-1)
  const canAccept =
    pending?.person === person &&
    !pending.ended &&
    !pending.accepted &&
    (pending.deadline === null || pending.deadline > now)
  const card = '#incident/' + encodeURIComponent(item.key)
  const external = externalHttpAddress(item.itsmUrl) ?? externalHttpAddress(itsmLink(item.id, item.key, import.meta.env.VITE_ITSC_URL).href)

  return (
    <Drawer
      open
      placement="right"
      size="auto"
      contentClassName="incident-peek-panel"
      contentOverflow="auto"
      disableTransition
      aria-labelledby="peek-title"
      onOpenChange={(open) => {
        if (!open) window.location.hash = back
      }}
    >
      <section className="quick-card incident-peek" aria-label="Быстрый просмотр инцидента">
        <Flex justifyContent="space-between" alignItems="center" gap="spacing-3">
          <Text variant="code-1">{item.id}</Text>
          <Button
            size="s"
            view="flat"
            aria-label="Закрыть быстрый просмотр"
            onClick={() => {
              window.location.hash = back
            }}
          >
            Закрыть
          </Button>
        </Flex>
        <div className="incident-peek-identity">
          <Text as="p" color="secondary">
            {item.product}
          </Text>
          <Text as="h2" id="peek-title" variant="header-2">
            {item.title || item.id}
          </Text>
          <Flex gap="spacing-2" wrap>
            <Label theme={item.priority === 4 && active(item) ? 'danger' : 'normal'}>
              {item.priority === 4 && active(item)
                ? 'Критический'
                : (priorityNames[item.priority - 1] ?? item.priority) + ' приоритет'}
            </Label>
            <Label>ITSM · {item.state}</Label>
          </Flex>
          {item.absent && <Text color="secondary">Отсутствует в последнем снимке</Text>}
        </div>
        {error && <Flex direction="column" gap="spacing-2">
          <Text role="alert" color="danger">Не удалось обновить карточку ITSM. {error}</Text>
          <Button onClick={retry}>Повторить загрузку карточки</Button>
        </Flex>}
        <IncidentDeadline incident={item} />
        <dl className="incident-brief-facts">
          <div>
            <dt>Координатор смены</dt>
            <dd>
              <strong>{ownerLabel}</strong>
            </dd>
          </div>
          <div>
            <dt>Группа ITSM</dt>
            <dd>{item.team || 'Не назначена'}</dd>
          </div>
          <div>
            <dt>Исполнитель ITSM</dt>
            <dd>{item.assignee || 'Не назначен'}</dd>
          </div>
        </dl>
        <div className="incident-peek-actions">
          {canAccept && (
            <Button
              size="l"
              view="action"
              disabled={busy}
              onClick={() => void act({type: 'accept', key: item.key, person, id: pending.id})}
            >
              {group && group.method !== 'single' ? 'Принять задачу по INC' : 'Принять в работу'}
            </Button>
          )}
          <InvestigationAction incident={item} size="l" view={canAccept ? 'outlined' : 'action'} />
          {!canAccept && (
            <Button size="l" view="outlined" href={card}>
              Полная карточка
            </Button>
          )}
        </div>
        <nav className="incident-peek-nav" aria-labelledby="peek-materials">
          <Text as="h3" id="peek-materials" variant="subheader-1">
            Связанные материалы
          </Text>
          {canAccept && <Link href={card}>Полная карточка</Link>}
          <Link href={card + '?tab=timeline'}>Хронология</Link>
          {(usesRealBackend || others.length > 0) && (
            <Link href={card + '?section=related'}>
              {usesRealBackend ? 'Похожие случаи в ITSM' : (group && group.method !== 'single' ? 'Похожие случаи вне ситуации' : 'Похожие случаи') + ' · ' + others.length}
            </Link>
          )}
          {group && <Link href={groupHref(group.id)}>Ситуация смены · {group.members.length} INC</Link>}
          <Link href={'#itsm/' + encodeURIComponent(item.key)}>
            {itsmExternal ? 'Изменить в ITSM' : 'Изменить в ITSM · стенд'}
          </Link>
          {external && (
            <Link href={external} target="_blank" rel="noreferrer">
              {item.itsmDemo ? 'Карточка ITSM · стенд ↗' : 'Карточка ITSM ↗'}
            </Link>
          )}
        </nav>
      </section>
    </Drawer>
  )
}
