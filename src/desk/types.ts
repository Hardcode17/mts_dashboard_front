import type {Incident, ShiftEvent} from '../demoData.ts'
import type {OutageGroup, GroupReview, GroupDecisions} from './outageGroups.ts'
import type {CardRevision} from '../incidentHistory.ts'

export const channels = [
  'МТС Notifica',
  'МТС Линк',
  'Email',
  'SMS',
  'Push',
  'Telegram',
  'Mattermost',
  'MAX',
  'Мобильный хаб',
] as const
export type Channel = (typeof channels)[number]
export type Source = 'volume' | 'case'
export const coordinatorGroup = 'КЦ ИТ Координаторы Массовых Инцидентов'
export const priorityNames = ['Низкий', 'Средний', 'Высокий', 'Наивысший'] as const
export const states = [
  'Назначен',
  'Выполняется',
  'В работе',
  'Завершён',
  'Исследование ситуации',
  'Закрыт',
] as const
export interface Person {
  id: string
  name: string
  group: string
  available: boolean
  generation: number
}
export interface Attempt {
  id: string
  person: string
  generation: number
  assigned: number
  deadline: number | null
  accepted?: number
  ended?: number
  reason?: string
}
export interface Task {
  key: string
  opened: number
  finished?: number
  attempts: Attempt[]
}
export interface Notice {
  id: string
  key: string
  recipient: string
  text: string
  channel: Channel
  at: number
  status: 'Доставлено' | 'Ошибка' | 'Прочитано'
  tries: number
  attempt?: string
}
export interface Signal {
  id: string
  key: string
  at: number
  acknowledged?: number
}
export interface WorkNote {
  id: string
  author?: string
  text: string
  owner: string
  at: number
  kind: 'Заметка' | 'Следующий шаг' | 'Проверка'
  done: boolean
  due?: string
}
export interface RoomMember {
  role: string
  team: string
  invited: string
  joined?: string
  left?: string
  delivery: 'Доставлено' | 'Прочитано' | 'Нет данных' | 'Пропущено'
}
export interface Room {
  id: string
  members: RoomMember[]
  ended: boolean
  timeline?: {at: number; who: string; text: string}[]
  fragments: {at: string; who: string; text: string}[]
}
export interface Report {
  analysis?: ReturnType<typeof import('../agentDemo.ts').analyzeDemoIncident>
  id: string
  at: number
  title: string
  content: string
  revision: number
}
export interface CardWork {
  notes: WorkNote[]
  links: string[]
  reports: Report[]
  room?: Room
  dataObject?: string
  diagnosticsAt?: number
  dataInterval?: number
  lastRowAge?: number
  telemetryOffline?: boolean
  profile?: 'workers' | 'database'
  modelOffline?: boolean
  availability?: 'ready' | 'wait' | 'unknown'
  recommendation?: string
  recommendedTeam?: string | null
}
export const queueKeys = ['critical', 'assigned', 'high', 'research'] as const
export type QueueKey = typeof queueKeys[number]
export interface QueueMovement {
  id: string
  key: string
  queue: QueueKey
  at: number
  entered: boolean
  reason: string
}
export const queueWindowMs = 60_000

export function belongsToQueue(i: Incident | undefined, queue: QueueKey) {
  if (!i || i.absent) return false
  switch (queue) {
    case 'critical': return active(i) && i.priority === 4
    case 'assigned': return onCoordinators(i)
    case 'high': return active(i) && i.priority === 3
    case 'research': return i.research
  }
}

export interface Desk {
  monitorHistory?: import('../monitoring/summary.ts').MonitoringTimelinePoint[]
  mode: Source
  version: number
  started: number
  seq: number
  records: Record<string, Incident>
  input: 'file' | 'upload'
  sourceError: string
  fileDigest?: string
  revisions: Record<string, CardRevision[]>
  outageGroups?: OutageGroup[]
  outageDecisions?: Record<string, GroupDecisions>
  outageProposals?: GroupReview[]
  movements?: QueueMovement[]
  events: ShiftEvent[]
  signals: Signal[]
  quietUntil: number
  threshold: number
  warnings: Record<string, string>
  people: Person[]
  tasks: Task[]
  notices: Notice[]
  enabled: Channel[]
  failedChannels: Channel[]
  work: Record<string, CardWork>
  presets: Record<string, {name: string; href: string}[]>
  lastImport: number
  lastChanges: {id: string; fields: string[]}[]
  demoCount: number
}
export type Command = {
  type:
    | 'demo'
    | 'ack'
    | 'available'
    | 'accept'
    | 'handoff'
    | 'send'
    | 'retry'
    | 'read'
    | 'channels'
    | 'failChannels'
    | 'link'
    | 'unlink'
    | 'note'
    | 'toggleNote'
    | 'report'
    | 'room'
    | 'meetingEnd'
    | 'threshold'
    | 'preset'
    | 'removePreset'
    | 'edit'
    | 'upload'
    | 'watchFile'
    | 'diagnostics'
    | 'analyze'
    | 'experiment'
    | 'wifi'
    | 'advisor'
    | 'roomMember'
    | 'groupClaim'
    | 'groupAdd'
    | 'groupExclude'
  key?: string
  person?: string
  text?: string
  value?: string
  id?: string
  ids?: string[]
  channels?: Channel[]
  enabled?: boolean
  due?: string
  owner?: string
  kind?: string
  title?: string
  expected?: number
  number?: number
  age?: number
  data?: unknown
}
export function active(i: Incident) {
  return !i.research && !i.restoredAt && !['Завершён', 'Завершен', 'Закрыт'].includes(i.state)
}
export function technicalTeam(name?: string) {
  const trimmed = name?.trim() ?? ''
  return trimmed === coordinatorGroup || trimmed === 'Координаторы МИ' ? '' : trimmed
}

// Older decisions stored the team and an optional free-text comment in the same line.
export function approvedTeam(work?: CardWork, knownTeam = '') {
  if (work?.recommendedTeam !== undefined) return technicalTeam(work.recommendedTeam ?? '')
  const previous = work?.recommendation?.match(/^(?:Принято|Уточнено): (.+)$/u)?.[1]
  if (!previous) return ''
  if (knownTeam && (previous === knownTeam || previous.startsWith(knownTeam + ' · '))) return technicalTeam(knownTeam)
  return previous.includes(' · ') ? '' : technicalTeam(previous)
}

export function onCoordinators(i: Incident) {
  return (active(i) || i.research) && (i.team === coordinatorGroup || i.team === 'Координаторы МИ')
}
export const moscowTime = (date: number) => new Date(date + 3 * 3600_000).toISOString().slice(11, 16)
export const fullTime = (date: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date)
export function standNow(d: Pick<Desk, 'mode' | 'started'>, now: number) {
  return d.mode === 'case' ? now : Date.UTC(2026, 10, 21, 9, 42) + now - d.started
}
export function externalHttpAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url.href
  } catch {
    return null
  }
}
export function dueInstant(i: Incident) {
  return i.dueAt !== undefined ? i.dueAt : i.due ? Date.parse('2026-11-21T' + i.due + ':00+03:00') : null
}
export function emptyWork(): CardWork {
  return {notes: [], links: [], reports: []}
}
