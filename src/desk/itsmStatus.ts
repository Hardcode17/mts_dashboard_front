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
