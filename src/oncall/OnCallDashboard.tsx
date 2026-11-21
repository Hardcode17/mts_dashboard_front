import {
  ArrowRotateLeft,
  ArrowUp,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  CircleExclamation,
  CircleInfo,
  Flask,
  Magnifier,
  Person,
  Sliders,
} from '@gravity-ui/icons'
import {Table, useTable} from '@gravity-ui/table'
import type {ColumnDef} from '@gravity-ui/table/tanstack'
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Icon,
  Label,
  SegmentedRadioGroup,
  Select,
  Text,
  TextInput,
  Tooltip,
} from '@gravity-ui/uikit'
import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react'
import mtsSymbol from '../assets/mts-symbol.svg'
import {CriticalAlertOverlay, CriticalAlertPinned} from './CriticalAlertOverlay'
import type {CriticalAlertEvent} from './CriticalAlertOverlay'
import {alertGroups} from './mockAlertGroups'
import {OnCallCharts} from './OnCallCharts'
import type {
  AlertGroup,
  IncidentGroup,
  IncidentStatus,
  Priority,
} from './types'
import './OnCallDashboard.css'

interface OnCallDashboardProps {
  theme: 'light' | 'dark'
  changeTheme: (value: 'light' | 'dark') => void
}

const COORDINATORS = 'КЦ ИТ Координаторы Массовых Инцидентов'
const CRITICAL_GRACE_MS = 30_000
const NEAREST_DEADLINES_LIMIT = 3

const ACTIVE_STATUSES: IncidentStatus[] = ['new', 'assigned', 'in_progress']
const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']
const PRIORITY_ORDER: Record<Priority, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
}

