# Деплой API — Cloudflare Workers + Supabase

Бесплатно на старте. Рассчитано на десяток тестовых пользователей.

## Почему именно это

Обычный «бесплатный сервер» (Render, Railway, Fly) здесь не подходит по одной
причине: симулятор парка тикает каждые 3 секунды и должен жить постоянно.
Бесплатные тарифы усыпляют процесс, а Render к тому же удаляет бесплатный
Postgres через 30 дней.

| Слой | Чем | Лимит бесплатного тарифа |
|---|---|---|
| API | Cloudflare Workers | 100 000 запросов/день |
| Симулятор парка | Durable Object `FleetSimulator` | входит в тот же тариф |
| Postgres + PostGIS | Supabase | 500 МБ, projects спят через неделю без запросов |
| Пул соединений | Cloudflare Hyperdrive | бесплатно |

Durable Object — это то, что делает схему рабочей: он держит состояние парка и
тикает без отдельного сервера.

## Что нужно от тебя

Два шага я выполнить не могу — оба требуют твоих учётных записей:

1. **Вход в Cloudflare.** `wrangler login` открывает браузер и просит
   подтвердить доступ к аккаунту.
2. **Проект Supabase** и строка подключения к нему.

Секреты (`wrangler secret put`) тоже ставишь ты — я не ввожу токены.

## Порядок

### 1. Supabase

Проект: **TIMURNASRIDDINOV's Project**, `yrbrwfvrtggdpparkviw`, AWS
`ap-south-1` (Мумбаи — до Ташкента ближе, чем Франкфурт). База пустая.

Если он на паузе — Resume project на странице проекта, восстановление занимает
несколько минут.

В SQL Editor включи PostGIS:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Строку подключения бери здесь: Connect → **Session pooler**, порт 5432.
Transaction pooler (6543) **не подойдёт** — Drizzle-миграции требуют
сессионного режима. Если пароль от базы забыт, он сбрасывается в
Settings → Database → Reset database password.

Положи строку в `.env` как `SUPABASE_DB_URL=...` — дальше все команды читают
её оттуда, и пароль не приходится вставлять в терминал.

### 2. Миграции и сид

```bash
set -a && . ./.env && set +a && DATABASE_URL="$SUPABASE_DB_URL" pnpm db:migrate
```

```bash
set -a && . ./.env && set +a && DATABASE_URL="$SUPABASE_DB_URL" pnpm db:seed
```

Сид детерминированный: те же 70 самокатов на тех же местах, три из них
намеренно за пределами зоны обслуживания.

### 3. Cloudflare

```bash
pnpm -F @scoot/api exec wrangler login
```

```bash
set -a && . ./.env && set +a && pnpm -F @scoot/api exec wrangler hyperdrive create scoot-db --connection-string="$SUPABASE_DB_URL"
```

Команда вернёт `id`. Впиши его в [`apps/api/wrangler.jsonc`](../apps/api/wrangler.jsonc)
вместо `TODO_SET_AFTER_wrangler_hyperdrive_create` — в **обоих** местах
(основной блок и `env.canary`).

### 4. Секреты

```bash
pnpm -F @scoot/api exec wrangler secret put JWT_SECRET
```

