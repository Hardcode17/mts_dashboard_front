import {useEffect, useRef} from 'react'
import {Chart, type ChartData} from '@gravity-ui/charts'
import {Button, Card, Flex, Label, Link, Tab, TabList, TabPanel, TabProvider, Text} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
import {AgentInvestigation} from './AgentInvestigation'
import {IncidentChronology} from './ChangeHistory'
import {InvestigationAction} from './InvestigationAction'
import {cardCoordination, groupHref} from './control-room/attention'
import {Collaboration} from './desk/CardWork'
import {IncidentDeadline} from './desk/IncidentDeadline'
import {useWorkspace} from './desk/context'
import {selectedQueue} from './desk/queueNavigation'
import {active, externalHttpAddress, fullTime, priorityNames, standNow} from './desk/types'
import './IncidentView.css'

const impactChart: ChartData = {
  colors: ['var(--mcc-critical)'],
  legend: {enabled: false},
  xAxis: {type: 'category', categories: ['12:12', '12:17', '12:22', '12:27', '12:32', '12:37', '12:42']},
  yAxis: [{min: 75, max: 100}],
  series: {
    data: [
      {
        type: 'line',
        name: 'Оплаты в срок, %',
        data: [99, 99, 98, 93, 89, 84, 82].map((y, x) => ({x, y})),
      },
    ],
  },
}

