import {useState} from 'react'
import {Button, Text, type ButtonSize, type ButtonView} from '@gravity-ui/uikit'
import type {Incident} from './desk/types'
import {useWorkspace} from './desk/context'
import {investigationHref, isInvestigationReport} from './desk/analysisLinks'
import {usesRealBackend} from './shared/api/mode'

export function InvestigationAction({
  incident,
  size = 'l',
  view = 'action',
  repeat = false,
}: {
  incident: Incident
  size?: ButtonSize
  view?: ButtonView
  repeat?: boolean
}) {
  const {desk, act, actionError, busy} = useWorkspace()
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = desk.work[incident.key]?.reports.find(isInvestigationReport)
  if (usesRealBackend) {
    return <Button view={view} size={size} href={investigationHref(incident.key, desk.mode)}>Открыть расследование</Button>
  }
  if (latest && !repeat) {
    return (
      <Button view={view} size={size} href={investigationHref(incident.key, desk.mode, latest.id)}>
        Открыть разбор ИИ
      </Button>
    )
  }

  async function start() {
    const from = window.location.href
    setFailed(false)
    setRunning(true)
    const ok = await act({type: 'analyze', key: incident.key})
    setRunning(false)
    if (!ok) setFailed(true)
    if (ok && window.location.href === from) window.location.hash = investigationHref(incident.key, desk.mode)
  }

  return (
    <>
      <Button view={view} size={size} loading={running} disabled={busy} onClick={() => void start()}>
        {repeat && latest ? 'Повторить разбор' : 'Запустить разбор ИИ'}
      </Button>
      {failed && actionError && (
        <Text color="danger" role="alert">
          {actionError}
        </Text>
      )}
    </>
  )
}
