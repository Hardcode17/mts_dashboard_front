import {useState} from 'react'
import {Chart, type ChartData} from '@gravity-ui/charts'
import {
  Button, Card, DefinitionList, Disclosure, Flex, Label, Link,
  Tab, TabList, TabPanel, TabProvider, Text,
} from '@gravity-ui/uikit'
import type {Incident} from './demoData'
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
  return (
    <Card className="mcc-glass incident-panel">
      <Text as="h2" variant="header-1">Назначение и срок</Text>
      <Flex direction="column" gap="spacing-1">
        <Text color="secondary">Срок решения</Text>
        <Text variant="display-2">{incident.due ? `${incident.due} МСК` : 'Не указан'}</Text>
        {incident.key === 'incident' && <Text color="secondary">28 минут до срока</Text>}
      </Flex>
      <DefinitionList direction="vertical">
        <DefinitionList.Item name="Группа назначения">{incident.team}</DefinitionList.Item>
        {incident.key === 'incident' && <DefinitionList.Item name="Владелец сервиса">Команда платежей</DefinitionList.Item>}
        <DefinitionList.Item name="Источник назначения">ITSM</DefinitionList.Item>
        {incident.restoredAt && <DefinitionList.Item name="Устранён">{incident.restoredAt} МСК</DefinitionList.Item>}
      </DefinitionList>
    </Card>
  )
}

const participants = [
  {name: 'Координатор смены', note: 'Открыл встречу в 12:26', connected: true},
  {name: 'Дежурный команды платежей', note: 'Подключился в 12:30', connected: true},
  {name: 'Дежурный сети', note: 'Приглашение доставлено в 12:38', connected: false},
]

function PaymentDetail({incident}: {incident: Incident}) {
  const [tab, setTab] = useState('summary')
  const events = [
    {time: '12:42', title: 'Доля своевременных оплат — 82%', source: 'Мониторинг продукта'},
    {time: '12:38', title: 'Дежурному сети доставлено приглашение', source: 'Emergency Room'},
    {time: incident.assignedAt, title: 'Инцидент назначен на координаторов', source: 'ITSM'},
    {time: '12:30', title: 'Дежурный команды платежей подключился к звонку', source: 'МТС Линк'},
    {time: incident.registered, title: 'Зарегистрирован критический инцидент', source: 'ITSM'},
  ].filter(event => event.time).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))

  return (
    <TabProvider value={tab} onUpdate={setTab}>
      <TabList size="l" aria-label="Разделы инцидента">
        <Tab value="summary">Сводка</Tab><Tab value="journal">Журнал</Tab><Tab value="room">Аварийная комната</Tab>
      </TabList>
      <div className="incident-columns">
        <div className="incident-tab-area">
          <TabPanel value="summary">
            <Flex direction="column" gap="spacing-4">
              <Card className="mcc-glass incident-panel">
                <Flex justifyContent="space-between" alignItems="center" wrap gap="spacing-2">
                  <Text as="h2" variant="header-1">Влияние на клиентов</Text>
                  <Text color="secondary" variant="caption-2">Последние 30 минут</Text>
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
              <Card className="mcc-glass incident-panel">
                <Text color="secondary" variant="caption-2">Следующий шаг</Text>
                <Text as="h2" variant="header-1">Получить ответ дежурного сети</Text>
                <Text>Команда платежей проверяет задержку между сервисом оплаты и БД. Дежурного сети пригласили на встречу в 12:38.</Text>
                <Button view="outlined" onClick={() => setTab('room')}>Посмотреть участников</Button>
              </Card>
            </Flex>
          </TabPanel>
          <TabPanel value="journal">
            <Card className="mcc-glass incident-panel">
              <Text as="h2" variant="header-1">Журнал инцидента</Text>
              <ol className="incident-list">
                {events.map(event => (
                  <li key={event.title} className="incident-journal-row">
                    <Text color="secondary">{event.time}</Text>
                    <Flex direction="column" gap="spacing-1"><Text variant="subheader-1">{event.title}</Text><Text color="secondary" variant="caption-2">{event.source}</Text></Flex>
                  </li>
                ))}
              </ol>
            </Card>
          </TabPanel>
          <TabPanel value="room">
            <Card className="mcc-glass incident-panel">
              <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap><Text as="h2" variant="header-1">Аварийная комната</Text><Label theme="success">Идёт встреча</Label></Flex>
              <Text color="secondary">МТС Линк · данные на 12:42 МСК</Text>
              <ul className="incident-list">
                {participants.map(person => (
                  <li className="incident-person" key={person.name}>
                    <Flex direction="column" gap="spacing-1"><Text variant="subheader-1">{person.name}</Text><Text color="secondary" variant="caption-2">{person.note}</Text></Flex>
                    <Label theme={person.connected ? 'success' : 'warning'}>{person.connected ? 'В звонке' : 'Ожидаем входа'}</Label>
                  </li>
                ))}
              </ul>
            </Card>
          </TabPanel>
        </div>
        <Assignment incident={incident}/>
      </div>
    </TabProvider>
  )
}

