#!/usr/bin/env bash
# Записывает SUPABASE_DB_URL в .env, взяв пароль из буфера обмена.
#
# Пароль не набирается руками, не проходит через чат и нигде не печатается —
# он идёт из буфера прямо в файл. Спецсимволы percent-кодируются, иначе
# строка подключения распарсится неправильно.
#
#   1. В Supabase → Connect → Session pooler → Reset database password
#   2. Скопировать пароль
#   3. bash scripts/set-supabase-url.sh
set -euo pipefail

HOST="aws-1-ap-south-1.pooler.supabase.com"
PORT="5432"
USER="postgres.yrbrwfvrtggdpparkviw"
DB="postgres"
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Нет файла .env в текущей папке. Запускай из корня репозитория." >&2
  exit 1
fi

PASSWORD="$(pbpaste)"

# Буфер часто содержит хвостовой перевод строки — он ломает строку подключения.
PASSWORD="${PASSWORD%%$'\n'*}"
PASSWORD="${PASSWORD#"${PASSWORD%%[![:space:]]*}"}"
PASSWORD="${PASSWORD%"${PASSWORD##*[![:space:]]}"}"

if [ -z "$PASSWORD" ]; then
  echo "Буфер обмена пуст. Сначала скопируй пароль в Supabase." >&2
  exit 1
fi

case "$PASSWORD" in
  *" "*)
    echo "В буфере пробел — похоже, скопирован не пароль, а кусок текста." >&2
    exit 1
    ;;
  postgres*|*"@"*"."*"/"*)
    echo "В буфере, похоже, целая строка подключения, а не пароль." >&2
    echo "Скопируй только пароль." >&2
    exit 1
    ;;
esac

# Percent-encoding: @ : / ? # [ ] и прочее в пароле иначе развалят URL.
ENCODED="$(PW="$PASSWORD" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PW"], safe=""))')"

URL="postgresql://${USER}:${ENCODED}@${HOST}:${PORT}/${DB}"

# Убираем прежние строки и дописываем новую.
grep -v '^SUPABASE_DB_URL=' "$ENV_FILE" > "$ENV_FILE.tmp"
printf 'SUPABASE_DB_URL=%s\n' "$URL" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"

echo "Готово: SUPABASE_DB_URL записан (пароль ${#PASSWORD} символов, не показан)."
echo "Проверяю подключение…"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^scoot-db$'; then
  if docker exec -e PGURL="$URL" scoot-db psql "$PGURL" -tAc 'select 1' >/dev/null 2>&1 \
     || docker exec -i scoot-db env PGURL="$URL" psql "$URL" -tAc 'select 1' >/dev/null 2>&1; then
    echo "Подключение работает."
  else
    echo "Подключиться не удалось — вероятно, неверный пароль. Сбрось его и запусти снова." >&2
    exit 1
  fi
else
  echo "Локальный контейнер scoot-db не запущен — проверку подключения пропускаю."
fi
