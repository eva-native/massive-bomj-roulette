# Деплой

Приложение — это один Docker-образ (Go-сервер со встроенным фронтендом) и PostgreSQL 17. HTTPS даёт либо Caddy из того же `compose.yaml` (сертификат он выпускает сам), либо ваш собственный прокси. Образ каждого релиза опубликован в GHCR: `ghcr.io/eva-native/massive-bomj-roulette`. Клон репозитория, Node и Go на сервере не нужны.

## Что нужно

- **Сервер с Docker** (Docker Engine + Compose v2). Хватит 1 vCPU и 1 ГБ памяти.
- **Домен**, у которого A-запись указывает на сервер. С Caddy порты 80 и 443 должны быть открыты: Caddy получает сертификат сам. За своим прокси сертификат настраивается на нём.
- **Приложение Discord** для входа (см. [README](README.md#вход-через-discord)). Redirect: `https://<домен>/auth/discord/callback`.

## Первый запуск

Скачайте файлы нужного релиза (теги релизов — в [CHANGELOG](../../CHANGELOG.md)):

```bash
V=v0.3.0   # релиз, который ставите
mkdir -p /srv/mbr/deploy && cd /srv/mbr
base=https://raw.githubusercontent.com/eva-native/massive-bomj-roulette/$V
curl -fsSL -o .env $base/.env.example
for f in compose.yaml deploy/Caddyfile deploy/backup.sh; do curl -fsSL -o $f $base/$f; done
chmod +x deploy/backup.sh
```

Заполните `.env`:

```bash
MBR_BASE_URL=https://<домен>
MBR_DISCORD_CLIENT_ID=…
MBR_DISCORD_CLIENT_SECRET=…
MBR_ADMIN_DISCORD_IDS=<ваш Discord ID>   # кто может создавать ивенты
MBR_DEV_LOGIN=false                      # обязательно false в продакшене

MBR_VERSION=v0.3.0                       # какой релиз запущен
COMPOSE_PROFILES=app,prod                # приложение и Caddy
MBR_DOMAIN=<домен>                       # для сертификата Caddy
```

Ваш Discord ID: включите в Discord «Режим разработчика» (Настройки → Расширенные), затем ПКМ по себе → «Копировать ID».

`MBR_VERSION` — тег релиза. По нему compose берёт образ, а ссылка «Правила» на сайте ведёт на правила этой версии на GitHub. `MBR_VERSION`, `COMPOSE_PROFILES` и `MBR_DOMAIN` compose читает из `.env` сам, поэтому команды ниже обходятся без флагов.

Строку `MBR_DATABASE_URL` из `.env` compose подменяет адресом своего контейнера PostgreSQL, трогать её не нужно. Пароль базы задан в `compose.yaml` (`POSTGRES_PASSWORD: mbr`). База не открыта наружу: порт `5433` слушает только localhost сервера. Если хотите сменить пароль, поменяйте его в `compose.yaml` в обоих местах до первого запуска.

```bash
docker compose pull
docker compose up -d
docker compose logs -f app   # «mbr: listening» — готово
```

Откройте `https://<домен>`, войдите через Discord и создайте ивент.

Compose называет том с базой по имени папки (`/srv/mbr` → `mbr_pgdata`). Если перенесёте файлы в другую папку, задайте в `.env` `COMPOSE_PROJECT_NAME=mbr`, иначе поднимется пустая база.

### За своим прокси

Если на сервере уже есть nginx или другой прокси, Caddy не нужен: он занял бы порты 80 и 443. В `.env`:

```bash
COMPOSE_PROFILES=app                     # без Caddy
MBR_LISTEN=127.0.0.1:8001                # приложение слушает только localhost
```

`MBR_DOMAIN` и `deploy/Caddyfile` тогда не нужны. Прокси передаёт запросы на `127.0.0.1:8001` и не должен буферизовать ответы, иначе страница ивента и оверлей не получают изменения вживую (SSE). Для nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

## Обновление

```bash
cd /srv/mbr
deploy/backup.sh                         # сначала бэкап
V=v0.4.0                                 # новый релиз
base=https://raw.githubusercontent.com/eva-native/massive-bomj-roulette/$V
for f in compose.yaml deploy/Caddyfile deploy/backup.sh; do curl -fsSL -o $f $base/$f; done
sed -i "s/^MBR_VERSION=.*/MBR_VERSION=$V/" .env
docker compose pull app
docker compose up -d
```

- **`compose.yaml` и `deploy/`** скачиваются из того же тега, что и образ. `.env` не перезаписывается. Если в релизе появились новые настройки, они есть в `.env.example` этого тега и в CHANGELOG.
- **Миграции** применяются сами при старте.
- **Если изменились правила** (тексты, параметры или механика предметов), в журнал каждого идущего ивента запишется «Правила обновлены»: очки там всегда считаются по текущим правилам.
- **Завершённые ивенты не меняются:** их итоги заморожены.

Отпечаток правил видит тексты, флаги, поля и параметры предметов, а изменения внутри кода хуков — нет. Об изменении только логики хука в журнал ничего не запишется, хотя очки, как всегда, пересчитаются.

## Откат

Та же команда, что для обновления, с предыдущим тегом в `V`. Если в новом релизе были миграции базы (см. CHANGELOG), старая версия может не работать с новой схемой. Тогда после отката восстановите бэкап, сделанный перед обновлением (см. «Восстановление»). Действия в ивентах, сделанные после этого бэкапа, пропадут.

## Переход с git-клона

Если сервер уже работает из клона в `/srv/mbr`, папку можно оставить, база останется той же:

1. Верните `compose.yaml` к версии из репозитория: `git checkout -- compose.yaml`. Порт теперь задаётся через `MBR_LISTEN` в `.env`.
2. Добавьте в `.env` `MBR_VERSION`, `COMPOSE_PROFILES` и, если нужно, `MBR_DOMAIN` или `MBR_LISTEN` (см. выше).
3. `docker compose pull app && docker compose up -d`.

Дальше обновляйтесь, как описано выше: скачиванием файлов или `git checkout $V` в клоне. Пересобирать образ на сервере больше не нужно.

## Как публикуется образ

При пуше тега `vX.Y.Z` (его ставят на мерж `release/*` в `main`) workflow «Release image» (`.github/workflows/release.yml`) собирает образ и публикует его с тегами `vX.Y.Z`, `vX.Y` и `latest`. Внутри образа `MBR_VERSION=vX.Y.Z`, а метки OCI указывают на версию, коммит и репозиторий. Пре-релиз (`v0.3.0-rc.1`) получает только свой тег. Уже существующий тег можно опубликовать вручную: Actions → Release image → Run workflow. Для старого релиза снимите флажок `latest`.

Новый пакет в GHCR приватный. После первой публикации его один раз делают публичным: страница пакета → Package settings → Change visibility → Public. Если пакет оставить приватным, сервер должен войти в registry: `docker login ghcr.io -u <логин GitHub>` с personal access token с правом `read:packages`.

Собрать образ из исходников по-прежнему можно: `make docker` (образ `mbr`) или `docker compose --profile app up --build` в клоне. Во втором случае образ получает тег из `MBR_VERSION`, а без неё — `latest`.

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
