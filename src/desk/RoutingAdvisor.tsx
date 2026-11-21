import {useState} from 'react'
import {Button, Card, Flex, Label, Link, Select, Text, TextInput} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace} from './context'

export function RoutingAdvisor({item, past}: {item: Incident; past?: Incident}) {
  const {desk, act} = useWorkspace(),
    work = desk.work[item.key],
    availability = work?.availability ?? 'unknown'
  const name = item.site === 'Ростов' ? 'Сетевая поддержка · Ростов' : past?.team || item.team
  const [team, setTeam] = useState(name),
    [reason, setReason] = useState('')
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
        Адресат: {name || 'уточнить владельца'}.{' '}
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
          <div className="mcc-field">
            <label htmlFor="advisor-availability">Доступность по графику стенда</label>
            <Select id="advisor-availability" width="max"
              value={[availability]}
              options={[
                {value: 'ready', content: 'Трое свободны'},
                {value: 'wait', content: 'Двое свободны, третий через час'},
                {value: 'unknown', content: 'Нет ответа о доступности'},
              ]}
              onUpdate={([v]) => void act({type: 'advisor', key: item.key, kind: 'availability', value: v})}
            />
          </div>
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
          <TextInput id="advisor-team" value={team} onUpdate={setTeam} />
        </div>
        <div className="mcc-field">
          <label htmlFor="advisor-comment">Комментарий координатора</label>
          <TextInput id="advisor-comment" value={reason} onUpdate={setReason} />
        </div>
      </div>
      <Flex gap="spacing-2" wrap>
        <Button
          disabled={!team.trim()}
          onClick={() =>
            void act({
              type: 'advisor',
              key: item.key,
              text: (team === name ? 'Принято: ' : 'Уточнено: ') + team + (reason ? ' · ' + reason : ''),
            })
          }
        >
          Согласовать рекомендацию
        </Button>
        <Button
          onClick={() =>
            void act({type: 'advisor', key: item.key, text: 'Отклонено' + (reason ? ': ' + reason : '')})
          }
        >
          Отклонить
        </Button>
      </Flex>
      {work?.recommendation && <Text role="status">{work.recommendation}</Text>}
    </Card>
  )
}
