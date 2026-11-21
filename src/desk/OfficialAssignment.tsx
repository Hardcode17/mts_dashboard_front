import {useEffect, useMemo, useState} from 'react'
import {Button, Dialog, Flex, Label, Link, Loader, Select, Text, TextArea, TextInput} from '@gravity-ui/uikit'
import type {Incident} from './types'
import {useWorkspace} from './context'
import {itsmEnumForState, itsmStateLabels, type ItsmState} from './types'
import type {OfficialChanges} from './official'
import '../IncidentView.css'

const completedStates: ItsmState[] = ['Resolved', 'Closed', 'Research']
const stateOptions = (Object.keys(itsmStateLabels) as ItsmState[]).map((value) => ({
  value,
  content: itsmStateLabels[value],
}))

interface Prepared {
  changes: OfficialChanges
  summary: string[]
  reassign: boolean
}

type SaveState =
  | {kind: 'saving'; summary: string[]}
  | {kind: 'saved'; summary: string[]}
  | {kind: 'failed'; error: string}
  | null

/**
 * Официальное назначение в карточке инцидента (KAN-12): координатор выбирает
 * исполнителя из справочника ITSM, меняет группу и статус. Отправка идёт через
 * бэкенд дашборда (PATCH /api/dashboard/incidents/{id}); подтверждённое
 * состояние всегда приходит ответом сервера, при отказе показ откатывается.
 */
