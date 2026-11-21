import {useMemo, useState} from 'react'
import {Button, Select, Text, TextInput, Link} from '@gravity-ui/uikit'
import type {Incident} from './types'
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

export function QueueFilters({incidents, params, update, queue, reset}: Props) {
  const {desk, act, person} = useWorkspace()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const options = useMemo(
    () =>
      !open
        ? {}
        : Object.fromEntries(
            fields.map(([field]) => {
              const values = [...new Set(incidents.map((i) => String(i[field] ?? '')).filter(Boolean))].sort()
              return [
                field,
                ['', ...values].map((value) => ({
                  value,
                  content: !value
                    ? 'Все'
                    : field === 'priority'
                      ? (priorityNames[Number(value) - 1] ?? value)
                      : value,
                })),
              ]
            }),
          ),
    [incidents, open],
  )
  const list = desk.presets[person] ?? []
  const activeFilters = [...fields, ['deadline', 'Срок решения'], ['sla', 'До 30 минут']]
    .filter(([key]) => params.get(key)).map(([, label]) => label)
  const presetParams = new URLSearchParams(params)
  presetParams.delete('page')
  const query = presetParams.toString()
  return (
    <details className="queue-filters" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Фильтры и сохранённые представления{activeFilters.length > 0 && ' · ' + activeFilters.join(', ')}
      </summary>
      {open && (
        <div className="mcc-disclosure-body">
          <div className="queue-filter-fields">
            {fields.map(([field, label]) => {
              return (
                <div key={field} className="mcc-field">
                  <label htmlFor={'queue-' + queue + '-' + field}>{label}</label>
                  <Select
                    id={'queue-' + queue + '-' + field}
                    width="max"
                    filterable
                    options={options[field]}
                    value={[params.get(field) ?? '']}
                    onUpdate={([v]) => update({[field]: v, page: ''})}
                  />
                </div>
              )
            })}
            <div className="mcc-field">
              <label htmlFor={'queue-filter-deadline-' + queue}>Срок решения</label>
              <Select
                id={'queue-filter-deadline-' + queue}
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
              <Link href="#overview?section=critical&sla=soon">Критические со сроком до 30 минут</Link>
              <Link href="#overview?section=assigned&deadline=late">Просроченное на координаторах</Link>
            </div>
            <Text as="h3" variant="subheader-2">Мои представления</Text>
            <div className="queue-preset-form">
              <div className="mcc-field">
                <label htmlFor={'queue-preset-name-' + queue}>Название представления</label>
                <TextInput id={'queue-preset-name-' + queue} value={name} onUpdate={setName} />
              </div>
              <Button
                disabled={!name.trim()}
                onClick={async () => {
                  if (
                    await act({
                      type: 'preset',
                      person,
                      title: name,
                      value: '#queue/' + queue + (query ? '?' + query : ''),
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
      )}
    </details>
  )
}
