import {
  Button, Card, DefinitionList, Flex, Label, Link,
  Tab, TabList, TabPanel, TabProvider, Text,
} from '@gravity-ui/uikit'
import type {Incident} from './desk/types'
import {AgentInvestigation} from './AgentInvestigation'
import {Collaboration,Meeting} from './desk/CardWork'
import {OfficialAssignment} from './desk/OfficialAssignment'
import {useWorkspace} from './desk/context'
import {active,dueInstant,fullTime,priorityNames,standNow} from './desk/types'
import {cardTimeline} from './desk/timeline'
import {itsmLink} from './desk/itsmLink'
import {ChangeHistory} from './ChangeHistory'
import {useIncidentHistory} from './features/incidents/model/useIncidentHistory'
import {IncidentRelationships} from './features/incidents/ui/IncidentRelationships'
import './IncidentView.css'

function Assignment({incident}: {incident: Incident}) {
  const {desk,mode,now}=useWorkspace()
  const due=dueInstant(incident)
  const apiDeadline = mode === 'api'
  const minutes = apiDeadline
    ? incident.remainingSeconds == null ? null : Math.ceil(Math.abs(incident.remainingSeconds) / 60)
    : due === null ? null : Math.ceil(Math.abs(due - standNow(desk, now)) / 60000)
  const overdue = apiDeadline ? incident.overdue : due !== null && due < standNow(desk, now)
  return (
    <Card className="mcc-glass incident-panel">
      <Text as="h2" variant="header-1">Назначение и срок</Text>
      <Flex direction="column" gap="spacing-1">
        <Text color="secondary">Срок решения</Text>
        <Text variant="display-2">{due===null?'Не указан':fullTime(due)+' МСК'}</Text>
        {minutes !== null && !incident.restoredAt && <Text color="secondary">{overdue ? 'Просрочен на ' : 'До срока: '}{minutes} мин</Text>}
      </Flex>
      <DefinitionList direction="vertical">
        <DefinitionList.Item name="Продукт / сервис">{incident.product} · {incident.service || 'Сервис не указан'}</DefinitionList.Item>
        <DefinitionList.Item name="Тип">{incident.serviceType || 'Нет данных'}</DefinitionList.Item>
        {incident.impact && <DefinitionList.Item name="Влияние">{incident.impact}</DefinitionList.Item>}
        {incident.flags?.length ? <DefinitionList.Item name="Признаки">{incident.flags.join(' · ')}</DefinitionList.Item>:null}
        {incident.absent&&<DefinitionList.Item name="Свежесть">Отсутствует в последнем снимке</DefinitionList.Item>}
        <DefinitionList.Item name="Группа назначения">{incident.team}</DefinitionList.Item>
        {incident.assignee && <DefinitionList.Item name="Исполнитель">{incident.assignee}</DefinitionList.Item>}
        {incident.solution && <DefinitionList.Item name="Решение">{incident.solution}</DefinitionList.Item>}
        {incident.updatedAt&&<DefinitionList.Item name="Обновлено">{fullTime(incident.updatedAt)}</DefinitionList.Item>}
        <DefinitionList.Item name="Источник назначения">ITSM</DefinitionList.Item>
        {incident.restoredAt && <DefinitionList.Item name="Устранён">{incident.restoredAt} МСК</DefinitionList.Item>}
      </DefinitionList>
      {(!apiDeadline || incident.itsmUrl) && <OfficialAssignment incident={incident}/>}
    </Card>
  )
}