export function OfficialAssignment({incident, proposedTeam}: {incident: Incident; proposedTeam?: string}) {
  const {directory, directoryError, loadUsers, patchIncident} = useWorkspace()
  // Пока координатор не выбрал исполнителя сам, поле следует за подтверждённым назначением.
  const [employeeChoice, setEmployeeChoice] = useState<string | null>(null)
  const [team, setTeam] = useState(proposedTeam || incident.team)
  const [stateEnum, setStateEnum] = useState<ItsmState | ''>(itsmEnumForState(incident.state) ?? '')
  const [solution, setSolution] = useState(incident.solution ?? '')
  const [save, setSave] = useState<SaveState>(null)
  const [confirm, setConfirm] = useState<Prepared | null>(null)
  useEffect(() => {
    void loadUsers()
  }, [loadUsers])
  const currentEnum = itsmEnumForState(incident.state)
  const currentLogin = useMemo(
    () => incident.assigneeLogin ?? directory?.find((user) => user.name === incident.assignee)?.login ?? '',
    [directory, incident.assigneeLogin, incident.assignee],
  )
  const employee = employeeChoice ?? currentLogin
  const userOptions = useMemo(
    () => [
      {value: '', content: 'Не назначен'},
      ...(directory ?? []).map((user) => ({
        value: user.login,
        content: user.name + (user.groupName ? ' · ' + user.groupName : ''),
      })),
    ],
    [directory],
  )
  const statusOptions = useMemo(
    () =>
      currentEnum
        ? stateOptions
        : [{value: '', content: 'Не менять · ' + incident.state + ' (вне контракта ITSM)'}, ...stateOptions],
    [currentEnum, incident.state],
  )
  const completedSelected = stateEnum !== '' && completedStates.includes(stateEnum)

  const prepared = useMemo<Prepared | {error: string}>(
    () => {
      const changes: OfficialChanges = {}
      const summary: string[] = []
      const nextTeam = team.trim()
      if (nextTeam !== incident.team) {
        if (!nextTeam) return {error: 'Группа назначения не может быть пустой.'}
        changes.assignedGroupName = nextTeam
        summary.push('Группа: «' + incident.team + '» → «' + nextTeam + '»')
      }
      if (employee !== currentLogin) {
        const chosen = directory?.find((user) => user.login === employee)
        changes.assignedEmployeeLogin = employee || null
        changes.assignedEmployeeName = chosen?.name ?? ''
        summary.push('Исполнитель: ' + (incident.assignee ?? 'не назначен') + ' → ' + (chosen?.name ?? 'не назначен'))
      }
      const solutionChanged = completedSelected && solution.trim() !== (incident.solution ?? '')
      if (stateEnum !== '' && (stateEnum !== currentEnum || solutionChanged)) {
        changes.stateEnum = stateEnum
        if (stateEnum !== currentEnum) summary.push('Статус: ' + incident.state + ' → ' + itsmStateLabels[stateEnum])
        if (solutionChanged) {
          if (!solution.trim()) return {error: 'Укажите текст решения для завершающего статуса.'}
          changes.solution = solution.trim()
          summary.push('Решение: обновлено')
        }
      }
      if (changes.stateEnum !== undefined && !completedSelected && incident.solution)
        summary.push('Решение: будет очищено активным статусом')
      const reassign =
        (changes.assignedEmployeeLogin !== undefined && Boolean(incident.assignee)) ||
        (changes.assignedGroupName !== undefined && Boolean(incident.team))
      return {changes, summary, reassign}
    },
    [completedSelected, currentEnum, currentLogin, directory, employee, incident, solution, stateEnum, team],
  )
  const invalid = 'error' in prepared
  const hasChanges = !invalid && prepared.summary.length > 0

  async function apply(target: Prepared) {
    setConfirm(null)
    setSave({kind: 'saving', summary: target.summary})
    const result = await patchIncident(incident, target.changes)
    if (result.ok) {
      // Форма следует за подтверждённым ответом сервера (нормализация решения, имён и т. д.).
      const record = result.record
      if (record) {
        setTeam(record.team)
        setSolution(record.solution ?? '')
        setStateEnum(itsmEnumForState(record.state) ?? '')
        setEmployeeChoice(null)
      }
      setSave({kind: 'saved', summary: target.summary})
    } else {
      // Введённые значения остаются доступными для исправления и повторной отправки.
      setSave({kind: 'failed', error: result.error ?? 'Изменение не сохранено'})
    }
  }

  const directoryPending = !directory && !directoryError
  return (
    <section className="official-assign" aria-label="Официальное назначение">
      <Flex alignItems="center" gap="spacing-2" wrap>
        <Text as="h3" variant="subheader-2">
          Изменить официальное назначение
        </Text>
        <Label theme="info">ITSM</Label>
      </Flex>
      <Text color="secondary" variant="body-2">
        Исполнитель, группа и статус хранятся в ITSM. Изменение уходит через бэкенд дашборда и вступает в силу после
        подтверждения сервера.
      </Text>
      <div className="incident-fields">
        <div className="mcc-field">
          <label htmlFor="official-employee">Исполнитель</label>
          {directoryPending ? (
            <Flex alignItems="center" gap="spacing-2">
              <Loader />
              <Text color="secondary">Загружаем справочник…</Text>
            </Flex>
          ) : directoryError ? (
            <Flex direction="column" gap="spacing-1">
              <Text role="alert">Справочник недоступен: {directoryError}</Text>
              <Button size="s" onClick={() => void loadUsers()}>
                Повторить загрузку
              </Button>
            </Flex>
          ) : (
            <Select
              id="official-employee"
              width="max"
              filterable
              placeholder="Выберите исполнителя"
              value={[employee]}
              options={userOptions}
              onUpdate={([value]) => setEmployeeChoice(value)}
            />
          )}
        </div>
        <div className="mcc-field">
          <label htmlFor="official-team">Группа назначения</label>
          <TextInput id="official-team" value={team} onUpdate={setTeam} />
        </div>
        <div className="mcc-field">
          <label htmlFor="official-state">Статус</label>
          <Select
            id="official-state"
            width="max"
            value={[stateEnum]}
            options={statusOptions}
            onUpdate={([value]) => setStateEnum(value as ItsmState | '')}
          />
        </div>
      </div>
      {(completedSelected || (stateEnum !== '' && incident.solution)) && (
        <div className="mcc-field">
          <label htmlFor="official-solution">Описание решения</label>
          <TextArea id="official-solution" rows={3} value={solution} onUpdate={setSolution} />
          {!completedSelected && (
            <Text color="secondary" variant="caption-2">
              Активный статус очистит действующий текст решения в ITSM.
            </Text>
          )}
        </div>
      )}
      <Flex gap="spacing-2" wrap alignItems="center">
        <Button
          view="action"
          disabled={directoryPending || save?.kind === 'saving' || invalid || !hasChanges}
          onClick={() => {
            if (invalid || !hasChanges) return
            if (prepared.reassign) setConfirm(prepared)
            else void apply(prepared)
          }}
        >
          Сохранить в ITSM
        </Button>
        {save?.kind === 'saving' && (
          <Text role="status" color="secondary">
            Отправляем: {save.summary.join(' · ')}
          </Text>
        )}
        {save?.kind === 'saved' && (
          <Flex alignItems="center" gap="spacing-2" wrap>
            <Label theme="success">Применено</Label>
            <Text>{save.summary.join(' · ')}</Text>
            <Link href={'#incident/' + incident.key + '?tab=history'}>Открыть историю изменений</Link>
          </Flex>
        )}
        {save?.kind === 'failed' && (
          <Text role="alert" color="danger">
            {save.error} Карточка возвращена к последнему подтверждённому состоянию — исправьте значения и отправьте
            снова.
          </Text>
        )}
      </Flex>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        aria-labelledby="official-assign-confirm"
        maxWidth="s"
      >
        <Dialog.Header id="official-assign-confirm" caption="Перезаписать назначение?" />
        <Dialog.Body>
          <Text>У инцидента {incident.id} уже есть официальное назначение в ITSM:</Text>
          <ul className="history-comparison">
            {confirm?.summary.map((line) => (
              <li key={line}>
                <Text>{line}</Text>
              </li>
            ))}
          </ul>
          <Text color="secondary">
            Подтверждённая передача закрывает внутреннюю задачу распределения. Повторная публикация того же состояния
            не дублирует историю.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Перезаписать"
          textButtonCancel="Отмена"
          onClickButtonCancel={() => setConfirm(null)}
          onClickButtonApply={() => confirm && void apply(confirm)}
        />
      </Dialog>
    </section>
  )
}
