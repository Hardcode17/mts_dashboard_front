import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Button, Card, Checkbox, Flex, getConfig, Link, Pagination, Select, Text, TextArea} from '@gravity-ui/uikit'
import {workspaceFetch} from '../../auth/session'
import {useWorkspace} from '../../desk/context'
import {fullTime, type Incident} from '../../desk/types'
import {ApiError} from '../../shared/api/http'
import {createShiftHandoverApi, type HandoverBatch, type HandoverInbox, type HandoverItem} from './api'
import {handoverMessages} from './messages'
import {currentGroups, handoverSituations} from './situations'

const api = createShiftHandoverApi(workspaceFetch)
const pageSize = 25
const selectionLimit = 1000
type Copy = typeof handoverMessages.ru
const incidentHref = (id: string) => '#incident/' + encodeURIComponent(id)

async function readHandover(signal?: AbortSignal) {
  const [data, openTasks] = await Promise.all([
    api.load(signal),
    api.queue(signal).catch(() => []),
  ])
  return {data, openTasks}
}

function Rows<T>({items, children}: {items: T[]; children: (item: T) => ReactNode}) {
  const [requestedPage, setPage] = useState(1)
  const page = Math.max(1, Math.min(requestedPage, Math.ceil(items.length / pageSize)))
  return (
    <>
      <ul className="desk-list">{items.slice((page - 1) * pageSize, page * pageSize).map(children)}</ul>
      {items.length > pageSize && <Pagination page={page} pageSize={pageSize} total={items.length} onUpdate={setPage} />}
    </>
  )
}

function ItemDetails({item, copy, impact}: {item: HandoverItem; copy: Copy; impact?: string}) {
  return (
    <Flex direction="column" gap="spacing-1">
      <Link href={incidentHref(item.incidentId)}>{item.incidentId} · {item.title}</Link>
      <Text color="secondary">
        P{item.priority}{item.team && ' · ' + item.team} · {item.deadline
          ? copy.deadline + ' ' + fullTime(Date.parse(item.deadline))
          : copy.noDeadline}
      </Text>
      {impact && <Text>{impact}</Text>}
    </Flex>
  )
}

function BatchRow({batch, copy, incoming, busy, byId, take}: {
  batch: HandoverBatch; copy: Copy; incoming: boolean; busy: boolean; byId: ReadonlyMap<string, Incident>; take: (id: number, task: number) => void
}) {
  return (
    <li>
      <details>
        <summary>{incoming ? copy.from + ' ' + batch.senderName : copy.to + ' ' + batch.recipientName} · {batch.items.length} · {fullTime(Date.parse(batch.createdAt))}</summary>
        <div className="mcc-disclosure-body">
          {batch.summary && <Text as="p">{batch.summary}</Text>}
          <Rows items={handoverSituations(batch.items, item => item.situationKey ?? String(item.taskId))}>{({key, incidentTasks}) => {
            const first = incidentTasks[0]
            const available = incidentTasks.every(item => item.available)
            return (
              <li key={key}>
                <details>
                  <summary>{first.incidentId} · {first.title}{incidentTasks.length > 1 && ' · ' + incidentTasks.length + ' INC'} · {first.claimedAt ? copy.claimed : available ? copy.waiting : copy.unavailable}</summary>
                  <div className="mcc-disclosure-body">
                    <Rows items={incidentTasks}>{item => <li key={item.taskId}><ItemDetails item={item} copy={copy} impact={byId.get(item.incidentId)?.impact}/></li>}</Rows>
                    {incoming && available && <>
                      <Text as="p" color="secondary">{copy.reviewHint}</Text>
                      <Button view="action" disabled={busy} onClick={() => take(batch.id, first.taskId)}>{copy.take}</Button>
                    </>}
                  </div>
                </details>
              </li>
            )
          }}</Rows>
        </div>
      </details>
    </li>
  )
}

