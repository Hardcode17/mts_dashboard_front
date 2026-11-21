# MCC — фронтенд дашборда координатора

Рабочее место координатора массовых инцидентов. На одном экране видны сводка смены, очереди и сроки. В карточке можно проверить историю инцидента, зафиксировать следующий шаг и подготовить передачу дежурства.

**Локальное демо** запускается без корпоративных доступов. ITSM, уведомления, телеметрия и разбор агентом используют демонстрационные данные. **Режим с API** читает опубликованный снимок бэкенда и использует вход через Keycloak.

## Что демонстрирует

- **Сводку и очереди:** четыре группы со счётчиками, приоритеты, сроки, графики, журнал событий, поиск, фильтры, пагинацию и сохранённые представления.
- **Карточку INC:** данные ITSM и историю изменений, связанные инциденты, аварийную комнату, заметки, следующий шаг, передачу смены, сравнение мер восстановления и разбор причины агентом с ссылками на исходные наблюдения.
- **Координацию смены:** персональные назначения с таймером и переназначением, уведомления с квитанциями доставки, рекомендацию команды и сводку для принимающего дежурного.
- **Два демонстрационных набора:** «Большая смена» из 3600 карточек и 14 400 событий и «Кейс МТС» с 44 карточками из файла. Состояние, действия и отчёты сохраняются локально в SQLite.
- **Интеграционный режим:** OIDC-вход, загрузка списка и карточек из backend, проверка ревизии снимка и отображение устаревших данных. Режим API не изменяет инциденты.

Для первого прогона откройте карточку МТС Маркета `INC000021940112` в «Большой смене», затем попробуйте сравнить меры восстановления и открыть наблюдение в разборе агента. Пошаговый маршрут есть в [сценариях работы смены](docs/use-cases.md).

## Быстрый старт

Требуется Node.js 24 LTS и npm.

```sh
npm ci
npm run dev
```

