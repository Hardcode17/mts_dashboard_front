import {createContext, useContext, useMemo} from 'react'
import type {DeskClient} from './useDesk'
import type {Incident} from '../demoData'
import {similarIncidents} from './correlation'
import type {Desk} from './types'
export const DeskContext = createContext<(DeskClient & {desk: Desk}) | null>(null)
export function useWorkspace() {
  const value = useContext(DeskContext)
  if (!value) throw Error('Рабочее место не загружено.')
  return value
}

export const RelatedIndex = createContext<Map<string, Incident[]>>(new Map())
export function useRelated(item: Incident) {
  const index = useContext(RelatedIndex)
  return useMemo(() => similarIncidents(index, item), [index, item])
}
