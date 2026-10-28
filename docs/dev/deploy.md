# Деплой

Приложение — это один Docker-образ (Go-сервер со встроенным фронтендом), PostgreSQL 17 и Caddy, который выпускает HTTPS-сертификат. Всё поднимается одним `docker compose`.

## Что нужно

- **Сервер с Docker** (Docker Engine + Compose v2). Хватит 1 vCPU и 1 ГБ памяти.
- **Домен**, у которого A-запись указывает на сервер. Порты 80 и 443 открыты: Caddy получает сертификат сам.
- **Приложение Discord** для входа (см. [README](README.md#вход-через-discord)). Redirect: `https://<домен>/auth/discord/callback`.

## Первый запуск

```bash
git clone https://github.com/eva-native/massive-bomj-roulette.git /srv/mbr
cd /srv/mbr
cp .env.example .env
```

Заполните `.env`:

```bash
MBR_BASE_URL=https://<домен>
MBR_DISCORD_CLIENT_ID=…
MBR_DISCORD_CLIENT_SECRET=…
MBR_ADMIN_DISCORD_IDS=<ваш Discord ID>   # кто может создавать ивенты
MBR_DEV_LOGIN=false                      # обязательно false в продакшене
```

Ваш Discord ID: включите в Discord «Режим разработчика» (Настройки → Расширенные), затем ПКМ по себе → «Копировать ID».

Строку `MBR_DATABASE_URL` из `.env` compose подменяет адресом своего контейнера PostgreSQL, трогать её не нужно. Пароль базы задан в `compose.yaml` (`POSTGRES_PASSWORD: mbr`). База не открыта наружу: порт `5433` слушает только localhost сервера. Если хотите сменить пароль, поменяйте его в `compose.yaml` в обоих местах до первого запуска.

```bash
export MBR_VERSION=$(git describe --tags --exact-match 2>/dev/null || git rev-parse HEAD)
MBR_DOMAIN=<домен> docker compose --profile app --profile prod up -d --build
docker compose logs -f app   # «mbr: listening» — готово
```

`MBR_VERSION` — тег релиза (или коммит), из которого собран образ. Ссылка «Правила» на сайте ведёт на правила этой версии на GitHub. Без него ссылка ведёт на ветку `main`.

Откройте `https://<домен>`, войдите через Discord и создайте ивент.

## Обновление

```bash
cd /srv/mbr
deploy/backup.sh                       # сначала бэкап
git pull
export MBR_VERSION=$(git describe --tags --exact-match 2>/dev/null || git rev-parse HEAD)
MBR_DOMAIN=<домен> docker compose --profile app --profile prod up -d --build
```

- **Миграции** применяются сами при старте.
- **Если изменились правила** (тексты, параметры или механика предметов), в журнал каждого идущего ивента запишется «Правила обновлены»: очки там всегда считаются по текущим правилам.
- **Завершённые ивенты не меняются:** их итоги заморожены.

Отпечаток правил видит тексты, флаги, поля и параметры предметов, а изменения внутри кода хуков — нет. Об изменении только логики хука в журнал ничего не запишется, хотя очки, как всегда, пересчитаются.

## Бэкапы

`deploy/backup.sh` делает `pg_dump` в `backups/mbr-<дата>.sql.gz` и хранит последние 14 копий. Количество задаёт `KEEP=30`, папку — `BACKUP_DIR=…`. Запуск каждую ночь через cron:

```cron
0 4 * * * cd /srv/mbr && deploy/backup.sh >> backups/backup.log 2>&1
```

Копии лучше дополнительно уносить с сервера, например `rclone` или `rsync` в облако.

Отдельный ивент можно сохранить и без доступа к серверу: судья нажимает «Скачать экспорт» в настройках ивента. Получится JSON со всем об ивенте, без адреса вебхука. Восстанавливать из него приложение не умеет: это архив, а не бэкап.

### Восстановление

```bash
cd /srv/mbr
docker compose stop app
gunzip -c backups/mbr-<дата>.sql.gz | docker compose exec -T db psql -U mbr -v ON_ERROR_STOP=1 mbr
docker compose start app
```

Дамп сделан с `--clean --if-exists`: он заменяет таблицы в существующей базе. Проверить копию, не трогая рабочую базу, можно восстановлением в отдельную базу:

```bash
docker compose exec -T db psql -U mbr -c "CREATE DATABASE mbr_check"
gunzip -c backups/mbr-<дата>.sql.gz | docker compose exec -T db psql -U mbr -v ON_ERROR_STOP=1 mbr_check
docker compose exec -T db psql -U mbr -c "DROP DATABASE mbr_check"
```

## Завершение ивента

Судья: ивент → «Настройки» → «Завершить ивент».
- Итоги и доски игроков замораживаются и дальше показываются из сохранённой копии.
- Крутить, вступать и менять результаты больше нельзя. Отменить завершение нельзя.

## Если что-то не так

- **`docker compose logs app`** — ошибки сервера. Сообщения `notify: discord webhook` означают, что не дошло уведомление в Discord. Игре это не мешает.
- **Вход через Discord возвращает на `/login?error=discord`.** Проверьте Redirect в приложении Discord: он должен совпадать с `MBR_BASE_URL` + `/auth/discord/callback` до символа.
- **Оверлей в OBS не обновляется.** Он получает события через SSE. Caddy из `deploy/Caddyfile` настроен держать поток открытым (`flush_interval -1`). За другим прокси нужно отключить буферизацию ответов.