function Assignment({
  incident,
  focusRoom,
  hasNextStep,
}: {
  incident: Incident
  focusRoom: boolean
  hasNextStep: boolean
}) {
  const {desk} = useWorkspace()
  const {group, ownerLabel} = cardCoordination(desk, incident)
  const meeting = externalHttpAddress(incident.meetingUrl)
  const externalCard = externalHttpAddress(incident.itsmUrl)
  const demoRoom = desk.work[incident.key]?.room
  const roomRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusRoom) roomRow.current?.focus()
  }, [focusRoom, incident.key])
  const payment = incident.key === 'incident'
  const wifi = incident.key === 'wifi-rostov'
  return (
    <Card className="incident-brief ops-assignment" view="outlined" aria-label="Назначение и срок">
      <IncidentDeadline incident={incident} />
      <dl className="incident-brief-facts">
        <div>
          <dt>Координатор смены</dt>
          <dd>
            <strong>{ownerLabel}</strong>
          </dd>
        </div>
        <div>
          <dt>Группа ITSM</dt>
          <dd>{incident.team || 'Не назначена'}</dd>
        </div>
        <div>
          <dt>Исполнитель ITSM</dt>
          <dd>{incident.assignee || 'Не назначен'}</dd>
        </div>
        <div ref={roomRow} tabIndex={-1}>
          <dt>Аварийная комната</dt>
          <dd>
            {meeting ? (
              <Link href={meeting} target="_blank" rel="noreferrer">
                Открыть встречу ↗
              </Link>
            ) : demoRoom ? (
              <Link href={'#meeting/' + encodeURIComponent(incident.key)}>Демовстреча</Link>
            ) : (
              <Text color="secondary">Ссылка пока не получена</Text>
            )}
          </dd>
        </div>
        {group && (
          <div>
            <dt>Ситуация смены</dt>
            <dd>
              <Link href={groupHref(group.id)}>
                {group.members.length > 1
                  ? group.title + ' · ' + group.members.length + ' INC'
                  : 'Открыть ситуацию'}
              </Link>
            </dd>
          </div>
        )}
        {active(incident) && !hasNextStep && (
          <div>
            <dt>Следующий шаг</dt>
            <dd>
              <Text color="secondary">Не задан</Text> ·{' '}
              <Link href={'#incident/' + encodeURIComponent(incident.key) + '?section=notes&kind=next'}>
                Указать шаг
              </Link>
            </dd>
          </div>
        )}
        {incident.solution && (
          <div>
            <dt>Решение</dt>
            <dd>{incident.solution}</dd>
          </div>
        )}
      </dl>
      <details className="incident-source-details">
        <summary>Сведения из источника</summary>
        <dl className="incident-brief-facts">
          <div>
            <dt>Продукт</dt>
            <dd>{incident.product}</dd>
          </div>
          <div>
            <dt>Сервис</dt>
            <dd>{incident.service || 'Не указан'}</dd>
          </div>
          <div>
            <dt>Тип сервиса</dt>
            <dd>{incident.serviceType || (payment ? 'Клиентский' : 'Не указан')}</dd>
          </div>
          {incident.impact && incident.impact !== incident.title && (
            <div>
              <dt>Влияние</dt>
              <dd>{incident.impact}</dd>
            </div>
          )}
          {incident.description &&
            incident.description !== incident.title &&
            incident.description !== incident.impact && (
              <div>
                <dt>Описание</dt>
                <dd>{incident.description}</dd>
              </div>
            )}
          {incident.flags?.length ? (
            <div>
              <dt>Признаки</dt>
              <dd>{incident.flags.join(' · ')}</dd>
            </div>
          ) : null}
          <div>
            <dt>Владелец сервиса</dt>
            <dd>{payment ? 'Команда платежей' : wifi ? 'Сетевая поддержка · Ростов' : 'Нет сведений'}</dd>
          </div>
          <div>
            <dt>Дежурный по сервису</dt>
            <dd>{payment ? 'Олег С. · платежи' : wifi ? 'Дежурный сети · Ростов' : 'Не указан'}</dd>
          </div>
          <div>
            <dt>Зарегистрирован</dt>
            <dd>
              {incident.registeredAt != null ? fullTime(incident.registeredAt) : incident.registered} МСК
            </dd>
          </div>
          {incident.updatedAt != null && (
            <div>
              <dt>Получено пультом</dt>
              <dd>{fullTime(standNow(desk, incident.updatedAt))} МСК</dd>
            </div>
          )}
          {externalCard && (
            <div>
              <dt>Первоисточник</dt>
              <dd>
                <Link href={externalCard} target="_blank" rel="noreferrer">
                  {incident.itsmDemo ? 'Карточка ITSM · стенд ↗' : 'Карточка ITSM ↗'}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </details>
    </Card>
  )
}

function PaymentImpact({offline}: {offline?: boolean}) {
  return (
    <Card className="mcc-glass incident-panel" aria-label="Влияние на клиентов">
      <Flex justifyContent="space-between" alignItems="center" wrap gap="spacing-2">
        <Text as="h2" variant="header-1">
          Влияние на клиентов
        </Text>
        <Text color="secondary" variant="caption-2">
          {offline ? 'Последний доступный замер · источник недоступен' : 'Измерения 12:12–12:42'}
        </Text>
      </Flex>
      <div>
        <Text as="p" color="secondary">
          Заказы с подтверждённой вовремя оплатой
        </Text>
        <Flex alignItems="baseline" gap="spacing-3" wrap>
          <Text variant="display-3">82%</Text>
          <Label theme="warning">−17 п. п.</Label>
          <Text color="secondary">обычно 99%</Text>
        </Flex>
      </div>
      <div
        className="incident-impact-chart"
        role="img"
        aria-label="С 12:12 до 12:42 доля своевременных оплат снизилась с 99 до 82 процентов"
      >
        <Chart data={impactChart} />
      </div>
    </Card>
  )
}

function CardDetails({
  incident,
  incidents,
  query,
}: {
  incident: Incident
  incidents: Incident[]
  query: URLSearchParams
}) {
  const {desk} = useWorkspace()
  const requested = query.get('tab')
  const timeline = requested === 'timeline' || requested === 'history' || requested === 'journal'
  const section = query.get('section') ?? (requested === 'work' ? 'notes' : undefined)
  const workActions = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (timeline || !section) return
    if (section === 'handover') {
      history.replaceState(history.state, '', '#desk/handover?incident=' + encodeURIComponent(incident.key))
      window.dispatchEvent(new Event('hashchange'))
      return
    }
    const panel = workActions.current?.querySelector<HTMLElement>('[id^="work-"][tabindex="-1"]')
    panel?.focus({preventScroll: true})
    panel?.scrollIntoView({block: 'start'})
  }, [incident.key, section, timeline])
  const work = desk.work[incident.key]
  const next = work?.notes.find((note) => note.kind === 'Следующий шаг' && !note.done)
  const path = '#incident/' + encodeURIComponent(incident.key)
  function setTab(value: string) {
    const href = path + (value === 'timeline' ? '?tab=timeline' : '')
    window.history.replaceState(window.history.state, '', href)
    window.dispatchEvent(new Event('hashchange'))
  }
  return (
    <TabProvider value={timeline ? 'timeline' : 'summary'} onUpdate={setTab}>
      <TabList size="l" aria-label="Разделы инцидента" className="incident-tabs">
        <Tab value="summary">Обзор</Tab>
        <Tab value="timeline">Хронология</Tab>
      </TabList>
      <TabPanel value="summary">
        <div className="incident-overview-stack">
          <Assignment incident={incident} focusRoom={requested === 'room'} hasNextStep={Boolean(next)} />
          {next && (
            <Card view="outlined" className="mcc-glass incident-panel incident-step">
              <Text color="secondary" variant="body-1">
                Следующий шаг
              </Text>
              <Text as="h2" variant="header-1">
                {next.text}
              </Text>
              <Flex alignItems="center" gap="spacing-3" wrap>
                <Text>{next.owner || 'Ответственный не указан'}</Text>
                <Text color="secondary">{next.due ? 'К ' + next.due + ' МСК' : 'Срок шага не указан'}</Text>
                <Link href={path + '?section=notes'}>Открыть заметки</Link>
              </Flex>
            </Card>
          )}
          {incident.key === 'incident' && <PaymentImpact offline={work?.telemetryOffline} />}
          <div ref={workActions}>
            <Collaboration item={incident} incidents={incidents} section={section} />
          </div>
        </div>
      </TabPanel>
      <TabPanel value="timeline">
        {timeline && (
          <IncidentChronology
            incident={incident}
            compareOpen={requested === 'history' || query.has('compare')}
            focusEvent={query.get('event') ?? undefined}
          />
        )}
      </TabPanel>
    </TabProvider>
  )
}

