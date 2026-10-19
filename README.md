# MBR — Massive Bomj Roulette

Веб-приложение для ивента ЛБР: участники крутят колёса эффектов, бонусов, игр и фильмов, проходят или дропают игры и набирают очки. Судья подтверждает результаты, зрители смотрят вживую.

| Папка | Что внутри |
|---|---|
| [`docs/rules/`](docs/rules/README.md) | Правила игры — основной источник истины |
| [`docs/dev/`](docs/dev/README.md) | Как запустить и разрабатывать |
| `server/` | Backend на Go: API, вход через Discord, PostgreSQL |
| `web/` | Frontend на React + TypeScript |
| `deploy/` | Конфигурация Caddy для HTTPS |

Быстрый старт для разработки:

```bash
cp .env.example .env   # dev-вход уже включён
make db                # PostgreSQL в Docker на порту 5433
make dev-server        # Go-сервер на :8080
make dev-web           # в другом терминале: Vite на :5173
```

Откройте http://localhost:5173 и войдите под любым именем.
