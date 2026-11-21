import {createContext, useContext, useEffect, useState, type ReactNode} from 'react'
import {workspaceFetch} from '../../auth/session'
import {createIncidentPresetsApi, type IncidentPreset, type IncidentPresetSettings} from './api'

const api = createIncidentPresetsApi(workspaceFetch)

interface PresetsContextValue {
  items: IncidentPreset[] | undefined
  failed: boolean
  retry: () => void
  save: (settings: IncidentPresetSettings, id?: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

const PresetsContext = createContext<PresetsContextValue | null>(null)

export function IncidentPresetsProvider({enabled, children}: {enabled: boolean; children: ReactNode}) {
  const [items, setItems] = useState<IncidentPreset[]>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void api.list(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])).then(
      result => {if (!controller.signal.aborted) setItems(result)},
      () => {if (!controller.signal.aborted) setFailed(true)},
    )
    return () => controller.abort()
  }, [enabled, attempt])

  return <PresetsContext.Provider value={{
    items,
    failed,
    retry: () => {
      setFailed(false)
      setAttempt(value => value + 1)
    },
    save: async (settings, id) => {
      const saved = await api.save(settings, id)
      setItems(previous => id === undefined
        ? [...(previous ?? []), saved]
        : previous?.map(item => item.id === id ? saved : item))
    },
    remove: async id => {
      await api.remove(id)
      setItems(previous => previous?.filter(item => item.id !== id))
    },
  }}>{children}</PresetsContext.Provider>
}

export function useIncidentPresets() {
  const value = useContext(PresetsContext)
  if (!value) throw new Error('IncidentPresetsProvider is missing')
  return value
}
