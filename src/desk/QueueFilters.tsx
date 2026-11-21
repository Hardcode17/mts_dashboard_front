import {useState} from 'react'
import {Button, Flex, Select, TextInput, Link} from '@gravity-ui/uikit'
import type {Incident} from '../demoData'
import {useWorkspace} from './context'
import {priorityNames} from './types'
type Props = {
  incidents: Incident[]
  params: URLSearchParams
  update: (p: Record<string, string>) => void
  reset: () => void
  queue: string
}
export function QueueFilters({incidents, params, update, queue, reset}: Props) {
  const {desk, act, person} = useWorkspace(),
    [name, setName] = useState('')
  const fields = [
    ['priority', 'Приоритет'],
    ['product', 'Продукт'],
    ['team', 'Команда'],
    ['state', 'Статус'],
    ['serviceType', 'Тип сервиса'],
  ] as const
  const list = desk.presets[person] ?? []
  const activeFilters = [...fields.map(([field]) => field), 'deadline'].filter(key => params.get(key)).length
  return (
    <details className="queue-filters">
      <summary>Фильтры и сохранённые представления{activeFilters > 0 && ' · применено: ' + activeFilters}</summary>
      <Flex wrap gap="spacing-2">
        {fields.map(([field, label]) => {
          const values = [...new Set(incidents.map((i) => String(i[field] ?? '')).filter(Boolean))].sort()
          return (
            <Select
              key={field}
              label={label}
              aria-label={label}
              filterable
              options={['', ...values].map((v) => ({value: v, content: !v ? 'Все' : field === 'priority' ? priorityNames[Number(v) - 1] ?? v : v}))}
              value={[params.get(field) ?? '']}
              onUpdate={([v]) => update({[field]: v, page: ''})}
            />
          )
        })}
        <Select
          label="Показать"
          value={[params.get('deadline') ?? '']}
          options={[
            {value: '', content: 'Любой срок'},
            {value: 'late', content: 'Просрочено'},
            {value: 'near', content: 'Близкий срок'},
            {value: 'none', content: 'Без срока'},
          ]}
          onUpdate={([v]) => update({deadline: v, page: ''})}
        />
        <Button onClick={reset}>
          Сбросить фильтры
        </Button>
      </Flex>
      <Flex alignItems="center" gap="spacing-2" wrap>
        <TextInput
          placeholder="Название представления"
          value={name}
          onUpdate={setName}
          controlProps={{'aria-label': 'Название представления'}}
        />
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            if (
              await act({
                type: 'preset',
                person,
                title: name,
                value: '#queue/' + queue + '?' + params.toString(),
              })
            )
              setName('')
          }}
        >
          Сохранить представление
        </Button>
      </Flex>
      {list.map((p) => (
        <Flex key={p.name} alignItems="center" gap="spacing-2">
          <Link href={p.href}>{p.name}</Link>
          <Button
            size="s"
            view="flat-secondary"
            aria-label={'Удалить ' + p.name}
            onClick={() => void act({type: 'removePreset', person, title: p.name})}
          >
            Удалить
          </Button>
        </Flex>
      ))}
    </details>
  )
}
