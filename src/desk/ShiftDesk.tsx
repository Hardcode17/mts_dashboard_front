import {useMemo, useRef, useState} from 'react'
import {usesRealBackend} from '../shared/api/mode'
import {ShiftHandover} from '../features/shift-handover/ShiftHandover'
import {NotificationSettings} from '../features/notification-settings/NotificationSettings'
import {
  Button,
  Card,
  Flex,
  getConfig,
  Label,
  Link,
  Pagination,
  Select,
  SegmentedRadioGroup,
  Switch,
  Text,
  TextArea,
  TextInput,
} from '@gravity-ui/uikit'
import {useWorkspace} from './context'
import {shiftAvailabilityMessages} from '../features/shift-availability/messages'
import {historyFields} from '../incidentHistory'
import {approvedTeam, fullTime, standNow, type Person, type Task} from './types'
import type {Incident} from './types'
import {ListVirtualizer} from '@gravity-ui/uikit/virtualizer'
import {NotificationCenter, StandChannels} from './NotificationCenter'
import {IncidentHandover} from './CardWork'

function TaskDetail({task, item, onHandoff}: {task: Task; item: Incident; onHandoff: (key: string) => void}) {
  const {desk, act, person, busy, now} = useWorkspace()
  const attempt = task.attempts.at(-1)
  const [draft, setTeam] = useState<string | undefined>()
  const choice = approvedTeam(desk.work[item.key], item.site === 'Ростов' ? 'Сетевая поддержка · Ростов' : undefined)
  const team = draft ?? choice
  const formatTime = (at: number) => fullTime(standNow(desk, at))
  const assigned = attempt && !attempt.ended && !task.finished ? attempt : undefined
  const mine = assigned?.person === person
  const owner = desk.people.find(p => p.id === assigned?.person)?.name
  const seconds = assigned?.deadline != null && !assigned.accepted
    ? Math.max(0, Math.ceil((assigned.deadline - now) / 1000))
    : null
  const status = task.finished ? 'Завершена' : !assigned ? 'В очереди' : assigned.accepted ? 'В работе' : 'Ожидает принятия'

  return (
    <li className="shift-task">
      <div className="shift-task-heading">
        <div className="shift-task-description">
          <Flex alignItems="center" gap="spacing-2" wrap>
            <Link className="shift-inc-number" href={'#incident/' + item.key}>{item.id}</Link>
            <Text color="secondary">{item.product}</Text>
          </Flex>
          <Text as="h3" variant="subheader-3">{item.title}</Text>
        </div>
        <Label size="s" theme={assigned?.accepted ? 'success' : 'normal'}>{status}</Label>
      </div>
      <div className="shift-task-footer">
        <Text color="secondary">
          {task.finished ? (attempt?.reason ?? 'Завершена') + ' · ' + formatTime(task.finished) : assigned ? 'Координатор · ' + owner : 'Ожидает свободного координатора'}
          {seconds !== null && <strong className="shift-countdown"> · До принятия {seconds} с</strong>}
        </Text>
        {mine && assigned && (assigned.accepted ? (
          <div className="shift-handoff">
            {choice && <span className="handoff-reason">Согласовано в рекомендации · {choice}</span>}
            <TextInput value={team} onUpdate={setTeam} placeholder="Команда решения"
              controlProps={{'aria-label': 'Команда решения ' + item.id}} />
            <Button view="action" disabled={!team.trim() || busy}
              onClick={async () => {
                const sent = await act({type: 'handoff', person, id: assigned.id, key: item.key, value: team, expected: item.updatedAt ?? 0})
                if (sent) onHandoff(item.key)
              }}>
              Передать исполнителю
            </Button>
          </div>
        ) : (
          <Button view="action" disabled={busy || seconds === 0}
            onClick={() => void act({type: 'accept', person, id: assigned.id, key: item.key})}>
            Принять в работу
          </Button>
        ))}
      </div>
      {task.attempts.length > 0 && (
        <details className="shift-history">
          <summary>История назначений ({task.attempts.length})</summary>
          <ol>{task.attempts.map(t => (
            <li key={t.id}>
              <time dateTime={new Date(standNow(desk, t.assigned)).toISOString()}>{formatTime(t.assigned)}</time>
              <span>{desk.people.find(p => p.id === t.person)?.name}
                {t.deadline && ' · Срок принятия ' + formatTime(t.deadline)}
                {t.accepted && ' · Принято ' + formatTime(t.accepted)}
                {t.ended ? ' · ' + t.reason + ' · ' + formatTime(t.ended) : !t.accepted && ' · Ожидает реакции'}
              </span>
            </li>
          ))}</ol>
        </details>
      )}
    </li>
  )
}

