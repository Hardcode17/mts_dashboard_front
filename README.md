# MTS Dashboard Frontend

React + TypeScript + Vite с [Gravity UI](https://gravity-ui.com/libraries/uikit).
Подключены стили, шрифты и `ThemeProvider`, на стартовой странице — компоненты `Text` и `Button`.

## Локальная разработка

Требуется Node.js 24 LTS и npm.

```sh
npm ci
npm run dev
```

Приложение: http://localhost:5173.

```sh
npm run lint
npm run build
npm run preview
```

Исходники находятся в `src/`, статические файлы — в `public/`, результат сборки — в `dist/`.

## Деплой через Docker

Требуется запущенный Docker Engine с поддержкой Linux-контейнеров и Docker Compose.
Из папки проекта:

```sh
docker compose up -d --build
```

Приложение: http://localhost:8080. Порт можно изменить переменной `FRONTEND_PORT`
в окружении или в локальном файле `.env`, например `FRONTEND_PORT=3000`.

Образ собирается в два этапа: Node.js собирает приложение, затем пакет `serve`
обслуживает готовую статику на порту 3000. Настроены SPA fallback и healthcheck `/`.
Контейнер работает от непривилегированного пользователя `node`.
Для запуска сборки без Docker: `npm run build`, затем `npm start` (http://localhost:3000).

```sh
docker compose logs -f frontend
docker compose down
```

После изменения исходников снова выполните `docker compose up -d --build`.