export function ShiftHandover({incidents}: {incidents: Incident[]}) {
  const {desk} = useWorkspace()
  const groups = useMemo(() => currentGroups(desk.outageGroups ?? []), [desk.outageGroups])
  const byId = useMemo(() => new Map(incidents.map(item => [item.id, item])), [incidents])
  const copy = handoverMessages[getConfig().lang === 'ru' ? 'ru' : 'en']
  const [inbox, setInbox] = useState<HandoverInbox>()
  const [queue, setQueue] = useState<{taskId: number; incidentId: string}[]>([])
  const [recipient, setRecipient] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<{key: string; id: string} | null>(null)

  const apply = useCallback(({data, openTasks}: Awaited<ReturnType<typeof readHandover>>) => {
    setInbox(data)
    setQueue(openTasks)
    setSelected(current => new Set(data.owned.filter(item => item.available && current.has(item.taskId)).map(item => item.taskId)))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void readHandover(controller.signal).then(result => {
      if (!controller.signal.aborted) apply(result)
    }).catch(() => {
      if (!controller.signal.aborted) setError(copy.error)
    })
    return () => controller.abort()
  }, [apply, copy.error])

  async function run(action: () => Promise<unknown>, message = '') {
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await action()
      setFeedback(message)
      apply(await readHandover())
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409 ? copy.conflict : copy.error)
    } finally {
      setBusy(false)
    }
  }

  const owned = inbox?.owned ?? []
  const groupedOwned = handoverSituations(owned, item => groups.get(byId.get(item.incidentId)?.key ?? '')?.id ?? 'task:' + item.taskId)
  const eligible = groupedOwned.filter(group => group.incidentTasks.every(item => item.available))
    .flatMap(group => group.incidentTasks)
  const recipients = inbox?.recipients ?? []
  const displayTaskIds = new Set(eligible.map(item => item.taskId))
  const canSend = [...selected].every(id => displayTaskIds.has(id)) && recipients.some(value => String(value.id) === recipient)
    && groupedOwned.every(group => group.incidentTasks.every(item => selected.has(item.taskId))
      || group.incidentTasks.every(item => !selected.has(item.taskId)))
    && selected.size > 0 && selected.size <= selectionLimit

  function send() {
    const taskIds = [...selected].sort((a, b) => a - b)
    const situationKeys = Object.fromEntries(groupedOwned.flatMap(group =>
      group.incidentTasks.length > 1
        ? group.incidentTasks.filter(item => selected.has(item.taskId)).map(item => [item.taskId, group.key])
        : [],
    ))
    const data = {recipientId: Number(recipient), taskIds, summary, situationKeys}
    const key = JSON.stringify(data)
    if (request.current?.key !== key) request.current = {key, id: crypto.randomUUID()}
    const requestId = request.current.id
    void run(async () => {
      await api.send({...data, requestId})
      request.current = null
      setSelected(new Set())
      setSummary('')
    }, copy.sent)
  }

  function toggle(tasks: HandoverItem[], checked: boolean) {
    setSelected(value => {
      const next = new Set(value)
      for (const task of tasks) {
        if (checked) next.add(task.taskId)
        else next.delete(task.taskId)
      }
      return next
    })
  }

  const take = (batchId: number, taskId: number) => void run(() => api.take(batchId, taskId), copy.taken)

  return (
    <>
      <Card className="mcc-glass incident-panel">
        <Text as="h2" variant="header-1">{copy.title}</Text>
        {error && <Text role="alert" color="danger">{error}</Text>}
        {feedback && <Text role="status">{feedback}</Text>}
        <Button onClick={() => void run(async () => {})} disabled={busy}>{copy.refresh}</Button>
        {!inbox && !error && <Text role="status">{copy.loading}</Text>}
        {inbox && <>
          <div className="mcc-field">
            <label htmlFor="shift-handover-recipient">{copy.recipient}</label>
            <Select id="shift-handover-recipient" value={recipient ? [recipient] : []} disabled={busy || !recipients.length}
              options={recipients.map(value => ({value: String(value.id), content: value.name}))}
              onUpdate={([value]) => setRecipient(value ?? '')}/>
            {!recipients.length && <Text color="secondary">{copy.missingRecipients}</Text>}
          </div>
          <div className="mcc-field">
            <label htmlFor="shift-handover-summary">{copy.summary}</label>
            <TextArea id="shift-handover-summary" rows={3} value={summary} onUpdate={value => setSummary(value.slice(0, 2000))} disabled={busy}/>
          </div>
          <Text as="h3" variant="subheader-2">{copy.assignments}</Text>
          {owned.length ? <>
            <Checkbox checked={eligible.length > 0 && eligible.every(item => selected.has(item.taskId))}
              disabled={busy || !eligible.length || eligible.length > selectionLimit}
              onUpdate={checked => setSelected(new Set(checked ? eligible.map(item => item.taskId) : []))}>
              {copy.selectAll}
            </Checkbox>
            {eligible.length > selectionLimit && <Text color="secondary">{copy.selectionLimit}</Text>}
            <Rows items={groupedOwned}>{({key, incidentTasks}) => {
              const first = incidentTasks[0]
              const available = incidentTasks.every(item => item.available)
              return (
                <li key={key}>
                  <Checkbox checked={incidentTasks.every(item => selected.has(item.taskId))} disabled={busy || !available}
                    onUpdate={value => toggle(incidentTasks, value)}>
                    {groups.get(byId.get(first.incidentId)?.key ?? '')?.title ?? first.incidentId}{incidentTasks.length > 1 && ' · ' + incidentTasks.length + ' INC'}
                    {!available && ' · ' + copy.waiting}
                  </Checkbox>
                  <ItemDetails item={first} copy={copy} impact={byId.get(first.incidentId)?.impact}/>
                </li>
              )
            }}</Rows>
          </> : <Text color="secondary">{copy.empty}</Text>}
          <Button view="action" disabled={busy || !canSend} onClick={send}>{copy.send}</Button>
          {queue.length > 0 && <details>
            <summary>{copy.queue} · {queue.length}</summary>
            <Rows items={queue}>{task => (
              <li key={task.taskId}>
                <Link href={incidentHref(task.incidentId)}>
                  {task.incidentId}{byId.get(task.incidentId)?.title && ' · ' + byId.get(task.incidentId)?.title}
                </Link>
                <Button disabled={busy} onClick={() => void run(() => api.takeFromQueue(task.taskId), copy.taken)}>{copy.take}</Button>
              </li>
            )}</Rows>
          </details>}
        </>}
      </Card>
      {inbox && [inbox.incoming, inbox.outgoing].map((batches, index) => (
        <Card key={index} className="mcc-glass incident-panel">
          <Text as="h2" variant="header-1">{index === 0 ? copy.incoming : copy.outgoing}</Text>
          {batches.length ? <Rows items={batches}>{batch =>
            <BatchRow key={batch.id} batch={batch} copy={copy} incoming={index === 0} busy={busy} byId={byId} take={take}/>
          }</Rows> : <Text color="secondary">{copy.noBatches}</Text>}
        </Card>
      ))}
    </>
  )
}
