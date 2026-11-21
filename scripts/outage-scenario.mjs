import {readFileSync, writeFileSync} from 'node:fs'

/** One upstream incident across eleven service consumers and one independent critical failure. */
export function outageScenario(now = Date.now()) {
  const [template] = JSON.parse(
    readFileSync(new URL('../mock/fixtures/incidents.json', import.meta.url), 'utf8'),
  )
  const targets = [
    'МТС Маркет',
    'МТС Premium',
    'МТС Линк',
    'KION',
    'МТС Банк',
    'Строки',
    'Мой МТС',
    'МТС Music',
    'МТС Cashback',
    'МТС Travel',
    'МТС Pay',
  ]
  return Array.from({length: 101}, (_, i) => {
    const shared = i < 100,
      product = shared ? targets[i % 11] : 'МТС Хранилище'
    const submit = new Date(now - 120000 + (i % 30) * 1000).toISOString()
    return {
      ...template,
      id: 'INC' + String(980000000000 + i),
      sysId: String(1980000000000000 + i),
      header: shared ? 'Не удаётся подтвердить вход · ' + product : 'Запись резервной копии остановилась',
      description: shared
        ? 'Внешний вызов возвращает ошибку; upstream=МТС ID; error=AUTH_TIMEOUT'
        : 'Исчерпано место в хранилище резервных копий',
      upstreamService: shared ? 'МТС ID' : 'Архив',
      errorCode: shared ? 'AUTH_TIMEOUT' : 'DISK_FULL',
      productName: product,
      productId: 'demo-product-' + (i < 100 ? i % 11 : 11),
      service: shared ? 'Вход · ' + product : 'Резервное копирование',
      serviceId: 'demo-service-' + (i < 100 ? i % 11 : 11),
      serviceType: 'Клиентский',
      state: 'Назначен',
      stateId: 1,
      stateEnum: 'Assigned',
      submitDate: submit,
      lastAssignmentToTeamDateTime: submit,
      deadline: new Date(now + (shared ? 22 : 11) * 60000).toISOString(),
      priorityId: 4,
      priority: 'Наивысший',
      completionDate: null,
      solution: null,
      assignedEmployee: null,
      assignedEmployeeLogin: null,
      assignedGroupName: 'Поддержка · ' + product,
      isMaster: false,
      isReason: false,
      isRootIncident: false,
      isDouble: false,
      isEffect: false,
    }
  })
}
if (import.meta.main) {
  const filename = process.argv[2]
  if (!filename) throw Error('Передайте путь нового файла демоснимка')
  writeFileSync(filename, JSON.stringify(outageScenario()), {flag: 'wx'})
}
