import type {OutageGroup, GroupReview, GroupDecisions} from './outageGroups.ts'
import type {DeadlineRisk} from '../deadlineRisk.ts'
import type {CardRevision} from '../incidentHistory.ts'
import type {IncidentGroup} from '../entities/incident/model/api-types.ts'

export interface Incident {
  sysId?: string
  assigneeLogin?: string
  meetingUrl?: string | null
  itsmUrl?: string | null
  itsmDemo?: boolean
  parentId?: string | null
  upstreamService?: string
  errorCode?: string
  key: string
  id: string
  title: string
  product: string
  team: string
  state: string
  registered: string
  due: string | null
  priority: number
  research: boolean
  assignedAt?: string
  restoredAt?: string
  assignee?: string
  solution?: string
  service?: string
  serviceType?: string
  description?: string
  impact?: string
  flags?: string[]
  dueAt?: number | null
  deadlineStatus?: {remainingSeconds: number; overdue: boolean; observedAt: number}
  deadlineRisk?: DeadlineRisk
  site?: string
  specialists?: number
  workMinutes?: number
  restoredEpoch?: number
  assignedEpoch?: number
  registeredAt?: number
  updatedAt?: number
  absent?: boolean
  groups?: IncidentGroup[]
}

export interface ShiftEvent {
  at?: number
  id: string
  key: string
  time: string
  kind: 'new' | 'assign' | 'due' | 'restore'
  change: string
}

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
/**
 * Официальные статусы контракта ITSM (KAN-57/KAN-58). Демосмена дополнительно
 * использует «В работе», которого нет в контракте, поэтому соответствие
 * берётся только по явной таблице, без угадывания.
 */
export type ItsmState = 'Assigned' | 'WorkInProgress' | 'Resolved' | 'Closed' | 'Research'
export const itsmStateLabels: Record<ItsmState, string> = {
  Assigned: 'Назначен',
  WorkInProgress: 'Выполняется',
  Resolved: 'Завершён',
  Closed: 'Закрыт',
  Research: 'Исследование ситуации',
}
const itsmStateEnums = Object.keys(itsmStateLabels) as ItsmState[]
export function itsmEnumForState(state: string): ItsmState | undefined {
  return itsmStateEnums.find((value) => itsmStateLabels[value] === state)
}
export interface DirectoryUser {
  sysId: string
  login: string
  name: string
  groupName: string
}
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
export const unknownTechnicalRecipient = 'Технический адресат не подтверждён'
export interface InvestigationAnalysis {
  evidence: {source: string; finding: string; record: string}[]
  hypothesis: string | null
  recipient: string
  question: string
  next: string
  scenario?: 'payment' | 'auth'
}
export interface Report {
  analysis?: InvestigationAnalysis
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
  if (i.groups) return i.groups.includes(queue === 'assigned' ? 'coordinators' : queue)
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
  clockBase?: number
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
  apiBeforeFirstSuccess?: boolean
  apiCounts?: {
    critical: number
    coordinators: number
    high: number
    research: number
  }
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
  if (i.absent) return false
  if (i.groups) return i.groups.includes('coordinators')
  return (active(i) || i.research) && (i.team === coordinatorGroup || i.team === 'Координаторы МИ')
}
export const moscowTime = (date: number) => new Date(date + 3 * 3600_000).toISOString().slice(11, 16)
export const fullTime = (date: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date)
export function standNow(d: Pick<Desk, 'started' | 'clockBase'>, now: number) {
  return d.clockBase === undefined ? now : d.clockBase + now - d.started
}
export function moscowClockInstant(clock: string, reference: number) {
  const offset = 3 * 3600_000
  const midnight = Math.floor((reference + offset) / 86400_000) * 86400_000 - offset
  const [h, m, s = '0'] = clock.split(':')
  return midnight + (+h * 3600 + +m * 60 + +s) * 1000
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
  return i.dueAt ?? null
}
export function emptyWork(): CardWork {
  return {notes: [], links: [], reports: []}
}