```bash
pnpm -F @scoot/api exec wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
pnpm -F @scoot/api exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

```bash
pnpm -F @scoot/api exec wrangler secret put DEV_ROUTES_SECRET
```

`DEV_ROUTES_SECRET` — минимум 16 символов, `openssl rand -hex 24`. См. раздел
про демо-контролы ниже: **без него `/dev/simulate/*` на деплое выключены.**

**Секреты ставятся на окружение, а не на проект.** `wrangler secret put` без
`--env` кладёт их в основной воркер; у `--env canary` свой отдельный набор.
Деплой canary без этого падает на старте с `JWT_SECRET: expected string,
received undefined`.

### 5. Проверка на canary, потом боевой деплой

Canary нужен, только когда боевой воркер уже работает и его нельзя ломать. На
первом деплое его можно пропустить и сразу катить основной:
`wrangler deploy --env=""`.

```bash
pnpm -F @scoot/api exec wrangler deploy --env canary
```

```bash
curl https://scoot-api-canary.<твой-субдомен>.workers.dev/health
```

Убедился — **удали canary**, иначе два симулятора будут гонять один и тот же
парк и состояние поедет:

```bash
pnpm -F @scoot/api exec wrangler delete --name scoot-api-canary
```

```bash
pnpm -F @scoot/api exec wrangler deploy
```

### 6. Вебхук Telegram

После деплоя переставь вебхук бота на новый адрес, иначе вход через Telegram
молча перестанет доходить:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -d "url=https://scoot-api.<твой-субдомен>.workers.dev/telegram/webhook" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 7. Клиенты

Пересобирать ничего не нужно. `apps/mobile/.env` и мини-апп уже указывают на
`scoot-api.<субдомен>.workers.dev` — этот адрес и занимает воркер.

## Обновление уже работающего деплоя

Первый деплой описан выше; здесь — что делать, когда база и воркер уже живут.

**Сид на боевой базе не запускать.** `db:seed` сначала делает TRUNCATE — на
задеплоенной базе это унесёт историю поездок, абонементы, платежи и
привязанные Telegram-аккаунты. Миграции применять можно и нужно, сид — нет.

```bash
set -a && . ./.env && set +a && DATABASE_URL="$SUPABASE_DB_URL" pnpm db:migrate
```

Миграции аддитивные (новая колонка, новое значение enum, индекс), поэтому
старый воркер продолжает работать на новой схеме — он просто не знает про
новые колонки. Порядок «сначала миграция, потом деплой» безопасен; обратный —
нет.

Затем воркер:

```bash
pnpm -F @scoot/api exec wrangler deploy
```

**Пока воркер не передеплоен, новых полей в ответах API не будет**, даже если
схема уже обновлена: код в воркере остаётся прежним.

Если новая фича добавляет данные, которых нет в базе (например зоны
ограничения скорости живут только в сиде) — заводи их через админку на
боевом адресе, а не через сид.

## Демо-контролы на публичном адресе

Деплой намеренно идёт с `NODE_ENV=production` **и** `DEV_FEATURES=true`:
SMS-провайдера пока нет, поэтому фиксированный OTP — единственный работающий
вход по телефону, а клиенты зависят от `/dev/simulate/*`.

Без защиты это означало бы, что любой, кто знает адрес, может запустить
поездку на чужом самокате, посадить батарею или увести самокат в оффлайн.
Поэтому в продакшене эти маршруты требуют заголовок:

```bash
curl -X POST https://scoot-api.<субдомен>.workers.dev/dev/simulate/ride -H "X-Dev-Secret: <DEV_ROUTES_SECRET>" -H 'Content-Type: application/json' -d '{"vehicle":"SCOOT-0005"}'
```

Если `DEV_ROUTES_SECRET` не задан — маршруты выключены целиком. Забыть про
секрет и оставить дыру нельзя.

Локально ничего не меняется: `pnpm dev` поднимает `NODE_ENV=development`, и
команды из README работают без заголовка.

## Проверка живого деплоя

```bash
curl -s https://scoot-api.timurnasriddinov56.workers.dev/health
```

Первый запрос после простоя может вернуть **530** — это холодный старт
Durable Object и Hyperdrive, а не поломка. Повтори через несколько секунд.

Состояние симулятора (нужен `X-Dev-Secret`, см. ниже):

```bash
curl -s https://scoot-api.timurnasriddinov56.workers.dev/dev/simulate/status -H "X-Dev-Secret: <DEV_ROUTES_SECRET>"
```

Ожидается `{"running":true,"tickMs":3000,...}`. Если `running:false` —
Durable Object заснул, любой запрос к API его разбудит.

## Что остаётся открытым

- **Вход по телефону — только `OTP_TEST_PHONES`** с фиксированным кодом, пока
  нет SMS-провайдера. Для реальных пользователей нужен провайдер (Eskiz,
  Play Mobile) — это отдельная работа.
- **Supabase на бесплатном тарифе засыпает** после недели без запросов. Первый
  запрос после сна идёт дольше обычного. Для теста это нормально.
- **Оплата — мок.** `PaymentProvider` всегда успешен, реального эквайринга нет.
