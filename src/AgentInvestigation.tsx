import {Card, DefinitionList, Flex, Label, Link, Text} from '@gravity-ui/uikit'
import {fullTime, type Incident} from './desk/types'
import './AgentInvestigation.css'

export function AgentInvestigation({incident, cardHref}: {incident: Incident; cardHref: string}) {
  const registered = incident.registeredAt === undefined
    ? incident.registered
    : fullTime(incident.registeredAt)

  return (
    <Flex direction="column" gap="spacing-5" className="agent-investigation">
      <Link href={cardHref}>← Вернуться в карточку</Link>
      <Flex direction="column" gap="spacing-2">
        <Flex alignItems="center" gap="spacing-2" wrap>
          <Text variant="code-inline-1">{incident.id}</Text>
          <Label>{incident.state}</Label>
        </Flex>
        <Text as="h1" variant="display-2">Разбор инцидента</Text>
        {incident.title && <Text variant="body-2">{incident.title}</Text>}
      </Flex>

      <div className="agent-investigation-panels">
        <Card className="mcc-glass incident-panel">
          <Text as="h2" variant="header-1">Данные карточки ITSM</Text>
          <DefinitionList direction="vertical">
            <DefinitionList.Item name="Продукт">{incident.product}</DefinitionList.Item>
            <DefinitionList.Item name="Сервис">{incident.service || 'Не указан'}</DefinitionList.Item>
            <DefinitionList.Item name="Тип сервиса">{incident.serviceType || 'Не указан'}</DefinitionList.Item>
            <DefinitionList.Item name="Группа назначения">{incident.team || 'Не указана'}</DefinitionList.Item>
            <DefinitionList.Item name="Исполнитель">{incident.assignee || 'Не указан'}</DefinitionList.Item>
            <DefinitionList.Item name="Регистрация">{registered} МСК</DefinitionList.Item>
          </DefinitionList>
          {incident.description && (
            <Flex direction="column" gap="spacing-2">
              <Text as="h3" variant="subheader-2">Описание</Text>
              <Text as="p" className="agent-card-text">{incident.description}</Text>
            </Flex>
          )}
          {incident.solution && (
            <Flex direction="column" gap="spacing-2">
              <Text as="h3" variant="subheader-2">Решение в ITSM</Text>
              <Text as="p" className="agent-card-text">{incident.solution}</Text>
            </Flex>
          )}
        </Card>
        <Card className="mcc-glass incident-panel">
          <Text as="h2" variant="header-1">Телеметрия</Text>
          <Text as="p">Данные телеметрии по этому инциденту не получены.</Text>
          <Text as="p" color="secondary">По одной карточке ITSM нельзя подтвердить причину сбоя.</Text>
        </Card>
      </div>
    </Flex>
  )
}