function CardDetails({incident, incidents, requestedTab}: {incident: Incident; incidents:Incident[]; requestedTab: string | null}) {
  const {desk,mode}=useWorkspace()
  const work=desk.work[incident.key]
  const nextStep = work?.notes.find(note => note.kind === 'Следующий шаг' && !note.done)
  const invited = work?.room?.ended ? undefined : work?.room?.members.find(member => !member.joined)
  const tab = requestedTab === 'history' || requestedTab === 'work' || requestedTab === 'room' || requestedTab === 'journal'
    ? requestedTab : 'summary'
  const history = useIncidentHistory(mode === 'api' && (tab === 'history' || tab === 'journal') ? incident.id : undefined, desk.version)
  const hasSidebar = tab === 'history'
  function setTab(value: string) {
    const href = '#incident/' + incident.key + (value === 'summary' ? '' : '?tab=' + value)
    window.history.replaceState(window.history.state, '', href)
    window.dispatchEvent(new Event('hashchange'))
  }
  const events = tab === 'journal' ? cardTimeline(desk, incident, mode === 'api' ? history.events : undefined) : []

  return (
    <TabProvider value={tab} onUpdate={setTab}>
      <TabList size="l" aria-label="Разделы инцидента" className="incident-tabs">
        <Tab value="summary">Сводка</Tab>
        <Tab value="history">История изменений</Tab>
        <Tab value="journal">Журнал</Tab>
        <Tab value="room">Аварийная комната</Tab><Tab value="work">Работа смены</Tab>
      </TabList>
      <div className={tab==='work' || !hasSidebar?'desk-stack':'incident-columns'}>
        <div className="incident-tab-area">
          <TabPanel value="summary">
            <Assignment incident={incident}/>
            {(nextStep || invited) && <Card className="mcc-glass incident-panel incident-next-step">
              <Text color="secondary" variant="caption-2">Следующий шаг</Text>
              <Text as="h2" variant="header-1">{nextStep?.text ?? (invited ? 'Уточнить участие: ' + invited.role : 'Согласовать следующее действие')}</Text>
              {nextStep ? <Text>Ответственный: {nextStep.owner}{nextStep.due ? ' · к ' + nextStep.due + ' МСК' : ''}</Text>
                : invited && <Text>Приглашение в {invited.invited} · {invited.delivery.toLowerCase()}. Подключение пока не зафиксировано.</Text>}
              <Button view="outlined" onClick={() => setTab(!nextStep && invited ? 'room' : 'work')}>
                {!nextStep && invited ? 'Посмотреть участников' : 'Перейти к работе смены'}
              </Button>
            </Card>}
          </TabPanel>
          <TabPanel value="history"><ChangeHistory incident={incident} history={history}/></TabPanel>
          <TabPanel value="journal">
            <Card className="mcc-glass incident-panel">
              <Text as="h2" variant="header-1">Журнал инцидента</Text>
              {history.status === 'loading' && <Text role="status" color="secondary">Загружаем журнал…</Text>}
              {history.status === 'error' && <Text role="status" color="secondary">{history.error}</Text>}
              <ol className="incident-list">
                {events.map((event,index) => (
                  <li key={event.at+'-'+index} className="incident-journal-row">
                    <Text color="secondary">{fullTime(event.at)}</Text>
                    <Flex direction="column" gap="spacing-1"><Text variant="subheader-1">{event.text}</Text><Text color="secondary" variant="caption-2">{event.source}</Text></Flex>
                  </li>
                ))}
              </ol>
            </Card>
          </TabPanel>
          <TabPanel value="room"><Meeting item={incident}/></TabPanel>
          <TabPanel value="work"><Collaboration item={incident} incidents={incidents}/></TabPanel>
        </div>
        {tab!=='work'&&hasSidebar && <Assignment incident={incident}/>}
      </div>
    </TabProvider>
  )
}

export function IncidentView({incident, incidents, investigating, backHref, tab}: {incident: Incident; incidents:Incident[]; investigating: boolean; backHref: string; tab: string | null}) {
  const {desk,mode}=useWorkspace()
  const suffix = tab ? '?tab=' + encodeURIComponent(tab) : ''
  const backTitle = backHref.startsWith('#events') ? 'К журналу событий' : backHref.startsWith('#wall') ? 'На общий экран'
    : backHref.startsWith('#desk/') ? 'К моей смене' : backHref.startsWith('#overview') ? 'К сводке смены' : 'К очереди'
  if (investigating) return <AgentInvestigation incident={incident} cardHref={'#incident/' + incident.key + suffix}/>
  return (
    <Flex direction="column" gap="spacing-5" className="incident-view">
      <Link href={backHref}>← {backTitle}</Link>
      <Flex justifyContent="space-between" alignItems="center" gap="spacing-4" wrap>
        <Flex direction="column" gap="spacing-2">
          <Flex gap="spacing-2" alignItems="center" wrap>
            <Link href={'/incidents/'+encodeURIComponent(incident.id)+'?source='+(mode === 'api' ? mode : desk.mode)} title="Постоянная ссылка на карточку">{incident.id}</Link>
            <Label theme={incident.priority === 4 && active(incident) ? 'danger' : 'normal'}>
              {incident.priority === 4 && active(incident) ? 'Критический' : priorityNames[incident.priority - 1] + ' приоритет'}
            </Label>
            <Label>{incident.state}</Label>
          </Flex>
          <Text as="h1" variant="display-2">{incident.title || incident.id}</Text>
          <Text color="secondary">{incident.product} · Зарегистрирован в {incident.registered} МСК</Text>
        </Flex>
        <Flex gap="spacing-2" wrap>
          {mode === 'api'
            ? incident.itsmUrl && <Link href={incident.itsmUrl} target="_blank" rel="noopener noreferrer">Открыть в ITSM</Link>
            : <Link {...itsmLink(incident.id, incident.key, import.meta.env.VITE_ITSC_URL)}>Открыть в ITSM</Link>}
          <Button size="l" view="action" href={'#investigation/'+incident.key+suffix}>Открыть расследование</Button>
        </Flex>
      </Flex>
      <CardDetails incidents={incidents} incident={incident} requestedTab={tab}/>
      <IncidentRelationships key={incident.id} incidentId={incident.id} source={mode === 'api' ? undefined : desk.mode}/>
    </Flex>
  )
}