Откройте [http://localhost:5173](http://localhost:5173). Backend и переменные окружения для демо не нужны: Vite поднимает локальный мок.

Полезные точки входа:

| Маршрут | Раздел |
|---|---|
| `#overview` | Сводка смены |
| `#queue/critical`, `#queue/assigned`, `#queue/high`, `#queue/research` | Очереди |
| `#desk/tasks` / `#desk/source` | Моя смена / выбор источника |
| `#events` | Общий журнал событий |
| `#incident/<ключ>` | Карточка инцидента в демо |
| `/incidents/<номер>` | Отдельная карточка из API |

На чистом профиле открывается «Большая смена». Переключение наборов — в «Моя смена» → «Источник данных». На исходном снимке «Кейса МТС» группы показывают 0, 2, 1 и 5 карточек. Для своего JSON и отдельного каталога состояния:

```sh
MCC_SOURCE_FILE=/absolute/path/to/incidents.json \
MCC_STATE_DIR=/absolute/path/to/state \
npm run dev
```

Файл проверяется каждую секунду, браузер опрашивает стенд каждые две секунды. Если файл временно сломан, остаётся последний корректный снимок. Без переменных состояние лежит в `.mcc-stand/workspace.sqlite`. Два браузера на одном стенде видят общую смену.

## Демо или backend/API

| | Локальная демонстрация | Backend/API |
|---|---|---|
| Запуск | `npm run dev` или `npm run preview` | `VITE_API_URL` либо `VITE_BACKEND_MODE=real` + `VITE_OIDC_AUTHORITY` |
| Источник данных | Встроенный мок и JSON-файл | Опубликованный снимок backend |
| Действия | Работают и сохраняются локально | Только чтение |
| Вход | Демонстрационный профиль | Keycloak, клиент `dashboard-web` |
| Состояние | SQLite на стенде | Снимок и статус backend |

## Локальный поиск маршрутизации (KAN-74)

В карточке на вкладке «Работа смены» есть отдельный блок «Поиск по локальной истории». Он появляется только при явном opt-in и обращается к локальному HTTP-адаптеру PostgreSQL + pgvector; это не демо-рекомендация и не продуктовый прокси. Порядок запуска адаптера и проверка реальной БД описаны в [инструкции в репозитории data](https://github.com/Hardcode17/mts_dashboard_data/blob/main/docs/co-coordinator.md).

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

Браузер делает запросы только на same-origin `/routing-advisor/*`; Vite dev/preview проксирует их на loopback-адрес. `ROUTING_ADVISOR_URL` принимается только для `127.0.0.1`, `localhost` или `[::1]`. Блок доступен в локальном режиме с `VITE_ROUTING_ADVISOR_ENABLED=true` и настроенным прокси Vite. Для раздачи через `npm start` используйте сборку без opt-in. В API-режиме (`VITE_API_URL`/`VITE_BACKEND_MODE=real`) блок скрыт. `server/start.mjs`, Compose и CI не меняются.

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

## Проверки

```sh
npm run lint
npm run build
npm test
```

`npm test` проверяет правила очередей и групп, обработку снимков, историю, таймеры назначений, контракт API и сохранение состояния после перезапуска. Браузерные сценарии запускаются отдельно:

```sh
npx playwright install chromium   # если Chromium ещё не установлен
npm run test:browser
```

`npm run test:browser` поднимает изолированные backend, PostgreSQL, Keycloak и
`itsm-mock`, собирает фронт и проверяет в Chromium вход PKCE, публикацию снимка,
четыре очереди, карточку, PATCH и «Увидел». Требования и параметры запуска —
в [инструкции KAN-73](tests/e2e/README.md). Это отдельная проверка, не часть workflow
прод-деплоя.

Для запущенного backend-прокси доступна проверка готовности:

```sh
curl -fsS http://localhost:3000/health
```

## Docker и автономный запуск

Docker-образ собирает статику в API-режиме и запускает `server/start.mjs` от пользователя `node`. Compose публикует приложение на `FRONTEND_PORT` и передаёт backend-адрес в контейнер.

На Raspberry Pi workflow **Deploy frontend** использует `compose.pi.yaml` и
подключает frontend к сети проекта `mts-dashboard-backend`. Сначала запустите
backend, чтобы Compose создал сеть и поднял Keycloak. Funnel направляет запросы
на frontend. Frontend передаёт публичные запросы realm `dashboard` и его ресурсов
из `/auth/` или `/keycloak/` в Keycloak, а `/auth/callback` обслуживает само приложение.

В Actions Variables фронтенда укажите `FRONTEND_OIDC_AUTHORITY` как
`https://<публичный-хост>/keycloak/realms/dashboard` (или с префиксом `/auth`).
Это значение должно совпадать
с `STAND_KEYCLOAK_URL` бэкенда с добавленным суффиксом `/realms/dashboard`.
`FRONTEND_BACKEND_URL` по умолчанию использует `http://backend:8080` в сети Docker.

```sh
BACKEND_URL=https://backend.example.test \
OIDC_AUTHORITY=https://auth.example.test/realms/dashboard \
FRONTEND_PORT=8080 \
docker compose up -d --build
```

Приложение: http://localhost:8080. Порт можно изменить переменной `FRONTEND_PORT`.
Проверка проксирования до реального бэкенда после старта:

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

### Памятка DevOps: фронт → API → ITSM

Проверено по конфигурации на **2026-11-21**. В прод-сборке фронт обращается к
`/api/**` на своём origin: `server/start.mjs` проксирует запросы на `BACKEND_URL`.
Мок-сервер фронта в Docker не нужен. Отдельный `itsm-mock` на бэкенде — это
внешний источник стенда: он отправляет полные JSON-снимки по REST и принимает
изменения карточек от бэкенда.

1. **Фронт (`Hardcode17/mts_dashboard_front`).** В Settings → Secrets and
   variables → Actions → Variables: `FRONTEND_OIDC_AUTHORITY` — публичный HTTPS
   URL realm, например `https://dashboard.example.test/keycloak/realms/dashboard`;
   `FRONTEND_BACKEND_URL` — `http://backend:8080` при общей Docker-сети
   `mts-dashboard-backend_default`. `FRONTEND_PORT` — порт публикации (по
   умолчанию `8080`). Не задавайте браузерному коду Docker-имя `backend`.
2. **Бэкенд (`Hardcode17/mts_dashboard_backend`).** Укажите `STAND_FRONTEND_URL`
   как публичный origin фронта, `STAND_KEYCLOAK_URL` — тот же публичный URL
   Keycloak без `/realms/dashboard`. Настройте в закрытом `BACKEND_ENV_FILE`
   `ITSM_INTEGRATION_AUTH_ISSUER=<STAND_KEYCLOAK_URL>/realms/dashboard`,
   `ITSM_INTEGRATION_AUTH_JWK_SET_URI=http://keycloak:8080/realms/dashboard/protocol/openid-connect/certs`,
   `ITSM_INTEGRATION_AUTH_AUDIENCE=itsm-ingest` и
   `ITSM_INTEGRATION_AUTH_CLIENT_ID=itsm-sender`. В realm проверьте, что
   `itsm-sender` имеет роль `itsm:import`. Секрет клиента не храните в репозитории,
   Actions Variables или логах; берите действующий `STAND_ITSM_SENDER_SECRET`
   из закрытого файла и передавайте сервису как `ITSM_MOCK_CLIENT_SECRET`.
3. **Деплой бэкенда на стенд.** После ревью и публикации backend-ветки KAN-65
   задайте Actions Variable `STAND_ENABLE_ITSM_MOCK=true` только на
   выделенном демостенде. По умолчанию шаг выключен. Существующий realm при
   перезапуске не переимпортируется: до включения проверьте, что секрет
   `itsm-sender` совпадает с runtime-файлом. Новый шаг явно собирает и
   запускает профильный сервис после готовности backend и Keycloak:

   ```sh
   docker compose --env-file "$BACKEND_ENV_FILE" --profile itsm-mock build --pull itsm-mock
   docker compose --env-file "$BACKEND_ENV_FILE" --profile itsm-mock up -d --no-build --no-deps --wait --wait-timeout 120 itsm-mock
   ```

   `DASHBOARD_ITSM_BASE_URL=http://itsm-mock:8080` — внутренний адрес для
   `GET /user` и `PATCH`. Если нужна внешняя кнопка «Открыть в ITSM», задайте
   `DASHBOARD_ITSM_LINK_TEMPLATE` с доступным браузеру HTTPS-адресом и
   `{incidentId}`; не публикуйте маршруты управления симулятором.
4. **Критерий готовности.** `/health` с фронта даёт `UP`, без токена
   `/api/dashboard/incidents` даёт `401`, старый `/api/stand/snapshot` — `404`.
   У отправителя проверяйте локальный `/api/mock/status`: отдельного `/health`
   у него нет. Дождитесь двух **новых** пакетов `SUCCEEDED` в бэкенде; у
   `/api/snapshot/status` после авторизации растёт `lastSuccessAt` и
   `stale=false`. Браузерные тесты с изменением карточки или «Увидел»
   запускайте только на изолированном тестовом стеке, не в workflow прод-деплоя.

   На runner два новых пакета можно проверить в PostgreSQL из этого Compose
   проекта; подставьте `ITSM_MOCK_SOURCE_ID` (по умолчанию `demo-itsm`) и время
   начала текущего деплоя в UTC:

   ```sql
   SELECT source_version, status, processed_at
   FROM itsm_ingest_batch
   WHERE source_id = '<ITSM_MOCK_SOURCE_ID>' AND status = 'SUCCEEDED'
   AND received_at >= TIMESTAMPTZ '<deploy-start-utc>'
   AND processed_at IS NOT NULL
   ORDER BY processed_at DESC LIMIT 2;
   ```

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