function Investigation({incident}: {incident: Incident}) {
  const [result, showResult] = useState(false)
  return (
    <Flex direction="column" gap="spacing-5" className="incident-view">
      <Flex gap="spacing-2" alignItems="center" wrap><Link href="#overview">Обзор смены</Link><Text color="secondary">/</Text><Link href={`#incident/${incident.key}`}>{incident.id}</Link></Flex>
      <div><Text as="h1" variant="display-2">Исследование инцидента</Text><Text color="secondary">{incident.product} · {incident.title}</Text></div>
      <Card className="mcc-glass incident-panel">
        <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap><Text as="h2" variant="header-1">Путь заказа</Text><Text color="secondary" variant="caption-2">Снимок на 12:42 МСК</Text></Flex>
        <ol className="incident-path">
          <li><Label theme="success">Оформление</Label><Text>100 заказов/мин</Text></li>
          <li><Label theme="warning">Оплата</Label><Text>82 из 100 в срок</Text></li>
          <li><Label theme="warning">База данных</Label><Text>Ожидание соединения</Text></li>
        </ol>
      </Card>
      <div className="incident-evidence">
        <Card className="mcc-glass incident-panel">
          <Flex justifyContent="space-between" alignItems="center" gap="spacing-2" wrap><Text as="h2" variant="header-1">Наблюдения</Text><Text color="secondary" variant="caption-2">12:37–12:42</Text></Flex>
          <dl className="incident-readings">
            <div><dt>Ожидание соединения с БД, p95</dt><dd>1,8 с</dd></div>
            <div><dt>Загрузка процессора сервиса оплаты</dt><dd>34%</dd></div>
            <div><dt>Соединения БД у фоновой задачи</dt><dd>18 из 24</dd></div>
          </dl>
          <Disclosure summary="Источники наблюдений"><Text as="p">Трассировки оплаты показывают ожидание соединения. Prometheus показывает загрузку процессора. Снимок сессий PostgreSQL указывает на соединения фоновой сверки.</Text></Disclosure>
        </Card>
        <Card className="mcc-glass incident-panel incident-hypothesis">
          <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap><Text as="h2" variant="header-1">Гипотеза агента</Text><Label theme="utility">Требует проверки</Label></Flex>
          <Text>Оплата может ждать свободное соединение, пока фоновая сверка удерживает большую часть пула БД.</Text>
          <Flex direction="column" gap="spacing-1"><Text variant="subheader-1">Вопрос дежурному БД</Text><Text>Сколько соединений освободится, если ограничить параллельность сверки? Снизится ли ожидание оплаты?</Text></Flex>
        </Card>
      </div>
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">Сравнение мер восстановления</Text>
        <Text>Исходно 82 заказа подтверждены в срок за минуту. Входящий поток — 100 уникальных заказов в минуту.</Text>
        <table className="incident-comparison">
          <caption>Заказы, подтверждённые в срок за минуту</caption>
          <thead><tr><th scope="col">Мера</th><th scope="col">Прогноз</th><th scope="col">Прогон</th></tr></thead>
          <tbody><tr><th scope="row">Добавить реплику оплаты</th><td>86</td><td>{result ? '84' : 'Скрыт'}</td></tr>
            <tr><th scope="row">Ограничить фоновую сверку</th><td>96</td><td>{result ? '95' : 'Скрыт'}</td></tr></tbody>
        </table>
        <Button view="action" size="l" aria-expanded={result} onClick={() => showResult(!result)}>{result ? 'Скрыть результат демопрогона' : 'Показать результат демопрогона'}</Button>
        {result && <Text role="status">Ограничение фоновой сверки дало 13 дополнительных оплат в срок за минуту. Очередь сверки выросла на 12 задач за минуту.</Text>}
      </Card>
    </Flex>
  )
}

export function IncidentView({incident, investigating, backHref}: {incident: Incident; investigating: boolean; backHref: string}) {
  const isPayment = incident.key === 'incident'
  if (isPayment && investigating) return <Investigation incident={incident}/>
  return (
    <Flex direction="column" gap="spacing-5" className="incident-view">
      <Link href={backHref}>← {backHref.startsWith('#events') ? 'К журналу событий' : backHref.startsWith('#wall') ? 'Общий экран смены' : 'К очереди'}</Link>
      <Flex justifyContent="space-between" alignItems="center" gap="spacing-4" wrap>
        <Flex direction="column" gap="spacing-2">
          <Flex gap="spacing-2" alignItems="center" wrap>
            <Text color="secondary">{incident.id}</Text>
            {incident.priority === 4 && <Label className="incident-critical">{incident.research || incident.restoredAt ? 'Наивысший приоритет' : 'Критический'}</Label>}
            <Label>{incident.state}</Label>
          </Flex>
          <Text as="h1" variant="display-2">{incident.title}</Text>
          <Text color="secondary">{incident.product} · Зарегистрирован в {incident.registered} МСК</Text>
        </Flex>
        {isPayment && <Button size="l" view="action" href={`#investigation/${incident.key}`}>Исследовать</Button>}
      </Flex>
      {isPayment ? <PaymentDetail incident={incident}/> : <Assignment incident={incident}/>}
    </Flex>
  )
}