function isActiveStatus(status: IncidentStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

function getIncidentGroups(incident: AlertGroup): IncidentGroup[] {
  const active = isActiveStatus(incident.status)
  const groups: IncidentGroup[] = []

  if (active && incident.priority === 'P1') {
    groups.push('critical')
  }
  if (
    (active || incident.status === 'research') &&
    incident.assignee === COORDINATORS
  ) {
    groups.push('on_coordinators')
  }
  if (active && incident.priority === 'P3') {
    groups.push('high_priority')
  }
  if (incident.status === 'research') {
    groups.push('research')
  }

  return groups
}

const GROUP_META = [
  {
    id: 'critical',
    label: 'Критические',
    description: 'P1, активные',
    icon: CircleExclamation,
    color: 'danger' as const,
  },
  {
    id: 'on_coordinators',
    label: 'На координаторах',
    description: 'Назначены на КЦ',
    icon: Person,
    color: 'warning' as const,
  },
  {
    id: 'high_priority',
    label: 'Высокий приоритет',
    description: 'P3, активные',
    icon: ArrowUp,
    color: 'info' as const,
  },
  {
    id: 'research',
    label: 'Исследование',
    description: 'Сбой устранён, идёт разбор',
    icon: CircleInfo,
    color: 'positive' as const,
  },
] as const

const PRIORITY_SECTION_META: Record<
  Priority,
  {title: string; theme: 'normal' | 'info' | 'warning' | 'danger'}
> = {
  P1: {title: 'Критические', theme: 'danger'},
  P2: {title: 'Приоритет P2', theme: 'warning'},
  P3: {title: 'Высокий приоритет', theme: 'info'},
  P4: {title: 'Приоритет P4', theme: 'normal'},
}

const STATUS_META: Record<
  IncidentStatus,
  {label: string; theme: 'normal' | 'info' | 'success' | 'warning' | 'danger' | 'utility'}
> = {
  new: {label: 'Новый', theme: 'info'},
  assigned: {label: 'Назначен', theme: 'warning'},
  in_progress: {label: 'В работе', theme: 'info'},
  research: {label: 'Исследование', theme: 'utility'},
  resolved: {label: 'Решён', theme: 'success'},
  closed: {label: 'Закрыт', theme: 'normal'},
}

const PRIORITY_THEME: Record<
  Priority,
  'normal' | 'info' | 'success' | 'warning' | 'danger' | 'utility'
> = {
  P1: 'danger',
  P2: 'warning',
  P3: 'info',
  P4: 'normal',
}

const numberFormatter = new Intl.NumberFormat('ru-RU')
const createdFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const deadlineFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function deadlineValue(incident: AlertGroup): number {
  return incident.slaDeadline
    ? new Date(incident.slaDeadline).getTime()
    : Number.POSITIVE_INFINITY
}

function compareIncidents(a: AlertGroup, b: AlertGroup): number {
  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  if (byPriority !== 0) {
    return byPriority
  }

  const byDeadline = deadlineValue(a) - deadlineValue(b)
  if (byDeadline !== 0) {
    return byDeadline
  }

  const byCreated =
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  if (byCreated !== 0) {
    return byCreated
  }

  return a.id.localeCompare(b.id)
}

function formatDeadline(deadline: string | undefined): string {
  return deadline ? deadlineFormatter.format(new Date(deadline)) : '—'
}

function formatRemaining(deadline: string, now: number): string {
  const diff = new Date(deadline).getTime() - now
  const totalMinutes = Math.max(1, Math.floor(Math.abs(diff) / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  let value = `${minutes} мин`

  if (days > 0) {
    value = `${days} д ${hours} ч`
  } else if (hours > 0) {
    value = `${hours} ч ${minutes} мин`
  }

  return diff < 0 ? `Просрочен на ${value}` : `Осталось ${value}`
}

const rangeOptions = [
  {value: '24h', content: 'Последние 24 часа'},
  {value: '7d', content: 'Последние 7 дней'},
  {value: '30d', content: 'Последние 30 дней'},
]

const silenceOptions = [
  {value: '30m', content: '30 минут'},
  {value: '1h', content: '1 час'},
  {value: '4h', content: '4 часа'},
  {value: '1d', content: '1 день'},
]

interface PrioritySectionProps {
  priority: Priority
  rows: AlertGroup[]
  columns: ColumnDef<AlertGroup>[]
}

function NearestDeadlines({incidents}: {incidents: AlertGroup[]}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const activeDeadlines = useMemo(
    () =>
      incidents
        .filter(
          (incident) => isActiveStatus(incident.status) && incident.slaDeadline,
        )
        .sort((a, b) => {
          const byDeadline = deadlineValue(a) - deadlineValue(b)
          if (byDeadline !== 0) {
            return byDeadline
          }

          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        }),
    [incidents],
  )
  const nearest = activeDeadlines.slice(0, NEAREST_DEADLINES_LIMIT)

  return (
    <section className="oncall-deadlines" aria-labelledby="oncall-deadlines-title">
      <div className="oncall-deadlines__heading">
        <div>
          <Text id="oncall-deadlines-title" variant="header-2" as="h2">
            Ближайшие сроки
          </Text>
          <Text variant="caption-2" color="secondary">
            {NEAREST_DEADLINES_LIMIT} ближайших по SLA среди всех приоритетов.
            При одинаковом сроке выше более значимый приоритет.
          </Text>
        </div>
        <Button
          view="flat"
          size="s"
          onClick={() => {
            document
              .getElementById('oncall-full-list')
              ?.scrollIntoView({behavior: 'smooth', block: 'start'})
          }}
        >
          Полный список
        </Button>
      </div>

      {nearest.length > 0 ? (
        <div className="oncall-deadlines__grid">
          {nearest.map((incident) => {
            const deadline = incident.slaDeadline
            if (!deadline) {
              return null
            }

            const overdue = new Date(deadline).getTime() < now
            const status = STATUS_META[incident.status]

            return (
              <Card
                key={incident.id}
                view="outlined"
                className={`oncall-deadline${
                  overdue ? ' oncall-deadline_overdue' : ''
                }`}
              >
                <Flex
                  alignItems="center"
                  justifyContent="space-between"
                  gap="spacing-2"
                >
                  <Flex alignItems="center" gap="spacing-2">
                    <Label theme={PRIORITY_THEME[incident.priority]} size="xs">
                      {incident.priority}
                    </Label>
                    <Text variant="code-inline-1">{incident.id}</Text>
                  </Flex>
                  <Text
                    variant="caption-2"
                    color={overdue ? 'danger' : 'secondary'}
                  >
                    {formatDeadline(deadline)}
                  </Text>
                </Flex>

                <Text variant="subheader-1" ellipsisLines={2}>
                  {incident.title}
                </Text>

                <Flex
                  alignItems="center"
                  justifyContent="space-between"
                  gap="spacing-2"
                  wrap
                >
                  <Flex alignItems="center" gap="spacing-2">
                    <Label theme={status.theme} size="xs">
                      {status.label}
                    </Label>
                    <Text
                      variant="body-1"
                      color={overdue ? 'danger' : 'warning'}
                    >
                      {formatRemaining(deadline, now)}
                    </Text>
                  </Flex>
                  <Text variant="caption-2" color="secondary" ellipsis>
                    {incident.team}
                  </Text>
                </Flex>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card view="outlined" className="oncall-deadlines__empty">
          <Text variant="body-1" color="secondary">
            Нет активных инцидентов со сроком.
          </Text>
        </Card>
      )}
    </section>
  )
}

function PrioritySection({priority, rows, columns}: PrioritySectionProps) {
  const meta = PRIORITY_SECTION_META[priority]
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const table = useTable({
    data: rows,
    columns,
    getRowId: (incident) => incident.id,
  })

  return (
    <section
      className={`oncall-priority oncall-priority_${priority.toLowerCase()}${
        collapsed ? ' oncall-priority_collapsed' : ''
      }`}
    >
      <header className="oncall-priority__header">
        <Button
          className="oncall-priority__toggle"
          view="flat"
          width="max"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Flex
            alignItems="center"
            justifyContent="space-between"
            gap="spacing-2"
            width="max"
          >
            <Flex alignItems="center" gap="spacing-2">
              <Label theme={meta.theme} size="xs">
                {priority}
              </Label>
              <Text variant="subheader-2">{meta.title}</Text>
              <Text variant="caption-2" color="secondary">
                {rows.length}
              </Text>
            </Flex>
            <Icon
              data={collapsed ? ChevronDown : ChevronUp}
              size={16}
              color="secondary"
            />
          </Flex>
        </Button>
      </header>

      <div className="oncall-priority__scroll" id={contentId} hidden={collapsed}>
        <Table
          table={table}
          size="s"
          verticalAlign="middle"
          className="oncall-table"
          attributes={{'aria-label': `${meta.title}: список инцидентов`}}
        />
      </div>
    </section>
  )
}

export function OnCallDashboard({theme, changeTheme}: OnCallDashboardProps) {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState('30d')
  const [silence, setSilence] = useState('1h')
  const [groupFilter, setGroupFilter] = useState<'all' | IncidentGroup>('all')
  const [incidents, setIncidents] = useState<AlertGroup[]>(alertGroups)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [criticalEvents, setCriticalEvents] = useState<CriticalAlertEvent[]>(
    [],
  )
  const [graceUntil, setGraceUntil] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const nextIncidentNumber = useRef(
    alertGroups.reduce((max, incident) => {
      const value = Number(incident.id.replace('INC-', ''))
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0) + 1,
  )

  const alertOpen = graceUntil === null && criticalEvents.length > 0
  const graceSeconds =
    graceUntil === null
      ? 0
      : Math.max(0, Math.ceil((graceUntil - clock) / 1000))

  useEffect(() => {
    if (graceUntil === null) {
      return
    }

    const timer = setTimeout(
      () => setGraceUntil(null),
      Math.max(0, graceUntil - Date.now()),
    )

    return () => clearTimeout(timer)
  }, [graceUntil])

  useEffect(() => {
    if (graceUntil === null) {
      return
    }

    const interval = setInterval(() => setClock(Date.now()), 500)

    return () => clearInterval(interval)
  }, [graceUntil])

  const groupCounts = useMemo(() => {
    const counts: Record<IncidentGroup, number> = {
      critical: 0,
      on_coordinators: 0,
      high_priority: 0,
      research: 0,
    }

    for (const incident of incidents) {
      for (const group of getIncidentGroups(incident)) {
        counts[group] += 1
      }
    }

    return counts
  }, [incidents])

  const groupOptions = useMemo(
    () => [
      {value: 'all', content: 'Все группы'},
      ...GROUP_META.map((group) => ({value: group.id, content: group.label})),
    ],
    [],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()

    return incidents.filter((incident) => {
      if (
        groupFilter !== 'all' &&
        !getIncidentGroups(incident).includes(groupFilter)
      ) {
        return false
      }

      if (!query) {
        return true
      }

      return [
        incident.id,
        incident.title,
        incident.product,
        incident.integration,
        incident.team,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [groupFilter, incidents, search])

  const sections = useMemo(() => {
    const sorted = [...filtered].sort(compareIncidents)

    return PRIORITIES.map((priority) => ({
      priority,
      rows: sorted.filter((incident) => incident.priority === priority),
    })).filter((section) => section.rows.length > 0)
  }, [filtered])

  const selectedVisible = filtered.filter((incident) =>
    selectedIds.has(incident.id),
  )
  const allSelected =
    filtered.length > 0 && selectedVisible.length === filtered.length
  const someSelected = selectedVisible.length > 0 && !allSelected
  const selectedCount = selectedIds.size

  const toggleRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelectedIds((previous) => {
        const next = new Set(previous)
        for (const incident of filtered) {
          if (checked) {
            next.add(incident.id)
          } else {
            next.delete(incident.id)
          }
        }
        return next
      })
    },
    [filtered],
  )

  const columns = useMemo<ColumnDef<AlertGroup>[]>(
    () => [
      {
        id: 'select',
        size: 40,
        header: () => (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            onUpdate={toggleAll}
            title="Выбрать все на странице"
          />
        ),
        cell: ({row}) => (
          <Checkbox
            checked={selectedIds.has(row.original.id)}
            onUpdate={(checked) => toggleRow(row.original.id, checked)}
            title={`Выбрать ${row.original.id}`}
          />
        ),
      },
      {
        accessorKey: 'status',
        size: 132,
        minSize: 104,
        maxSize: 132,
        header: 'Статус',
        cell: ({row}) => (
          <Label theme={STATUS_META[row.original.status].theme} size="xs">
            {STATUS_META[row.original.status].label}
          </Label>
        ),
      },
      {
        accessorKey: 'priority',
        size: 56,
        header: 'P',
        cell: ({row}) => (
          <Label theme={PRIORITY_THEME[row.original.priority]} size="xs">
            {row.original.priority}
          </Label>
        ),
      },
      {
        accessorKey: 'id',
        size: 90,
        header: 'ID',
        cell: ({row}) => (
          <Text
            variant="code-inline-1"
            color="secondary"
            whiteSpace="nowrap"
          >
            {row.original.id}
          </Text>
        ),
      },
      {
        accessorKey: 'title',
        size: 270,
        header: 'Заголовок',
        cell: ({row}) => (
          <Tooltip content={row.original.title} openDelay={300}>
            <span className="oncall-clamp">
              <Text variant="body-1" ellipsisLines={2}>
                {row.original.title}
              </Text>
            </span>
          </Tooltip>
        ),
      },
      {
        accessorKey: 'alertsCount',
        size: 56,
        header: 'Алерты',
        cell: ({row}) => (
          <Text variant="body-1">{row.original.alertsCount}</Text>
        ),
      },
      {
        accessorKey: 'integration',
        size: 100,
        header: 'Интеграция',
        cell: ({row}) => (
          <Tooltip content={row.original.integration} openDelay={300}>
            <span className="oncall-clamp">
              <Flex alignItems="center" gap="spacing-1">
                <span className="oncall-integration-dot" aria-hidden="true" />
                <Text variant="body-1" ellipsis>
                  {row.original.integration}
                </Text>
              </Flex>
            </span>
          </Tooltip>
        ),
      },
      {
        accessorKey: 'slaDeadline',
        size: 96,
        header: 'SLA до',
        cell: ({row}) => (
          <Text
            variant="caption-2"
            color={row.original.slaDeadline ? 'primary' : 'secondary'}
          >
            {formatDeadline(row.original.slaDeadline)}
          </Text>
        ),
      },
      {
        accessorKey: 'createdAt',
        size: 112,
        header: 'Создан',
        cell: ({row}) => (
          <Text variant="caption-2" color="secondary">
            {createdFormatter.format(new Date(row.original.createdAt))}
          </Text>
        ),
      },
      {
        id: 'groups',
        size: 160,
        header: 'Группы',
        cell: ({row}) => {
          const groups = getIncidentGroups(row.original)

          return groups.length > 0 ? (
            <Flex gap="spacing-1" wrap>
              {groups.map((group) => {
                const meta = GROUP_META.find((item) => item.id === group)
                return meta ? (
                  <Label key={group} size="xs" theme="normal">
                    {meta.label}
                  </Label>
                ) : null
              })}
            </Flex>
          ) : (
            <Text variant="body-1" color="secondary">
              —
            </Text>
          )
        },
      },
      {
        accessorKey: 'team',
        size: 90,
        header: 'Команда',
        cell: ({row}) => (
          <Tooltip content={row.original.team} openDelay={300}>
            <span className="oncall-clamp">
              <Text variant="body-1" ellipsis>
                {row.original.team}
              </Text>
            </span>
          </Tooltip>
        ),
      },
      {
        accessorKey: 'users',
        size: 190,
        header: 'Участники',
        cell: ({row}) => {
          const users = row.original.users.join(', ')

          return users ? (
            <Tooltip content={users} openDelay={300}>
              <span className="oncall-clamp">
                <Text variant="body-1" ellipsisLines={2}>
                  {users}
                </Text>
              </span>
            </Tooltip>
          ) : (
            <Text variant="body-1" color="secondary">
              Не назначены
            </Text>
          )
        },
      },
    ],
    [allSelected, selectedIds, someSelected, toggleAll, toggleRow],
  )

  const addCriticalIncident = useCallback(() => {
    const nextNumber = nextIncidentNumber.current
    nextIncidentNumber.current += 1
    const now = new Date()

    const incident: AlertGroup = {
      id: `INC-${nextNumber}`,
      status: 'new',
      priority: 'P1',
      title: `Дебаг: новый критический инцидент ${nextNumber}`,
      product: 'Платежи',
      alertsCount: 1,
      integration: 'ITSC',
      createdAt: now.toISOString(),
      slaDeadline: new Date(now.getTime() + 15 * 60_000).toISOString(),
      team: 'MCC',
      users: [],
      assignee: COORDINATORS,
    }

    setIncidents((previous) => [incident, ...previous])
    setCriticalEvents((previous) => [
      ...previous,
      {key: `${incident.id}-${now.getTime()}`, incident},
    ])
  }, [])

  const confirmCriticalEvents = useCallback((keys: string[]) => {
    const confirmed = new Set(keys)

    setCriticalEvents((previous) =>
      previous.filter((event) => !confirmed.has(event.key)),
    )
    const now = Date.now()
    setClock(now)
    setGraceUntil(now + CRITICAL_GRACE_MS)
  }, [])

  const updateSearch = (value: string) => {
    setSearch(value)
  }

  const updateGroup = (value: string) => {
    setGroupFilter(value as 'all' | IncidentGroup)
  }

  const selectGroup = (group: IncidentGroup) => {
    setGroupFilter((previous) => (previous === group ? 'all' : group))
  }

  return (
    <div className="oncall">
      <header className="oncall-topbar">
        <div className="oncall-brand">
          <img className="oncall-brand__logo" src={mtsSymbol} alt="" />
          <div className="oncall-brand__text">
            <Text variant="subheader-2">MTS Dashboard</Text>
            <Text variant="caption-2" color="secondary">
              Mission Control Center
            </Text>
          </div>
        </div>

        <div className="oncall-breadcrumbs" aria-label="Хлебные крошки">
          <Text variant="body-1" color="secondary">
            MCC
          </Text>
          <span>/</span>
          <Text variant="body-1" color="secondary">
            Инциденты
          </Text>
          <span>/</span>
          <Text variant="body-1">Группы оповещений</Text>
        </div>

        <div className="oncall-topbar__actions">
          <TextInput
            className="oncall-topbar__search"
            size="m"
            placeholder="Поиск или переход..."
            startContent={<Icon data={Magnifier} size={16} color="secondary" />}
            controlProps={{'aria-label': 'Поиск по интерфейсу'}}
          />
          <SegmentedRadioGroup<'light' | 'dark'>
            aria-label="Тема оформления"
            value={theme}
            onUpdate={changeTheme}
            size="m"
          >
            <SegmentedRadioGroup.Option value="light">
              Светлая
            </SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="dark">
              Тёмная
            </SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
        </div>
      </header>

      <main className="oncall__main">
        <div className="oncall__heading">
          <div className="oncall__title">
            <div className="oncall__title-row">
              <Icon data={Bell} size={24} color="warning" />
              <Text variant="header-1" as="h1">
                Группы оповещений
              </Text>
            </div>
            <Text variant="body-1" color="secondary">
              Четыре группы внимания: критические, на координаторах, высокий
              приоритет и исследование
            </Text>
          </div>

          <Flex alignItems="center" gap="spacing-2" wrap>
            <Select
              size="m"
              value={[range]}
              options={rangeOptions}
              onUpdate={([value]) => setRange(value)}
              aria-label="Период"
            />
            <Button view="outlined" size="m">
              <Icon data={ArrowRotateLeft} size={16} />
              Обновить
            </Button>
            <Button
              view="outlined-danger"
              size="m"
              onClick={addCriticalIncident}
              title="Смоделировать появление нового критического инцидента"
            >
              <Icon data={Flask} size={16} />
              Дебаг: критический INC
            </Button>
            <Button view="action" size="m">
              Создать эскалацию
            </Button>
          </Flex>
        </div>

        <div className="oncall__stats">
          {GROUP_META.map((group) => {
            const active = groupFilter === group.id

            return (
              <Card
                key={group.id}
                type="action"
                view="outlined"
                className={`oncall-stat oncall-stat_${group.id}${
                  active ? ' oncall-stat_active' : ''
                }${
                  group.id === 'critical' && groupCounts.critical > 0
                    ? ' oncall-stat_attention'
                    : ''
                }`}
                onClick={() => selectGroup(group.id)}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectGroup(group.id)
                  }
                }}
              >
                <Icon data={group.icon} size={22} color={group.color} />
                <div className="oncall-stat__body">
                  <Text variant="caption-2" color="secondary">
                    {group.label}
                  </Text>
                  <Text variant="display-2">
                    {numberFormatter.format(groupCounts[group.id])}
                  </Text>
                  <Text variant="caption-1" color="hint">
                    {group.description}
                  </Text>
                </div>
              </Card>
            )
          })}
        </div>

        <NearestDeadlines incidents={filtered} />

        <OnCallCharts incidents={filtered} />

        <div className="oncall__list-heading" id="oncall-full-list">
          <div className="oncall__list-title">
            <Text variant="header-2" as="h2">
              Полный список инцидентов
            </Text>
            <Text variant="caption-2" color="secondary">
              Все инциденты по приоритетам. Команда — назначение из ITSM,
              участники — люди, вовлечённые в инцидент.
            </Text>
          </div>
          <Text variant="caption-2" color="secondary">
            {numberFormatter.format(filtered.length)} в выборке
          </Text>
        </div>

        <Card view="outlined" className="oncall__panel">
          <div className="oncall__toolbar">
            <Button
              view="outlined"
              size="m"
              disabled={selectedCount === 0}
              onClick={() => setSelectedIds(new Set())}
            >
              <Icon data={Check} size={14} />
              Решить
            </Button>
            <Button
              view="outlined"
              size="m"
              disabled={selectedCount === 0}
              onClick={() => setSelectedIds(new Set())}
            >
              <Icon data={Bell} size={14} />
              Подтвердить
            </Button>
            <Button
              view="outlined"
              size="m"
              disabled={selectedCount === 0}
              onClick={() => setSelectedIds(new Set())}
            >
              <Icon data={ArrowRotateLeft} size={14} />
              Перезапустить
            </Button>
            <Select
              size="m"
              label="Заглушить на"
              value={[silence]}
              options={silenceOptions}
              onUpdate={([value]) => setSilence(value)}
              disabled={selectedCount === 0}
            />

            <Text variant="body-1" color="secondary">
              {selectedCount > 0
                ? `Выбрано: ${selectedCount}`
                : 'Ничего не выбрано'}
            </Text>

            <div className="oncall__toolbar-spacer" />

            <Select
              size="m"
              label="Группа"
              value={[groupFilter]}
              options={groupOptions}
              onUpdate={([value]) => updateGroup(value)}
              aria-label="Фильтр по группе"
            />
            <TextInput
              size="m"
              value={search}
              onUpdate={updateSearch}
              hasClear
              placeholder="Поиск или фильтр..."
              startContent={<Icon data={Magnifier} size={16} color="secondary" />}
              controlProps={{'aria-label': 'Поиск по группам оповещений'}}
            />
            <Button view="flat" size="m">
              <Icon data={Sliders} size={16} />
              Колонки
            </Button>
          </div>

          <div className="oncall__section-note">
            <Text variant="caption-2" color="secondary">
              Сортировка: приоритет → срок SLA → дата появления. Критические
              всегда выше.
            </Text>
          </div>

          <div className="oncall__sections">
            {sections.map((section) => (
              <PrioritySection
                key={section.priority}
                priority={section.priority}
                rows={section.rows}
                columns={columns}
              />
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="oncall__empty">
              <Text variant="subheader-2">Ничего не найдено</Text>
              <Text variant="body-1" color="secondary">
                Попробуй изменить группу, запрос или сбросить фильтр.
              </Text>
            </div>
          ) : null}

          <div className="oncall__footer">
            <Text variant="body-1" color="secondary">
              Всего: {numberFormatter.format(filtered.length)}
            </Text>
            <Text variant="caption-2" color="hint">
              P1 → P2 → P3 → P4 · внутри приоритета — SLA и дата появления
            </Text>
          </div>
        </Card>
      </main>

      <CriticalAlertOverlay
        open={alertOpen}
        events={criticalEvents}
        onConfirm={() =>
          confirmCriticalEvents(criticalEvents.map((event) => event.key))
        }
      />

      {graceUntil !== null && criticalEvents.length > 0 ? (
        <CriticalAlertPinned
          events={criticalEvents}
          secondsLeft={graceSeconds}
          onConfirm={() =>
            confirmCriticalEvents(criticalEvents.map((event) => event.key))
          }
        />
      ) : null}
    </div>
  )
}
