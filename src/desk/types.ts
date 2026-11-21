import type {IncidentGroup} from '../entities/incident/model/api-types.ts'
import type {CardRevision} from '../incidentHistory.ts'

export interface Incident {
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
  assignedEmployeeLogin?: string | null
  solution?: string
  service?: string
  serviceType?: string
  description?: string
  impact?: string
  flags?: string[]
  dueAt?: number | null
  remainingSeconds?: number | null
  overdue?: boolean
  itsmUrl?: string
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
  title?: string
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
export interface IncidentAnalysis {
  evidence: {source: string; finding: string; record: string}[]
  hypothesis: string | null
  recipient: string
  question: string
  next: string
  scenario?: 'payment' | 'auth'
}
export interface Report {
  analysis?: IncidentAnalysis
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
}
export interface Desk {
  mode: Source
  version: number
  started: number
  seq: number
  records: Record<string, Incident>
  input: 'file' | 'upload'
  sourceError: string
  fileDigest?: string
  revisions: Record<string, CardRevision[]>
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
export function standNow(_desk: Pick<Desk, 'mode' | 'started'>, now: number): number {
  return now
}
export function dueInstant(i: Incident): number | null {
  return i.dueAt ?? null
}
export function emptyWork(): CardWork {
  return {notes: [], links: [], reports: []}
}