export function IncidentView({
  incident,
  incidents,
  investigating,
  backHref,
  tab,
}: {
  incident: Incident
  incidents: Incident[]
  investigating: boolean
  backHref: string
  tab: string | null
}) {
  const {desk, itsmExternal} = useWorkspace()
  const query = new URLSearchParams(window.location.hash.split('?')[1])
  const path = '#incident/' + encodeURIComponent(incident.key)
  if (investigating)
    return (
      <AgentInvestigation
        incident={incident}
        cardHref={path + (tab ? '?tab=' + encodeURIComponent(tab) : '')}
      />
    )
  const fromGroup = backHref.startsWith('#attention')
  const backTitle = fromGroup
    ? new URLSearchParams(backHref.split('?')[1]).has('group')
      ? 'К составу группы'
      : 'К ситуациям смены'
    : backHref.startsWith('#events')
      ? 'К журналу смены'
      : backHref.startsWith('#wall')
        ? 'На общий экран'
        : backHref.startsWith('#desk/')
          ? 'К моей смене'
          : backHref.startsWith('#overview') && !selectedQueue(backHref)
            ? 'К сводке смены'
            : 'К очереди'
  return (
    <div className="incident-view incident-case">
      <Link href={backHref}>← {backTitle}</Link>
      <header className="incident-case-head">
        <div className="incident-case-identity">
          <Flex gap="spacing-2" alignItems="center" wrap>
            <Link
              href={'/incidents/' + encodeURIComponent(incident.id) + '?source=' + desk.mode}
              title="Постоянная ссылка на карточку"
            >
              {incident.id}
            </Link>
            <Text color="secondary">{incident.product}</Text>
          </Flex>
          <Text as="h1" variant="display-2">
            {incident.title}
          </Text>
          <Flex gap="spacing-2" alignItems="center" wrap>
            <Label theme={incident.priority === 4 && active(incident) ? 'danger' : 'normal'}>
              {incident.priority === 4 && active(incident)
                ? 'Критический'
                : (priorityNames[incident.priority - 1] ?? incident.priority) + ' приоритет'}
            </Label>
            <Label>ITSM · {incident.state}</Label>
            {incident.absent && <Text color="secondary">Отсутствует в последнем снимке</Text>}
          </Flex>
        </div>
        <Flex className="incident-case-actions" gap="spacing-2" wrap>
          <InvestigationAction incident={incident} size="l" />
          <Button href={'#itsm/' + encodeURIComponent(incident.key)} size="l" view="outlined">
            {itsmExternal ? 'Изменить в ITSM' : 'Изменить в ITSM · стенд'}
          </Button>
        </Flex>
      </header>
      <CardDetails incident={incident} incidents={incidents} query={query} />
    </div>
  )
}
