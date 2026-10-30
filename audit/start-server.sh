#!/bin/zsh
# Usage: audit/start-server.sh <test|demo> <port>
# Starts `next start` from the .next-e2e build against the TEST or DEMO database (never dev).
set -e
mode=$1; port=$2
source <(grep -E '^(TEST_DATABASE_URL|DEMO_DATABASE_URL|APP_SECRET)=' .env | sed 's/^/export /')
if [[ $mode == test ]]; then export DATABASE_URL=$TEST_DATABASE_URL APP_ENV=test UPLOAD_DIR=./storage/e2e-uploads; fi
if [[ $mode == demo ]]; then export DATABASE_URL=$DEMO_DATABASE_URL APP_ENV=demo UPLOAD_DIR=./storage/demo-uploads; fi
[[ $DATABASE_URL == *menuniva_test* || $DATABASE_URL == *menuniva_demo* ]] || { echo "refusing"; exit 1; }
export NEXT_DIST_DIR=.next-e2e APP_BASE_URL=http://localhost:$port
exec npx next start --port $port
