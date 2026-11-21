# MTS Dashboard Frontend

React + TypeScript + Vite с [Gravity UI](https://gravity-ui.com/libraries/uikit).
Рабочее место координатора MCC. Общий экран показывает критические инциденты, назначения, сроки и восстановления. Карточка объединяет историю ITSM, комнату, действия смены и разбор агента.

[Сценарии работы смены](docs/use-cases.md) · [Одна авария в двух окнах: группы INC, видеостена и ITSM](docs/outage-operations.md).

Основной интерфейс использует компоновку пульта Cerebro. В шапке видна активность за минуту, слева доступны рабочие маршруты и четыре очереди. На сводке видны ситуации, требующие внимания, графики, очереди и лента событий выбранного источника. «Очереди» прокручивают эту страницу к таблицам, а «Весь журнал» внизу ленты открывает историю смены. Обе темы доступны на всех экранах.

[Интерактивный прототип пульта смены в компоновке Cerebro](http://localhost:5187/prototype/cerebro/). Отдельная демоминута воспроизводит 300 входов и 300 выходов при 479 критических INC. Источники компоновки — [презентация авторов](https://github.com/aaangelmartin/Cerebro/blob/main/docs/pitch/cerebro-pitch.pdf) и [экран Home](https://github.com/aaangelmartin/Cerebro/blob/main/docs/img/dashboard/home.webp).

## Дизайн-система

- `src/theme/` — рабочая тема приложения: `mts-theme.css`, `fonts.css`,
  `mts-navigation.css` и шрифты `fonts/`. Подключается в `src/main.tsx` после
  стилей UIKit.
- `docs/design/mts-gravity/` — исходный пакет дизайна: `styles.json` и
  `styles-v2.json` для Themer, обе версии CSS-темы, шрифты, автономный
  предпросмотр `preview/index.html` и скриншоты. В сборку не попадает.

Проект использует `@gravity-ui/uikit` 8, поэтому в `src/theme/` взята
`mts-theme-v2.css` (структура токенов UIKit 7+). Вариант `mts-theme.css` для
UIKit 6 хранится в `docs/design/mts-gravity/` как справочный. Не подключайте обе
темы одновременно.

## Локальная разработка

Требуется Node.js 24 LTS и npm. Локальное рабочее место открывается на [127.0.0.1:5187](http://127.0.0.1:5187/?dataset=case#overview). Вход проходит через Keycloak с PKCE S256. Оба локальных имени, `localhost` и `127.0.0.1`, зарегистрированы для порта 5187 с точным путем `/auth/callback`.

Сервер отдает параметры входа по `GET /auth/config`. Для всех запросов к `/api/` нужен действующий пользовательский Bearer. Сервер проверяет его через защищенный `GET /api/me` Spring; при недоступной проверке данные остаются закрыты. В браузере токен хранится в памяти. Выбранный INC, набор данных и очередь сохраняются после возврата из Keycloak.

Для другой установки задайте на сервере `MCC_KEYCLOAK_URL`, `MCC_KEYCLOAK_REALM`, `MCC_KEYCLOAK_CLIENT_ID` и `MCC_AUTH_ME_URL`. По умолчанию это локальный Keycloak на 8084, realm `dashboard`, клиент `dashboard-web` и Spring на 8091. Для Docker задайте адрес Spring из сети контейнера и адрес Keycloak, доступный браузеру. Для другого origin зарегистрируйте полный callback и web origin в клиенте Keycloak.

```sh
npm ci
npm run dev
```

Откройте [сводку смены](http://localhost:5187). В разделе «Управление стендом» выберите набор данных. У каждого набора своя смена.

- **Большая смена** содержит 3600 инцидентов и 14 400 исходных событий. В карточке оплаты нажмите «Запустить разбор ИИ». Если отчёт уже сохранён, нажмите «Открыть разбор ИИ». В разделе «Основание и исходные записи» откройте наблюдение этого запуска. Для платежей доступен HTTP-эксперимент «Проверить на стенде». [Карточка оплаты](http://localhost:5187/incidents/INC000021940112?source=volume).
- **Кейс МТС** читает 44 карточки из `mock/fixtures/incidents.json`. На исходном снимке в четырёх группах соответственно 0, 2, 1 и 5 карточек. Для демонстрации с собственным файлом задайте `MCC_SOURCE_FILE=/абсолютный/путь/к/файлу.json` перед запуском. Сервер проверяет файл каждую секунду, браузер опрашивает сервер каждые две секунды. При ошибке предыдущий снимок остаётся доступен.
- **Новый крит** появляется в рабочем окне. «Увидел» подтверждает показанные сигналы. На видеостене видно, кто взял аварию. Персональное назначение дежурный принимает в «Моей смене». Через 60 секунд без ответа сервер ищет другого свободного координатора.
- **Wi-Fi в Ростове** запускается в «Управлении стендом». В карточке откройте «Похожие случаи» и проверьте основания связи с прошлым сбоем. В «Кому передать» согласуйте группу. Передача принятой задачи подставляет выбранную команду.
- **Карточка INC** открывается на вкладке «Обзор». Здесь видны срок, группа и исполнитель ITSM, координатор смены и ссылка на встречу. Вкладка «Хронология» объединяет события ITSM, смены и комнаты. Из обзора доступны заметки и действие «Передача смены».
- **Управление стендом** (`#stand`) содержит генератор критов и настройки каналов. Выберите INC, чтобы изменить условия его разбора (`#stand/agent/{key}`) или управлять демовстречей (`#stand/room/{key}`).

Действия, доставки, история и отчёты хранятся в SQLite в `.mcc-stand/workspace.sqlite`. Для отдельной демонстрации задайте другой `MCC_STATE_DIR`. Два браузера, подключённые к одному серверу и набору, видят одну смену. Демо-карточки, события и телеметрию отдаёт локальный сервер из `mock/fixtures/`; в клиентской сборке API-режима их нет. Для группировки можно подключить Ollama, для редактирования карточек — отдельный сервис ITSM. Журнал фиксирует доставку внутри стенда.

### Автоматические проверки

[Сценарии приёмки и ожидаемые результаты](docs/acceptance.md).

`npm test` проверяет правила смены, обработку выгрузки и сохранение состояния после перезапуска. `npm run test:browser` собирает приложение и проходит сценарии в Chromium. На машине без Chrome для macOS и без установленного Chromium выполните `npx playwright install chromium`. Браузерный сценарий переназначения ждёт реальные 60 секунд. Для регрессии используется изолированный тестовый провайдер входа. Проверка опубликованного стенда открывает настоящий Keycloak. Для входа и проверки формы ей можно передать `MCC_SMOKE_USERNAME`, `MCC_SMOKE_PASSWORD` и доверенный `MCC_KEYCLOAK_URL` через окружение.

```sh
npm run lint
npm run build
npm run preview
```

Исходники находятся в `src/`, статические файлы — в `public/`, результат сборки — в `dist/`.

## Рабочее место с подключением к Spring

После входа через Keycloak рабочее место читает опубликованный снимок Spring. Счётчики и состав очередей приходят из одного снимка. Координатор может переназначить INC через форму «Изменить в ITSM». Форма показывает подтверждение после ответа Spring на PATCH. Журнал смены, принятие аварии и состав группы хранятся на сервере фронтенда в SQLite. Все рабочие окна получают эти изменения при следующем опросе.

`workspace-live.sqlite` не является источником ITSM. Не удаляйте рабочий том до переноса заметок, внутренних назначений, групп, истории и личных пресетов и проверки восстановления. На демостенде полные снимки по-прежнему отправляет `itsm-mock` из backend-стека.

На сводке откройте настройку панелей для изменения порядка и видимости. Кнопка «Монитор» открывает видеостену. Карточка INC показывает связи и похожие случаи из Spring. [Контракт API](docs/api-contract.md)

## Локальный поиск маршрутизации (KAN-74)

В карточке в разделе маршрутизации есть отдельный блок «Поиск по локальной истории». Он появляется только при явном opt-in и обращается к локальному HTTP-адаптеру PostgreSQL + pgvector; это не демо-рекомендация и не продуктовый прокси. Порядок запуска адаптера и проверка реальной БД описаны в [инструкции в репозитории data](https://github.com/Hardcode17/mts_dashboard_data/blob/main/docs/co-coordinator.md).

```sh
# терминал 1: адаптер из data-worktree, слушает 127.0.0.1:8747
cd ../data/prototypes/routing-advisor
ROUTING_DSN='postgresql://routing_advisor:<пароль>@127.0.0.1:5447/routing_advisor' \
ROUTING_MODEL='intfloat/multilingual-e5-small' \
python server.py

# терминал 2: в этом worktree frontend, с same-origin прокси Vite
ROUTING_ADVISOR_URL=http://127.0.0.1:8747 \
VITE_ROUTING_ADVISOR_ENABLED=true \
npm run dev
```

Для preview сначала соберите фронтенд с клиентским флагом, затем запустите preview с серверным адресом:

```sh
VITE_ROUTING_ADVISOR_ENABLED=true npm run build
ROUTING_ADVISOR_URL=http://127.0.0.1:8747 VITE_ROUTING_ADVISOR_ENABLED=true npm run preview
```

Браузер делает запросы только на same-origin `/routing-advisor/*`; Vite dev/preview проксирует их на loopback-адрес. `ROUTING_ADVISOR_URL` принимается только для `127.0.0.1`, `localhost` или `[::1]`. Блок доступен в локальном режиме с `VITE_ROUTING_ADVISOR_ENABLED=true` и настроенным прокси Vite. Для раздачи через `npm start` используйте сборку без opt-in. В API-режиме (`VITE_API_URL`/`VITE_BACKEND_MODE=real`) блок скрыт.

### Подключение backend

1. В [репозитории бэкенда](https://github.com/Hardcode17/mts_dashboard_backend) запустите локальный стенд Keycloak, выдайте допуск координатору и загрузите тестовый снимок.
2. В realm должен быть публичный клиент `dashboard-web`. Разрешите origin фронтенда и callback `/auth/callback`.
3. Укажите адреса стенда и запустите dev-сервер:

```sh
VITE_API_URL=http://127.0.0.1:8091 \
VITE_OIDC_AUTHORITY=http://localhost:8084/realms/dashboard \
npm run dev -- --host localhost --port 3000
```

При `VITE_API_URL` Vite проксирует `/api` и `/health` на backend. Для локального адреса добавляйте в клиент Keycloak origin `http://localhost:3000` и callback `http://localhost:3000/auth/callback`.

`VITE_BACKEND_MODE=real` включает API-режим без прокси Vite: запросы идут на тот же origin. Такой режим предназначен для раздачи через `server/start.mjs` или Docker. Если authority не задан, приложение покажет экран с ошибкой конфигурации входа.

Основные маршруты контракта: `GET /api/dashboard/incidents`, `GET /api/dashboard/incidents/{id}`, `GET /api/snapshot/status`, `GET /api/me` и `GET /health`. Подробности — в [описании API-контракта](docs/api-contract.md) и [OpenAPI backend](https://github.com/Hardcode17/mts_dashboard_backend/blob/main/docs/dashboard-api.openapi.yaml).

### Переменные окружения

| Переменная | Где используется | Назначение |
|---|---|---|
| `VITE_API_URL` | dev / build | Origin API для прокси Vite; включает API-режим |
| `VITE_BACKEND_MODE=real` | dev / build | API-режим без прокси Vite |
| `VITE_OIDC_AUTHORITY` | dev / build | URL realm Keycloak, например `https://auth.example.test/realms/dashboard` |
| `VITE_ITSC_URL` | dev / build | Необязательный HTTPS-origin внешней ITSM-карточки |
| `VITE_ROUTING_ADVISOR_ENABLED` | dev / build | Явный opt-in локального поиска маршрутизации, только `true` |
| `ROUTING_ADVISOR_URL` | Vite dev / preview | Loopback-origin адаптера, по умолчанию не задан; в браузер не попадает |
| `BACKEND_URL` | `server/start.mjs` | Origin backend, обязателен для `npm start` |
| `PORT` | `server/start.mjs` | Порт статики и прокси, по умолчанию `3000` |
| `MCC_STATE_DIR` | локальный мок | Каталог SQLite |
| `MCC_SOURCE_FILE` | локальный мок | JSON для «Кейса МТС» |
| `FRONTEND_PORT` | Docker Compose | Публикуемый порт, по умолчанию `8080` |

## Docker и автономный запуск

Docker-образ собирает статику в API-режиме и запускает `server/start.mjs` от пользователя `node`. Compose публикует приложение на `FRONTEND_PORT` и передаёт backend-адрес в контейнер.

На Raspberry Pi фронтенд разворачивает workflow **Deploy backend** в общем
Compose-проекте `mts-dashboard-backend`. Выпускайте изменения фронтенда через
этот workflow после слияния в `main`. В репозитории фронтенда Actions
проверяет сборку.

Funnel направляет запросы на frontend. Запросы дашборда идут в бэкенд
по внутренней сети Docker. Запросы realm `dashboard` и его ресурсов frontend
передаёт в Keycloak, а `/auth/callback` обслуживает приложение. Публичный
OIDC authority и порт настраиваются в Actions Variables репозитория бэкенда.

```sh
BACKEND_URL=https://backend.example.test \
OIDC_AUTHORITY=https://auth.example.test/realms/dashboard \
FRONTEND_PORT=8080 \
docker compose up -d --build
```

Проверка после старта:

```sh
curl -fsS http://localhost:8080/health
```

Сборка и запуск без Docker:

```sh
VITE_BACKEND_MODE=real \
VITE_OIDC_AUTHORITY=https://auth.example.test/realms/dashboard \
npm run build

BACKEND_URL=https://backend.example.test npm start
```

Автоматическая публикация настроена в [workflow деплоя](.github/workflows/deploy.yml).


Данные координации сохраняются в томе Compose `workspace-data` в каталоге `/var/lib/mcc`. Для проверки локального набора на 5187 можно запустить `npm run build` и `PORT=5187 npm run start:stand` с локальным Keycloak и Spring.

## Структура и технологии

```text
src/       React-интерфейс, тема и API-клиент
mock/      локальный стенд, фикстуры и SQLite
server/    раздача dist/ и прокси API для контейнера
tests/     node:test и Playwright
docs/      сценарии, приёмка, контракт и дизайн
```

Интерфейс собран на React, TypeScript, Vite и Gravity UI. Локальный стенд использует Node.js и SQLite. Для тестов используются `node:test` и Playwright.

## Документация

- [Сценарии работы смены и маршрут демонстрации](docs/use-cases.md)
- [Условия приёмки](docs/acceptance.md)
- [Ревью интерфейса и границы проверки](docs/interface-review.md)
- [API-контракт фронтенда](docs/api-contract.md)
- [Исходный пакет дизайна Gravity UI × МТС](docs/design/mts-gravity/README.md)

## Репозитории проекта

| Репозиторий | Роль |
|---|---|
| [mts_dashboard_front](https://github.com/Hardcode17/mts_dashboard_front) | Интерфейс координатора и локальный демостенд |
| [mts_dashboard_backend](https://github.com/Hardcode17/mts_dashboard_backend) | API, доступ и приём снимков ITSM |
| [mts_dashboard_data](https://github.com/Hardcode17/mts_dashboard_data) | Материалы кейса, требования и контракты |
