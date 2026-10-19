# Разработка

## Что нужно

- Go 1.26+
- Node.js 24+ и npm
- Docker (для PostgreSQL и сборки образа)

## Запуск

```bash
cp .env.example .env
make db          # PostgreSQL 17 в Docker, порт 5433
make dev-server  # Go-сервер на :8080, миграции применяются при старте
make dev-web     # Vite на :5173, проксирует /api и /auth на :8080
```

`make help` показывает все команды.

## Настройки (`.env`)

| Переменная | Что делает |
|---|---|
| `MBR_DATABASE_URL` | Строка подключения к PostgreSQL |
| `MBR_BASE_URL` | Публичный адрес приложения. От него зависит адрес возврата из Discord и флаг `Secure` у cookie (для `https://`) |
| `MBR_ADDR` | Адрес, который слушает сервер, по умолчанию `:8080` |
| `MBR_DISCORD_CLIENT_ID`, `MBR_DISCORD_CLIENT_SECRET` | Приложение Discord для входа |
| `MBR_ADMIN_DISCORD_IDS` | Discord ID через запятую. Эти пользователи могут создавать ивенты. Для dev-входа ID выглядит как `dev:<имя в нижнем регистре>` |
| `MBR_DEV_LOGIN` | `true` — вход под любым именем без Discord. **Только для разработки** |
| `MBR_SESSION_TTL` | Время жизни сессии, по умолчанию `720h` |

Нужен хотя бы один способ входа: Discord или dev-вход. Без этого сервер не запустится.

### Вход через Discord

1. Создайте приложение на https://discord.com/developers/applications.
2. В разделе **OAuth2** добавьте Redirect: `<MBR_BASE_URL>/auth/discord/callback`. Для локального запуска через Vite это `http://localhost:5173/auth/discord/callback`, и тогда `MBR_BASE_URL=http://localhost:5173`.
3. Скопируйте Client ID и Client Secret в `.env`.

Приложение запрашивает только scope `identify`: ник, аватар и ID.

## Тесты

```bash
make db
make test
```

Тесты с базой данных создают для себя отдельную базу на сервере из `MBR_TEST_DATABASE_URL` и удаляют её после себя. Если переменная не задана, такие тесты пропускаются. `make test-server` по умолчанию использует базу из `make db`.

## Генерация кода

После изменения SQL-запросов (`server/internal/store/queries`), миграций или типов API (`server/internal/api`) запустите:

```bash
make gen
```

- `sqlc` генерирует `server/internal/store/db`;
- `tygo` генерирует `web/src/api/types.gen.ts`.

Сгенерированный код хранится в git. CI проверяет, что он актуален.

Инструменты закреплены в отдельном модуле `server/tools/go.mod`, чтобы не тянуть их зависимости в приложение.

## Сборка и деплой

```bash
make build    # bin/mbr со встроенным фронтендом
make docker   # Docker-образ mbr
```

Продакшен через compose (приложение + PostgreSQL + Caddy с автоматическим HTTPS):

```bash
# в .env: MBR_BASE_URL=https://<домен>, MBR_DEV_LOGIN=false, данные Discord
MBR_DOMAIN=<домен> docker compose --profile app --profile prod up -d --build
```

## Устройство

- `server/cmd/mbr` — точка входа.
- `server/internal/config` — настройки из переменных окружения.
- `server/internal/store` — подключение к PostgreSQL, миграции (`goose`, встроены в бинарник), запросы (`sqlc`).
- `server/internal/auth` — вход через Discord, dev-вход, сессии. В cookie лежит случайный токен, в базе — только его SHA-256.
- `server/internal/httpapi` — маршруты `/api/*` и `/auth/*`, всё остальное отдаёт SPA.
- `server/internal/api` — типы запросов и ответов, из них генерируются TS-типы.
- `server/internal/webui` — встроенная сборка фронтенда.
- `web/src` — React-приложение: `api/` (клиент, хуки, типы), `pages/`, `components/`.
