import {useState} from 'react'
import {Button, Card, Flex, Label, Link, Text, TextInput} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace} from './context'
import {approvedTeam, technicalTeam} from './types'

export function RoutingAdvisor({item, past}: {item: Incident; past?: Incident}) {
  const {desk, act, person, busy, itsmExternal} = useWorkspace(),
    work = desk.work[item.key],
    availability = work?.availability ?? 'unknown'
  const name = item.site === 'Ростов' ? 'Сетевая поддержка · Ростов' : technicalTeam(past?.team) || technicalTeam(item.team)
  const saved = approvedTeam(work, name)
  const [draft, setTeam] = useState<string | undefined>(),
    [reason, setReason] = useState('')
  const team = draft ?? (saved || name)
  const targetTeam = technicalTeam(team)
  const myAttempt = desk.tasks.find(t => t.key === item.key && !t.finished)?.attempts.at(-1)
  const canHandOff = myAttempt?.person === person && myAttempt.accepted && !myAttempt.ended
  const [sent, setSent] = useState(false)
  const measured = Boolean(past?.specialists && past.workMinutes)
  const wait = availability === 'ready' ? 0 : availability === 'wait' ? 60 : null
  return (
    <Card className="mcc-glass incident-panel">
      <Flex alignItems="center" justifyContent="space-between" gap="spacing-2" wrap>
        <Text as="h2" variant="header-1">
          Кому передать проверку
        </Text>
        <Label theme="utility">Рекомендация</Label>
      </Flex>
      {past ? (
        <>
          <Link href={'#incident/' + past.key}>
            {past.id} · {past.product} · {past.site ?? 'прошлый случай'}
          </Link>
          <Text>Результат: {past.solution || 'текст решения отсутствует'}.</Text>
        </>
      ) : (
        <Text>Нет сопоставимого завершённого случая. Уточните владельца и доступность команды.</Text>
      )}
      <Text>
        Предлагаемая группа — {name || 'требуется уточнить владельца'}.{' '}
        {measured
          ? 'Опыт прошлого случая: ' +
            past!.specialists +
            ' специалиста, ' +
            past!.workMinutes +
            ' мин работы.'
          : 'Размер команды и длительность работ в истории не указаны.'}
      </Text>
      {measured && (
        <>
          <Text>
            {wait === null
              ? 'Ожидание неизвестно. Спросить старшего смены, когда будет полный состав.'
              : 'При старте полным составом: ' +
                wait +
                ' мин ожидания + ' +
                past!.workMinutes +
                ' мин работ = ' +
                (wait + past!.workMinutes!) +
                ' мин до восстановления.'}
          </Text>
        </>
      )}
      <div className="incident-fields">
        <div className="mcc-field">
          <label htmlFor="advisor-team">Предлагаемая команда</label>
          <TextInput id="advisor-team" value={team} onUpdate={value => {setSent(false); setTeam(value)}} />
        </div>
        <div className="mcc-field">
          <label htmlFor="advisor-comment">Комментарий координатора</label>
          <TextInput id="advisor-comment" value={reason} onUpdate={setReason} />
        </div>
      </div>
      <Flex gap="spacing-2" wrap>
        <Button
          disabled={!targetTeam || busy}
          onClick={() =>
            void act({
              type: 'advisor',
              key: item.key, person, kind: 'accept', value: targetTeam,
              text: (team === name ? 'Принято: ' : 'Уточнено: ') + team + (reason ? ' · ' + reason : ''),
            })
          }
        >
          Согласовать рекомендацию
        </Button>
        <Button
          onClick={() =>
            void act({type: 'advisor', key: item.key, person, kind: 'reject', text: 'Отклонено' + (reason ? ': ' + reason : '')})
          }
        >
          Отклонить
        </Button>
      </Flex>
      {work?.recommendation && <Text role="status">{work.recommendation}</Text>}
      {targetTeam && !sent && (canHandOff ? (
        <Button view="action" disabled={busy} onClick={async () => {
          const ok = await act({type:'handoff', key:item.key, person, id:myAttempt.id, value:targetTeam, expected:item.updatedAt ?? 0})
          if (ok) setSent(true)
        }}>Передать исполнителю</Button>
      ) : <Link href={'#itsm/' + encodeURIComponent(item.key) + '?team=' + encodeURIComponent(targetTeam)}>Изменить назначение в ITSM</Link>)}
      {sent && <Text role="status">{itsmExternal ? 'ITSM подтвердила назначение' : 'Назначение на стенде'} · {desk.records[item.key]?.team ?? item.team}</Text>}
    </Card>
  )
}
