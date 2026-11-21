import {workspaceFetch} from '../auth/session'
import {useEffect, useId, useState, type ReactNode} from 'react'
import {Button, Card, Flex, Label, Link, Select, Text, TextArea, TextInput} from '@gravity-ui/uikit'
import type {Incident} from './types'
import {useWorkspace} from './context'

interface DirectoryEntry {
  login: string
  name: string
  team: string
}
interface ExternalCard {
  external: true
  team: string
  login: string | null
  stateEnum: string
  solution: string
  users: DirectoryEntry[]
  expected: number
}
type Settings = ExternalCard | {external: false}
type Receipt = {id: string; team: string; assignee: string | null; state: string}
const statusLabels: Record<string, string> = {
  Assigned: 'Назначен',
  WorkInProgress: 'Выполняется',
  Resolved: 'Завершён',
  Closed: 'Закрыт',
  Research: 'Исследование ситуации',
}
async function request<T>(url: string, options: RequestInit): Promise<T> {
  const response = await workspaceFetch(url, {cache: 'no-store', ...options})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Не удалось получить ответ ITSM.')
  return data as T
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ошибка запроса ITSM.'
}

function EditForm({
  card,
  url,
  reload,
  onSaved,
  proposedTeam,
}: {
  card: ExternalCard
  url: string
  reload: () => void
  onSaved: (receipt: Receipt) => void
  proposedTeam?: string
}) {
  const id = useId()
  const [team, setTeam] = useState(proposedTeam || card.team),
    [login, setLogin] = useState(card.login ?? '')
  const [status, setStatus] = useState(card.stateEnum),
    [solution, setSolution] = useState(card.solution)
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const changes: Record<string, string | null> = {}
  const finished = ['Resolved', 'Closed', 'Research'].includes(status)
  if (team.trim() !== card.team) changes.assignedGroupName = team.trim()
  if ((login || null) !== card.login) changes.assignedEmployeeLogin = login || null
  if (status !== card.stateEnum || (finished && solution.trim() !== card.solution)) changes.stateEnum = status
  if (finished && solution.trim() && (solution.trim() !== card.solution || status !== card.stateEnum))
    changes.solution = solution.trim()
  const needsSolution = finished && (status !== card.stateEnum || solution.trim() !== card.solution)
  const canSave = team.trim() && Object.keys(changes).length > 0 && (!needsSolution || solution.trim())
  return (
    <form
      className="desk-stack"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!canSave || saving) return
        setSaving(true)
        setError('')
        try {
          const receipt = await request<Receipt>(url, {
            method: 'PATCH',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({expected: card.expected, changes}),
          })
          onSaved(receipt)
        } catch (e) {
          setError(errorMessage(e))
        } finally {
          setSaving(false)
        }
      }}
    >
      <div className="incident-fields official-edit-fields">
        <div className="mcc-field">
          <label htmlFor={id + '-team'}>Группа назначения</label>
          <TextInput id={id + '-team'} disabled={saving} value={team} onUpdate={setTeam} />
        </div>
        <div className="mcc-field">
          <label htmlFor={id + '-user'}>Исполнитель ITSM</label>
          <Select
            id={id + '-user'}
            width="max"
            disabled={saving}
            hasClear
            filterable
            value={login ? [login] : []}
            placeholder="Не назначен"
            onUpdate={([value]) => setLogin(value ?? '')}
            options={card.users.map((u) => ({
              value: u.login,
              content: u.name + (u.team ? ' · ' + u.team : ''),
            }))}
          />
        </div>
        <div className="mcc-field">
          <label htmlFor={id + '-status'}>Статус</label>
          <Select
            id={id + '-status'}
            disabled={saving}
            width="max"
            value={[status]}
            onUpdate={([value]) => setStatus(value)}
            options={Object.entries(statusLabels).map(([value, content]) => ({value, content}))}
          />
        </div>
      </div>
      {finished && (
        <div className="mcc-field">
          <label htmlFor={id + '-solution'}>Описание решения</label>
          <TextArea
            id={id + '-solution'}
            disabled={saving}
            rows={3}
            value={solution}
            onUpdate={setSolution}
          />
        </div>
      )}
      {error && (
        <Text role="alert" color="danger">
          {error}
        </Text>
      )}
      <Flex gap="spacing-2" wrap>
        <Button view="action" type="submit" disabled={!canSave || saving} loading={saving}>
          Сохранить в ITSM
        </Button>
        <Button disabled={saving} onClick={reload}>
          Перечитать карточку
        </Button>
      </Flex>
    </form>
  )
}

export function ItsmEditor({item, local, proposedTeam}: {item: Incident; local: ReactNode; proposedTeam?: string}) {
  const {mode, refresh} = useWorkspace()
  const url = '/api/stand/itsm?' + new URLSearchParams({mode, key: item.key})
  const [version, setVersion] = useState(0),
    [data, setData] = useState<Settings | null>(null)
  const [error, setError] = useState(''),
    [receipt, setReceipt] = useState<Receipt | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void request<Settings>(url, {signal: controller.signal})
      .then((d) => {
        if (!controller.signal.aborted) setData(d)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e))
      })
    return () => controller.abort()
  }, [url, version])
  function reload() {
    setData(null)
    setError('')
    setVersion((v) => v + 1)
  }
  if (data?.external === false) return local
  return (
    <Card className="mcc-glass incident-panel official-edit">
      <Link href={'#incident/' + item.key}>← В карточку инцидента</Link>
      <Text as="h1" variant="header-2">
        Изменить в ITSM · {item.id}
      </Text>
      <Text>
        {item.product} · {item.title}
      </Text>
      {receipt && (
        <Text role="status" color="positive">
          ITSM подтвердила изменение. Сейчас в карточке — {receipt.team} · {receipt.assignee ?? 'Исполнитель не назначен'} ·{' '}
          {receipt.state}
        </Text>
      )}
      {error ? (
        <>
          <Text role="alert" color="danger">
            {error}
          </Text>
          <Button onClick={reload}>Повторить чтение ITSM</Button>
        </>
      ) : data?.external ? (
        <>
          <Label theme="info">Данные ITSM</Label>
          <EditForm
            key={version}
            proposedTeam={version === 0 ? proposedTeam : undefined}
            card={data}
            url={url}
            reload={reload}
            onSaved={(saved) => {
              setReceipt(saved)
              void refresh()
              reload()
            }}
          />
        </>
      ) : (
        <Text role="status">Загрузка карточки и исполнителей из ITSM…</Text>
      )}
    </Card>
  )
}
