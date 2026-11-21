import {useMemo, useState} from 'react'
import {
  Button,
  Card,
  Flex,
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
import {historyFields} from '../incidentHistory'
import {fullTime, standNow, type Task} from './types'
import type {Incident} from '../demoData'
import {NotificationCenter} from './NotificationCenter'

function TaskDetail({task, item, onHandoff}: {task: Task; item: Incident; onHandoff: (message: string) => void}) {
  const {desk, act, person, busy, now} = useWorkspace()
  const attempt = task.attempts.at(-1)
  const [team, setTeam] = useState('')
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
            <TextInput value={team} onUpdate={setTeam} placeholder="Команда решения"
              controlProps={{'aria-label': 'Команда решения ' + item.id}} />
            <Button view="action" disabled={!team.trim() || busy}
              onClick={async () => {
                const sent = await act({type: 'handoff', person, id: assigned.id, key: item.key, value: team, expected: item.updatedAt ?? 0})
                if (sent) onHandoff(item.id + ' передан команде «' + team.trim() + '».')
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
  const {desk, person, login, act, busy} = useWorkspace()
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
        {feedback && <Text role="status">{feedback}</Text>}
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
        <Select aria-label="Дежурный" width="max" size="l" value={[actor.id]}
          options={desk.people.map(p => ({value:p.id, content:p.name}))}
          onUpdate={([id]) => {login(id); setQuery(''); setFeedback(''); setPage(1)}} />
        <div className="shift-availability">
          <Switch checked={actor.available} disabled={busy}
            onUpdate={enabled => void act({type:'available', person:actor.id, enabled})}>
            Доступен для назначений
          </Switch>
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
function SourceDesk() {
  const {desk, mode, source, checked, refresh, act, error} = useWorkspace()
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
    <div className="desk-grid">
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Источник карточек
        </Text>
        <Select
          label="Набор данных"
          value={[mode]}
          options={[
            {value: 'case', content: 'Кейс МТС · JSON'},
            {value: 'volume', content: 'Большая смена · 3600 INC'},
          ]}
          onUpdate={([v]) => source(v === 'case' ? 'case' : 'volume')}
        />
        <Text>{error || desk.sourceError || 'Опрос работает'}</Text>
        <Text color="secondary">Последняя проверка: {checked ? fullTime(checked) : 'ожидаем ответа'}</Text>
        <Button onClick={() => void refresh()}>Обновить сейчас</Button>
        {mode === 'volume' && (
          <Button
            onClick={async () => {
              if (await act({type: 'wifi'})) location.hash = 'incident/wifi-rostov?tab=work'
            }}
          >
            Сценарий Wi-Fi · Ростов
          </Button>
        )}
        <TextInput
          label="Порог предупреждения SLA, мин"
          type="number"
          value={threshold}
          onUpdate={setThreshold}
        />
        <Button onClick={() => void act({type: 'threshold', number: Number(threshold)})}>
          Сохранить порог
        </Button>
      </Card>
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">
          Проверка снимка ITSM
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
            <label className="file-pick">
              Загрузить JSON{' '}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void file.text().then(upload)
                  e.target.value = ''
                }}
              />
            </label>
            <TextArea
              value={json}
              onUpdate={setJson}
              rows={4}
              controlProps={{'aria-label': 'JSON снимка'}}
              placeholder="Или вставьте полный массив карточек"
            />
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
            <Text color="secondary">Последние изменения</Text>
            <ul>
              {desk.lastChanges.slice(0, 15).map((x) => (
                <li key={x.id}>
                  <Link href={'#incident/' + x.id + '?tab=history'}>{x.id}</Link> ·{' '}
                  {x.fields.map((k) => historyFields[k as keyof typeof historyFields] ?? k).join(', ')}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Text>
            Для живого редактирования исходной выгрузки выберите «Кейс МТС · JSON». Большая смена
            предназначена для проверки длинных очередей.
          </Text>
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
          ['source', 'Источник данных'],
        ].map(([key, name]) => (
          <Link key={key} href={'#desk/' + key} aria-current={(tab ?? 'tasks') === key ? 'page' : undefined}>
            {name}
          </Link>
        ))}
      </nav>
      {tab === 'source' ? (
        <SourceDesk />
      ) : tab === 'notifications' ? (
        <NotificationCenter incidents={incidents} />
      ) : (
        <PersonalDesk incidents={incidents} />
      )}
    </div>
  )
}