const taskScopes = [
  {id: 'mine', label: 'Мои', empty: 'У вас пока нет назначенных задач.'},
  {id: 'queue', label: 'В очереди', empty: 'Все задачи распределены.'},
  {id: 'done', label: 'Завершённые', empty: 'В этой смене ещё нет завершённых задач.'},
] as const
type TaskScope = typeof taskScopes[number]['id']

export function PersonalDesk({incidents}: {incidents: Incident[]}) {
  const {desk, person, login, act, busy, itsmExternal} = useWorkspace()
  const [scope, setScope] = useState<TaskScope>('mine')
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState('')
  const [page, setPage] = useState(1)
  const actor = desk.people.find(p => p.id === person) ?? desk.people[0]
  const groups = useMemo(() => {
    const result: Record<TaskScope, Task[]> = {mine: [], queue: [], done: []}
    for (const task of desk.tasks) {
      const attempt = task.attempts.at(-1)
      if (task.finished) result.done.push(task)
      else if (!attempt || attempt.ended) result.queue.push(task)
      else if (attempt.person === actor.id) result.mine.push(task)
    }
    return result
  }, [desk.tasks, actor.id])
  const assignedTasks = useMemo(() => new Map(desk.tasks.flatMap(task => {
    const attempt = task.attempts.at(-1)
    return !task.finished && attempt && !attempt.ended ? [[attempt.person, task.key] as const] : []
  })), [desk.tasks])
  const byKey = useMemo(() => new Map(incidents.map(i => [i.key, i])), [incidents])
  const queue = groups[scope]
  const tasks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru')
    if (!term) return queue
    return queue.filter(task => {
      const i = byKey.get(task.key)
      return i && [i.id, i.product, i.title].some(value => value.toLocaleLowerCase('ru').includes(term))
    })
  }, [queue, query, byKey])
  const curr = Math.max(1, Math.min(page, Math.ceil(tasks.length / 10)))

  function selectScope(value: TaskScope) {
    setScope(value)
    setQuery('')
    setPage(1)
  }

  return (
    <div className="shift-layout">
      <Card className="mcc-glass incident-panel shift-queue">
        <Text as="h2" variant="header-1">Задачи на распределение</Text>
        <SegmentedRadioGroup<TaskScope> className="shift-scope" aria-label="Очередь задач" value={scope}
          onUpdate={selectScope}>
          {taskScopes.map(({id, label}) => (
            <SegmentedRadioGroup.Option value={id} key={id}>{label} · {groups[id].length}</SegmentedRadioGroup.Option>
          ))}
        </SegmentedRadioGroup>
        <Select className="shift-scope-select" width="max" aria-label="Очередь задач" value={[scope]}
          options={taskScopes.map(({id, label}) => ({value:id, content:label+' · '+groups[id].length}))}
          onUpdate={([id])=>selectScope(id as TaskScope)} />
        {feedback && byKey.get(feedback) && <Text role="status">
          {itsmExternal ? 'ITSM подтвердила назначение' : 'Назначение на стенде'} · {byKey.get(feedback)!.id} · {byKey.get(feedback)!.team}
        </Text>}
        {(queue.length > 10 || query) && <TextInput type="search" hasClear value={query}
          placeholder="Номер, продукт или сбой" controlProps={{'aria-label':'Поиск в задачах на распределение'}}
          onUpdate={value => {setQuery(value); setPage(1)}} />}
        {tasks.length ? (
          <ul className="shift-task-list">
            {tasks.slice((curr - 1) * 10, curr * 10).map(task => {
              const item = byKey.get(task.key)
              return item && <TaskDetail key={task.key + task.opened} task={task} item={item} onHandoff={setFeedback} />
            })}
          </ul>
        ) : <Text as="p" color="secondary" className="shift-empty">{query.trim() ? 'По вашему запросу задач нет.' : taskScopes.find(s => s.id === scope)?.empty}</Text>}
        {tasks.length > 10 && <Pagination className="shift-pagination" page={curr} pageSize={10} total={tasks.length} onUpdate={setPage} compact showInput />}
      </Card>
      <Card className="mcc-glass incident-panel shift-coordinator">
        <Text as="h2" variant="header-1">Дежурный смены</Text>
        {usesRealBackend ? <Text variant="subheader-2">{actor.name}</Text> : <Select aria-label="Дежурный" width="max" size="l" value={[actor.id]}
          options={desk.people.map(p => ({value:p.id, content:p.name}))}
          onUpdate={([id]) => {login(id); setQuery(''); setFeedback(''); setPage(1)}} />}
        <div className="shift-availability">
          <Switch checked={actor.available && (!usesRealBackend || Boolean(actor.shiftGroups?.length))}
            disabled={busy || (usesRealBackend && !actor.shiftGroups?.length)}
            onUpdate={enabled => void act({type:'available', person:actor.id, enabled})}>
            Доступен для назначений
          </Switch>
          {usesRealBackend && <ShiftGroups groups={actor.shiftGroups}/>}
        </div>
        <details className="shift-roster" open>
          <summary>Состав смены <span>{desk.people.length}</span></summary>
          <ul>{desk.people.map(p => {
            const taskKey = assignedTasks.get(p.id)
            return <li key={p.id}>
              <Flex direction="column" gap="spacing-1">
                <Text>{p.name}</Text>
                {taskKey && <Link href={'#incident/' + taskKey}>{byKey.get(taskKey)?.id ?? taskKey}</Link>}
              </Flex>
              <span className="shift-presence" data-available={p.available && !taskKey}>
                {!p.available ? 'Недоступен' : taskKey ? 'Распределяет' : 'Свободен'}
              </span>
            </li>
          })}</ul>
        </details>
      </Card>
    </div>
  )
}
function ShiftGroups({groups}: {groups: Person['shiftGroups']}) {
  const copy = shiftAvailabilityMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  return groups?.length
    ? <Text as="p" color="secondary">{copy.groups} · {groups.map(group => group.name).join(', ')}</Text>
    : <Text as="p" color="secondary">{(groups ? copy.noMembership : copy.notConfigured)}</Text>
}

