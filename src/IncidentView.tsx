import {Chart, type ChartData} from '@gravity-ui/charts'
import {
  Button, Card, DefinitionList, Flex, Label, Link,
  Tab, TabList, TabPanel, TabProvider, Text,
} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
import {AgentInvestigation} from './AgentInvestigation'
import {Collaboration,Meeting} from './desk/CardWork'
import {useWorkspace} from './desk/context'
import {active,dueInstant,fullTime,priorityNames,standNow} from './desk/types'
import {cardTimeline} from './desk/timeline'
import {itsmLink} from './desk/itsmLink'
import {ChangeHistory} from './ChangeHistory'
import './IncidentView.css'

const impactChart: ChartData = {
  colors: ['var(--mcc-critical)'],
  legend: {enabled: false},
  xAxis: {type: 'category', categories: ['12:12', '12:17', '12:22', '12:27', '12:32', '12:37', '12:42']},
  yAxis: [{min: 75, max: 100}],
  series: {
    data: [{
      type: 'line',
      name: 'Оплаты в срок, %',
      data: [99, 99, 98, 93, 89, 84, 82].map((y, x) => ({x, y})),
    }],
  },
}

function Assignment({incident}: {incident: Incident}) {
  const {desk,now}=useWorkspace(); const due=dueInstant(incident)
  return (
    <Card className="mcc-glass incident-panel">
      <Text as="h2" variant="header-1">Назначение и срок</Text>
      <Flex direction="column" gap="spacing-1">
        <Text color="secondary">Срок решения</Text>
        <Text variant="display-2">{due===null?'Не указан':fullTime(due)+' МСК'}</Text>
        {due!==null&&!incident.restoredAt&&<Text color="secondary">{due<standNow(desk,now)?'Просрочен на ':'До срока: '}{Math.abs(Math.ceil((due-standNow(desk,now))/60000))} мин</Text>}
      </Flex>
      <DefinitionList direction="vertical">
        <DefinitionList.Item name="Продукт / сервис">{incident.product} · {incident.service||incident.title}</DefinitionList.Item>
        <DefinitionList.Item name="Тип">{incident.serviceType||(incident.key==='incident'?'Клиентский':'Нет данных')}</DefinitionList.Item>
        <DefinitionList.Item name="Влияние">{incident.impact||incident.title}</DefinitionList.Item>
        {incident.flags?.length ? <DefinitionList.Item name="Признаки">{incident.flags.join(' · ')}</DefinitionList.Item>:null}
        {incident.absent&&<DefinitionList.Item name="Свежесть">Отсутствует в последнем снимке</DefinitionList.Item>}
        <DefinitionList.Item name="Группа назначения">{incident.team}</DefinitionList.Item>
        {incident.assignee && <DefinitionList.Item name="Исполнитель">{incident.assignee}</DefinitionList.Item>}
        {incident.solution && <DefinitionList.Item name="Решение">{incident.solution}</DefinitionList.Item>}
        <DefinitionList.Item name="Владелец сервиса">{incident.key==='incident'?'Команда платежей':incident.key==='wifi-rostov'?'Сетевая поддержка · Ростов':'Нет сведений от каталога'}</DefinitionList.Item>
        <DefinitionList.Item name="Дежурный по сервису">{incident.key==='incident'?'Олег С. · платежи':incident.key==='wifi-rostov'?'Дежурный сети · Ростов':'Запросить контакт у команды'}</DefinitionList.Item>
        {incident.updatedAt&&<DefinitionList.Item name="Обновлено">{fullTime(incident.updatedAt)}</DefinitionList.Item>}
        <DefinitionList.Item name="Источник назначения">ITSM</DefinitionList.Item>
        {incident.restoredAt && <DefinitionList.Item name="Устранён">{incident.restoredAt} МСК</DefinitionList.Item>}
      </DefinitionList>
    </Card>
  )
}

