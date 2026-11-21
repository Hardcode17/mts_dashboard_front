# KAN-73: реальный браузерный сценарий

```sh
npm ci
npx playwright install chromium
npm run test:browser:live
```

Нужны Node.js 24+, JDK 21 и **локальный** Docker с Compose ≥ 2.24.4
(`!override`). По умолчанию backend берётся из `../mts_dashboard_backend`;
`MCC_E2E_BACKEND_DIR` позволяет указать другой локальный checkout. Для Linux-агента,
где не установлены системные зависимости Chromium, используйте
`npx playwright install --with-deps chromium`.

Если backend уже собран локально через `./gradlew :bootJar :itsm-mock:bootJar`,
можно не собирать те же приложения в Docker: задайте одновременно
`MCC_E2E_BACKEND_JAR=build/libs/dashboard-0.0.1-SNAPSHOT.jar` и
`MCC_E2E_ITSM_JAR=itsm-mock/build/libs/itsm-mock.jar` (пути относительно backend
или абсолютные). Compose запустит эти два jar в образе `eclipse-temurin:21-jdk-jammy`;
PostgreSQL и Keycloak всё равно запускаются отдельными контейнерами.

Runner использует backend `compose.yaml`, его `scripts/RenderRealm.java` и
`scripts/grant-coordinator.sql`. На каждый запуск создаются отдельный Compose-проект,
тома, случайные локальные пароли и временная сборка frontend. Backend, Keycloak
и `itsm-mock` доступны только по loopback; `server/start.mjs` отдаёт сборку и
проксирует настоящий backend. Если Docker Desktop не может привязать один из
автоматически выбранных портов, задайте `MCC_E2E_BASE_PORT`: runner использует
четыре последовательных свободных порта, начиная с указанного.
Планировщик `itsm-mock` отключён. Тест проверяет,
что у источника ещё не было публикаций и загружена только
[`itsm-fixture.json`](./itsm-fixture.json), затем запускает первую публикацию
через реальный `POST /api/mock/emit`. При завершении runner удаляет свой проект и тома.

В браузере проверяются требование bearer-токена, вход через Keycloak Authorization
Code + PKCE S256, серверные очереди и карточка, отсутствие телеметрии в разборе,
выбор исполнителя `demo2` из реального справочника и `PATCH` группы, статуса и
исполнителя с подтверждением в UI. Результат сверяется отдельными `GET` в backend
и `itsm-mock`. Повторное открытие синтетического P4 порождает реальное событие
смены; «Увидел» отправляет его точный `eventId` и убирает его из очереди. Также
проверяется `404` для старых `/api/stand/snapshot` и `/api/stand/action`, и что
сама SPA ни разу не запрашивала `/api/stand/*`. Сетевые ответы браузера не подменяются.

## Запуск против уже подготовленного локального стека

`node --test tests/e2e/real-backend.browser.mjs` ожидает:

| Переменная | Значение |
| --- | --- |
| `MCC_E2E_ISOLATED` | `1`, явный допуск на запись только в одноразовые тестовые данные |
| `MCC_E2E_FRONTEND_URL` | loopback-origin шлюза, например `http://127.0.0.1:3000` |
| `MCC_E2E_OIDC_AUTHORITY` | loopback-issuer Keycloak, например `http://127.0.0.1:8084/realms/dashboard` |
| `MCC_E2E_ITSM_URL` | loopback-origin `itsm-mock`, например `http://127.0.0.1:8082` |
| `MCC_E2E_USERNAME` / `MCC_E2E_PASSWORD` | данные локального координатора с допуском по `(issuer, sub)` |

Frontend собирается с `VITE_BACKEND_MODE=real`, пустой `VITE_API_URL` и
`VITE_OIDC_AUTHORITY`, равной `MCC_E2E_OIDC_AUTHORITY`. Для `server/start.mjs` задайте `BACKEND_URL` на
loopback-origin backend и `PORT` шлюза; `KEYCLOAK_URL` не задаётся (браузер
ходит в локальный Keycloak напрямую). В realm регистрируются origin
frontend и `/auth/callback`. В `itsm-mock` укажите `ITSM_MOCK_SCHEDULED=false`,
`ITSM_MOCK_SOURCE_ID=kan73-frontend-e2e`, эту фикстуру и отдельный машинный
клиент `itsm-sender`. До теста нельзя публиковать снимок.

Без любого из обязательных значений тест явно пропускается. Не запускайте этот
сценарий против общих данных и никогда не добавляйте его в workflow production.
Offline-проверки контракта: `node --test tests/incident-api.test.mjs` или `npm test`.
`tests/acceptance.browser.mjs` — отдельная dev-регрессия с моками; её результат
не подтверждает работоспособность реального backend.
