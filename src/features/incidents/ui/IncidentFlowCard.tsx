import {Card, Text, getConfig} from '@gravity-ui/uikit'
import {useWorkspace} from '../../../desk/context'
import {incidentFlowForLastMinute} from '../model/incidentFlow'
import {incidentFlowMessages} from './incidentFlowMessages'

export function IncidentFlowCard() {
  const {incidentFlow, now, error, desk} = useWorkspace()
  const language = getConfig().lang === 'ru' ? 'ru' : 'en'
  const messages = incidentFlowMessages[language]
  const format = new Intl.NumberFormat(language)
  const available = incidentFlow && !error && !desk.sourceError
  const changes = available ? incidentFlowForLastMinute(incidentFlow, now) : null

  return <section aria-labelledby="incident-flow-heading">
    <Card view="outlined" className="mcc-glass overview-flow">
      <div className="overview-flow-heading">
        <Text as="h2" id="incident-flow-heading" variant="header-2">{messages.title}</Text>
        <Text color="secondary">{messages.window}</Text>
      </div>
      <dl className="overview-flow-values">
        <div>
          <Text as="dt" color="secondary">{messages.active}</Text>
          <Text as="dd" variant="display-2">{incidentFlow ? format.format(incidentFlow.activeCount) : '—'}</Text>
        </div>
        <div>
          <Text as="dt" color="secondary">{messages.arrived}</Text>
          <Text as="dd" color="info" variant="display-2">{changes ? '+' + format.format(changes.arrived) : '—'}</Text>
        </div>
        <div>
          <Text as="dt" color="secondary">{messages.completed}</Text>
          <Text as="dd" color="positive" variant="display-2">{changes ? '−' + format.format(changes.completed) : '—'}</Text>
        </div>
      </dl>
    </Card>
  </section>
}