function IncidentPicker({incidents, value, onUpdate}: {
  incidents: Incident[]; value: string; onUpdate: (key: string) => void
}) {
  const options = useMemo(() => incidents.map(i => ({value: i.key, content: i.id + ' · ' + i.title})), [incidents])
  return <ListVirtualizer><Select width="max" filterable aria-label="Выбрать инцидент" placeholder="Номер INC или сбой"
    value={value ? [value] : []} options={options} onUpdate={([key]) => onUpdate(key)}/></ListVirtualizer>
}

function HandoverDesk({incidents}: {incidents: Incident[]}) {
  const key = new URLSearchParams(location.hash.split('?')[1]).get('incident')
  const item = incidents.find(i => i.key === key)
  return <div className="desk-stack">
    {usesRealBackend && <ShiftHandover incidents={incidents}/>}
    <Card className="mcc-glass incident-panel">
      <Text as="h2" variant="header-1">Сводка для передачи смены</Text>
      <IncidentPicker incidents={incidents} value={item?.key ?? ''} onUpdate={next => {location.hash = 'desk/handover?incident=' + encodeURIComponent(next)}}/>
      {key && !item && <Text color="secondary">Этот INC отсутствует в выбранном наборе.</Text>}
    </Card>
    {item && <IncidentHandover item={item}/>}
  </div>
}

