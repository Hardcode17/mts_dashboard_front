import {useState} from 'react'
import {Button, Select, TextInput, Link, Text} from '@gravity-ui/uikit'
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

const fields = [
  ['priority', 'Приоритет'],
  ['product', 'Продукт'],
  ['team', 'Команда'],
  ['state', 'Статус'],
  ['serviceType', 'Тип сервиса'],
] as const

const sharedPresets = [
  {title: 'Критические со сроком до 30 минут', href: '#queue/critical?sla=soon'},
  {title: 'Просроченное на координаторах', href: '#queue/assigned?deadline=late'},
]

export function QueueFilters({incidents, params, update, queue, reset}: Props) {
  const {desk, act, person} = useWorkspace()
  const [name, setName] = useState('')
  const fieldId = 'queue-filter-' + queue + '-'
  const list = desk.presets[person] ?? []
  const activeFilters = [...fields, ['deadline', 'Срок решения'], ['sla', 'До 30 минут']]
    .filter(([key]) => params.get(key))
    .map(([, label]) => label)
  const presetParams = new URLSearchParams(params)
  presetParams.delete('page')
  const presetQuery = presetParams.toString()
  const presetHref = '#queue/' + queue + (presetQuery ? '?' + presetQuery : '')
  return (
    <details className="queue-filters">
      <summary>
        Фильтры и сохранённые представления{activeFilters.length > 0 && ' · ' + activeFilters.join(', ')}
      </summary>
      <div className="mcc-disclosure-body">
        <div className="queue-filter-fields">
          {fields.map(([field, label]) => {
            const values = [...new Set(incidents.map((i) => String(i[field] ?? '')).filter(Boolean))].sort()
            return (
              <div key={field} className="mcc-field">
                <label htmlFor={fieldId + field}>{label}</label>
                <Select
                  id={fieldId + field}
                  width="max"
                  filterable
                  options={['', ...values].map((v) => ({
                    value: v,
                    content: !v ? 'Все' : field === 'priority' ? (priorityNames[Number(v) - 1] ?? v) : v,
                  }))}
                  value={[params.get(field) ?? '']}
                  onUpdate={([v]) => update({[field]: v, page: ''})}
                />
              </div>
            )
          })}
          <div className="mcc-field">
            <label htmlFor={fieldId + 'deadline'}>Срок решения</label>
            <Select
              id={fieldId + 'deadline'}
              width="max"
              value={[params.get('deadline') ?? '']}
              options={[
                {value: '', content: 'Любой срок'},
                {value: 'late', content: 'Просрочено'},
                {value: 'near', content: 'Близкий срок'},
                {value: 'none', content: 'Без срока'},
              ]}
              onUpdate={([v]) => update({deadline: v, page: ''})}
            />
          </div>
        </div>
        <Button className="queue-filter-reset" onClick={reset}>
          Сбросить фильтры
        </Button>
        <div className="queue-presets">
          <Text as="h3" variant="subheader-2">Готовые представления</Text>
          <div className="queue-saved-preset">
            {sharedPresets.map(({title, href}) => <Link key={href} href={href}>{title}</Link>)}
          </div>
          <Text as="h3" variant="subheader-2">Мои представления</Text>
          <div className="queue-preset-form">
            <div className="mcc-field">
              <label htmlFor={fieldId + 'preset-name'}>Название представления</label>
              <TextInput id={fieldId + 'preset-name'} value={name} onUpdate={setName} />
            </div>
            <Button
              disabled={!name.trim()}
              onClick={async () => {
                if (
                  await act({
                    type: 'preset',
                    person,
                    title: name,
                    value: presetHref,
                  })
                )
                  setName('')
              }}
            >
              Сохранить представление
            </Button>
          </div>
          {list.map((p) => (
            <div className="queue-saved-preset" key={p.name}>
              <Link href={p.href}>{p.name}</Link>
              <Button
                size="s"
                view="flat-secondary"
                aria-label={'Удалить ' + p.name}
                onClick={() => void act({type: 'removePreset', person, title: p.name})}
              >
                Удалить
              </Button>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
