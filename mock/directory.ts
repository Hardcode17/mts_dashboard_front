import type {Desk, DirectoryUser, Source} from '../src/desk/types.ts'

// Дежурные справочника ITSM (GET /user из контракта KAN-57): стабильные логины,
// по группам демосмены. Текущие исполнители карточек добавляются динамически,
// чтобы существующее назначение всегда было видно и выбрасываемо в UI.
const dutyRoster: DirectoryUser[] = [
  {sysId: 'user-auth-1', login: 'auth1', name: 'Марат Ветров', groupName: 'Команда авторизации'},
  {sysId: 'user-auth-2', login: 'auth2', name: 'Ольга Рябинина', groupName: 'Команда авторизации'},
  {sysId: 'user-video-1', login: 'video1', name: 'Илья Северов', groupName: 'Поддержка видео'},
  {sysId: 'user-video-2', login: 'video2', name: 'Ксения Лаврова', groupName: 'Поддержка видео'},
  {sysId: 'user-sub-1', login: 'sub1', name: 'Артём Гуров', groupName: 'Поддержка подписок'},
  {sysId: 'user-sub-2', login: 'sub2', name: 'Наталья Полянская', groupName: 'Поддержка подписок'},
  {sysId: 'user-notify-1', login: 'notify1', name: 'Виктор Штерн', groupName: 'Команда уведомлений'},
  {sysId: 'user-notify-2', login: 'notify2', name: 'Алиса Морозова', groupName: 'Команда уведомлений'},
  {sysId: 'user-loyal-1', login: 'loyal1', name: 'Егор Зарайский', groupName: 'Поддержка лояльности'},
  {sysId: 'user-loyal-2', login: 'loyal2', name: 'Диана Крылова', groupName: 'Поддержка лояльности'},
  {sysId: 'user-pay-1', login: 'pay1', name: 'Роман Банников', groupName: 'Команда платежей'},
  {sysId: 'user-pay-2', login: 'pay2', name: 'Светлана Истомина', groupName: 'Команда платежей'},
  {sysId: 'user-order-1', login: 'order1', name: 'Пётр Каменев', groupName: 'Команда заказов'},
  {sysId: 'user-deliver-1', login: 'deliver1', name: 'Инна Ветлугина', groupName: 'Команда доставки'},
  {sysId: 'user-net-1', login: 'net1', name: 'Тимур Ростовский', groupName: 'Сетевая поддержка · Ростов'},
  {sysId: 'user-net-2', login: 'net2', name: 'Алина Волгина', groupName: 'Сети · Москва'},
]

export function userDirectory(desks: Map<Source, Desk>): DirectoryUser[] {
  const byLogin = new Map<string, DirectoryUser>()
  const names = new Set<string>()
  function add(user: DirectoryUser) {
    if (byLogin.has(user.login) || names.has(user.name)) return
    byLogin.set(user.login, user)
    names.add(user.name)
  }
  for (const user of dutyRoster) add(user)
  for (const desk of desks.values()) {
    for (const person of desk.people)
      add({sysId: 'user-' + person.id, login: person.id, name: person.name, groupName: person.group})
    for (const incident of Object.values(desk.records))
      if (incident.assignee)
        add({
          sysId: 'user-ext-' + incident.key,
          login: 'ext-' + incident.key,
          name: incident.assignee,
          groupName: incident.team || 'Внешние исполнители',
        })
  }
  return [...byLogin.values()]
}

export function directoryLogin(users: DirectoryUser[], name: string | undefined) {
  return name ? users.find((user) => user.name === name)?.login : undefined
}