export function StandSettings({incidents}: {incidents: Incident[]}) {
  const {desk, mode, source, checked, refresh, act, error, busy} = useWorkspace()
  const requested = new URLSearchParams(location.hash.split('?')[1]).get('incident')
  const item = incidents.find(i => i.key === requested) ?? (!requested ? incidents[0] : undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const [threshold, setThreshold] = useState(String(desk.threshold)),
    [json, setJson] = useState(''),
    [problem, setProblem] = useState('')
  async function upload(text: string) {
    setProblem('')
    try {
      const data: unknown = JSON.parse(text)
      if (await act({type: 'upload', data})) {
        setJson('')
      }
    } catch {
      setProblem('JSON не разобран. Проверьте скобки, кавычки и запятые.')
    }
  }
  return (
    <div className="desk-grid stand-settings">
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">Сценарии стенда</Text>
        <Button view="outlined" disabled={busy} onClick={() => void act({type:'demo'})}>Демо: новый крит</Button>
        <div className="mcc-field">
          <Text as="h3" variant="subheader-2">Настройки инцидента</Text>
          <IncidentPicker incidents={incidents} value={item?.key ?? ''} onUpdate={key => {location.hash='stand?incident='+encodeURIComponent(key)}}/>
        </div>
        {item && <Flex gap="spacing-3" wrap>
          <Link href={'#stand/room/'+encodeURIComponent(item.key)}>Управление демовстречей</Link>
          <Link href={'#stand/agent/'+encodeURIComponent(item.key)}>Условия разбора ИИ</Link>
        </Flex>}
        {item && <details>
          <summary>Доступность команды решения</summary>
          <div className="mcc-disclosure-body mcc-field">
            <label htmlFor="stand-availability">Доступность по графику стенда</label>
            <Select id="stand-availability" width="max" value={[desk.work[item.key]?.availability ?? 'unknown']}
              options={[
                {value:'unknown',content:'Нет ответа о доступности'}, {value:'ready',content:'Трое свободны'},
                {value:'wait',content:'Двое свободны, третий через час'},
              ]}
              onUpdate={([value]) => void act({type:'advisor',key:item.key,kind:'availability',value})}/>
          </div>
        </details>}
      </Card>
      <StandChannels/>
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Источник карточек
        </Text>
        <div className="mcc-field">
          <label htmlFor="shift-dataset">Набор данных</label>
          <Select id="shift-dataset" width="max" value={[mode]}
            options={[
              {value: 'case', content: 'Кейс МТС · JSON'},
              {value: 'volume', content: 'Большая смена · 3600 INC'},
            ]}
            onUpdate={([v]) => source(v === 'case' ? 'case' : 'volume')}
          />
        </div>
        <div className="shift-source-status">
          <Text>{error || desk.sourceError || 'Опрос работает'}</Text>
          <Text color="secondary">Последняя проверка: {checked ? fullTime(checked) : 'ожидаем ответа'}</Text>
        </div>
        <Button onClick={() => void refresh()}>Обновить сейчас</Button>
        <div className="shift-source-threshold">
          <div className="mcc-field">
            <label htmlFor="shift-sla-threshold">Порог предупреждения SLA, мин</label>
            <TextInput id="shift-sla-threshold" type="number" value={threshold} onUpdate={setThreshold} />
          </div>
          <Button onClick={() => void act({type: 'threshold', number: Number(threshold)})}>Сохранить порог</Button>
        </div>
      </Card>
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          {mode === 'case' ? 'Проверка снимка ITSM' : 'Большая смена'}
        </Text>
        {mode === 'case' ? (
          <>
            <Text>
              Источник:{' '}
              {desk.input === 'file'
                ? 'файл стенда · проверка каждую секунду'
                : 'загруженный снимок'}
              . В текущем снимке карточек: {Object.values(desk.records).filter(i => !i.absent).length}.
            </Text>
            <Button onClick={() => fileInput.current?.click()}>Загрузить JSON из файла</Button>
            <input
              ref={fileInput}
              type="file"
              hidden
              aria-label="Загрузить JSON"
              accept=".json,application/json"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void file.text().then(upload).catch(() => setProblem('Не удалось прочитать файл. Выберите его ещё раз.'))
                e.target.value = ''
              }}
            />
            <div className="mcc-field">
              <label htmlFor="shift-snapshot-json">JSON снимка</label>
              <TextArea
                id="shift-snapshot-json"
                value={json}
                onUpdate={setJson}
                rows={4}
                placeholder="Вставьте полный массив карточек"
              />
            </div>
            <Flex gap="spacing-2" wrap>
              <Button disabled={!json.trim()} onClick={() => void upload(json)}>
                Применить снимок
              </Button>
              <Button onClick={() => void act({type: 'watchFile'})}>Читать файл стенда</Button>
            </Flex>
            {problem && (
              <Text color="danger" role="alert">
                {problem}
              </Text>
            )}
            <div className="shift-source-changes">
              <Text as="h3" variant="subheader-2">Последние изменения</Text>
              {desk.lastChanges.length === 0 ? (
                <Text color="secondary">Изменений после загрузки пока нет.</Text>
              ) : (
                <ul>
                  {desk.lastChanges.slice(0, 15).map((x) => (
                    <li key={x.id}>
                      <Link href={'#incident/' + x.id + '?tab=history'}>{x.id}</Link> ·{' '}
                      {x.fields.map((k) => historyFields[k as keyof typeof historyFields] ?? k).join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <Text>Для загрузки снимка ITSM выберите «Кейс МТС · JSON».</Text>
            <Link href="/prototype/cerebro/">Демоминута: 479 критических, 300 входов и 300 выходов →</Link>
            <Button
              onClick={async () => {
                if (await act({type: 'wifi'})) location.hash = 'incident/wifi-rostov?section=related'
              }}
            >
              Сценарий Wi-Fi · Ростов
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
export function ShiftDesk({tab, incidents}: {tab: string | undefined; incidents: Incident[]}) {
  return (
    <div className="shift-desk">
      <nav className="desk-tabs" aria-label="Инструменты смены">
        {[
          ['tasks', 'Назначения'],
          ['notifications', 'Уведомления'],
          ['handover', 'Передача смены'],
        ].map(([key, name]) => (
          <Link key={key} href={'#desk/' + key} aria-current={(tab ?? 'tasks') === key ? 'page' : undefined}>
            {name}
          </Link>
        ))}
      </nav>
      {tab === 'handover' ? (
        <HandoverDesk incidents={incidents}/>
      ) : tab === 'notifications' ? (
        <div className="desk-stack">
          {usesRealBackend && <NotificationSettings />}
          <NotificationCenter incidents={incidents} />
        </div>
      ) : (
        <PersonalDesk incidents={incidents} />
      )}
    </div>
  )
}