function CardDetails({incident, incidents, requestedTab}: {incident: Incident; incidents:Incident[]; requestedTab: string | null}) {
  const {desk}=useWorkspace()
  const work=desk.work[incident.key]
  const isPayment = incident.key === 'incident'
  const nextStep = work?.notes.find(note => note.kind === 'Следующий шаг' && !note.done)
  const invited = work?.room?.ended ? undefined : work?.room?.members.find(member => !member.joined)
  const tab = requestedTab === 'history' || requestedTab === 'work' || requestedTab === 'room' || requestedTab === 'journal'
    ? requestedTab : 'summary'
  const hasSidebar = isPayment || tab === 'history'
  function setTab(value: string) {
    const href = '#incident/' + incident.key + (value === 'summary' ? '' : '?tab=' + value)
    window.history.replaceState(window.history.state, '', href)
    window.dispatchEvent(new Event('hashchange'))
  }
  const events = tab==='journal'?cardTimeline(desk,incident):[]

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
            {isPayment ? <Flex direction="column" gap="spacing-4">
              <Card className="mcc-glass incident-panel">
                <Flex justifyContent="space-between" alignItems="center" wrap gap="spacing-2">
                  <Text as="h2" variant="header-1">Влияние на клиентов</Text>
                  <Text color="secondary" variant="caption-2">{work?.telemetryOffline?'Последний доступный замер · источник недоступен':'Измерения 12:12–12:42'}</Text>
                </Flex>
                <div>
                  <Text as="p" color="secondary">Заказы с подтверждённой вовремя оплатой</Text>
                  <Flex alignItems="baseline" gap="spacing-3" wrap>
                    <Text variant="display-3">82%</Text>
                    <Label theme="warning">−17 п. п.</Label><Text color="secondary">обычно 99%</Text>
                  </Flex>
                </div>
                <div className="incident-impact-chart" role="img" aria-label="С 12:12 до 12:42 доля своевременных оплат снизилась с 99 до 82 процентов">
                  <Chart data={impactChart}/>
                </div>
                <Text color="secondary">За последнюю минуту 82 из 100 заказов получили подтверждение оплаты за 30 секунд.</Text>
              </Card>
            </Flex> : <Assignment incident={incident}/>}
            {(isPayment || nextStep) && <Card className="mcc-glass incident-panel incident-next-step">
              <Text color="secondary" variant="caption-2">Следующий шаг</Text>
              <Text as="h2" variant="header-1">{nextStep?.text ?? (invited ? 'Уточнить участие: ' + invited.role : 'Согласовать следующее действие')}</Text>
              {nextStep ? <Text>Ответственный: {nextStep.owner}{nextStep.due ? ' · к ' + nextStep.due + ' МСК' : ''}</Text>
                : invited && <Text>Приглашение в {invited.invited} · {invited.delivery.toLowerCase()}. Подключение пока не зафиксировано.</Text>}
              <Button view="outlined" onClick={() => setTab(!nextStep && invited ? 'room' : 'work')}>
                {!nextStep && invited ? 'Посмотреть участников' : 'Перейти к работе смены'}
              </Button>
            </Card>}
          </TabPanel>
          <TabPanel value="history"><ChangeHistory incident={incident}/></TabPanel>
          <TabPanel value="journal">
            <Card className="mcc-glass incident-panel">
              <Text as="h2" variant="header-1">Журнал инцидента</Text>
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
  const {act,busy,desk}=useWorkspace()
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
            <Link href={'/incidents/'+encodeURIComponent(incident.id)+'?source='+desk.mode} title="Постоянная ссылка на карточку">{incident.id}</Link>
            <Label theme={incident.priority === 4 && active(incident) ? 'danger' : 'normal'}>
              {incident.priority === 4 && active(incident) ? 'Критический' : priorityNames[incident.priority - 1] + ' приоритет'}
            </Label>
            <Label>{incident.state}</Label>
          </Flex>
          <Text as="h1" variant="display-2">{incident.title}</Text>
          <Text color="secondary">{incident.product} · Зарегистрирован в {incident.registered} МСК</Text>
        </Flex>
        <Flex gap="spacing-2" wrap><Link {...itsmLink(incident.id, incident.key, import.meta.env.VITE_ITSC_URL)}>Открыть в ITSM</Link><Button size="l" view="action" disabled={busy} onClick={async()=>{await act({type:'analyze',key:incident.key});window.location.hash=`investigation/${incident.key}${suffix}`}}>Разобрать причину агентом</Button></Flex>
      </Flex>
      <CardDetails incidents={incidents} incident={incident} requestedTab={tab}/>
    </Flex>
  )
}
