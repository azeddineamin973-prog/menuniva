#!/bin/zsh
# PHASE F BACKUP: uses the project's own `npm run backup` / `npm run restore` commands.
# Source data: the fictitious DEMO database (backup is read-only). Restores go ONLY into two
# disposable databases created here (menuniva_audit_src, menuniva_audit_dst).
set -u
source <(grep -E '^(DEMO_DATABASE_URL)=' .env | sed 's/^/export /')
ADMIN_URL=${DEMO_DATABASE_URL%/*}/postgres
SRC=${DEMO_DATABASE_URL%/*}/menuniva_audit_src
DST=${DEMO_DATABASE_URL%/*}/menuniva_audit_dst
DIR=audit/backups; mkdir -p $DIR; chmod 700 $DIR
psqlx() { node -e "const pg=require('pg');const c=new pg.Client({connectionString:process.argv[1]});c.connect().then(()=>c.query(process.argv[2])).then(r=>{console.log(JSON.stringify(r.rows??[]));return c.end()}).catch(e=>{console.error('ERR',e.message);process.exit(1)})" "$@"; }
echo "== 1. create disposable databases"
for d in menuniva_audit_src menuniva_audit_dst; do psqlx $ADMIN_URL "DROP DATABASE IF EXISTS $d"; psqlx $ADMIN_URL "CREATE DATABASE $d"; done
for u in $SRC $DST; do DATABASE_URL=$u npx prisma migrate deploy > /dev/null || exit 1; done
echo "== 2. backup DEMO (read-only snapshot)"
npm run -s backup -- --url=$DEMO_DATABASE_URL --dir=$DIR --keep=5 | sed -E 's#sha256: [0-9a-f]{20}#sha256: …#'
F1=$(ls -t $DIR/menuniva_demo-*.ndjson.gz | head -1)
echo "== 3. restore DEMO backup into disposable SRC"
npm run -s restore -- --file=$F1 --url=$SRC --yes
echo "== 4. backup SRC, restore into disposable DST"
npm run -s backup -- --url=$SRC --dir=$DIR --keep=5 | sed -E 's#sha256: [0-9a-f]{20}#sha256: …#'
F2=$(ls -t $DIR/menuniva_audit_src-*.ndjson.gz | head -1)
npm run -s restore -- --file=$F2 --url=$DST --yes
echo "== 5. integrity: per-table row count + content hash, DEMO vs SRC vs DST"
node audit/db-compare.mjs $DEMO_DATABASE_URL $SRC $DST
echo "== 6. safety refusals"
echo "-- restore into a non-empty database:"; npm run -s restore -- --file=$F2 --url=$DST --yes; echo "exit=$?"
cp $F2 $DIR/corrupt.ndjson.gz; printf 'garbage' | dd of=$DIR/corrupt.ndjson.gz bs=1 seek=200 conv=notrunc 2>/dev/null
psqlx $ADMIN_URL "DROP DATABASE IF EXISTS menuniva_audit_empty"; psqlx $ADMIN_URL "CREATE DATABASE menuniva_audit_empty"; DATABASE_URL=${DEMO_DATABASE_URL%/*}/menuniva_audit_empty npx prisma migrate deploy > /dev/null
echo "-- restore a damaged file:"; npm run -s restore -- --file=$DIR/corrupt.ndjson.gz --url=${DEMO_DATABASE_URL%/*}/menuniva_audit_empty --yes; echo "exit=$?"
echo "-- restore without --yes:"; npm run -s restore -- --file=$F2 --url=${DEMO_DATABASE_URL%/*}/menuniva_audit_empty 2>&1 | sed -E 's#//[^@]+@#//***@#'; echo "exit=$?"
node audit/db-compare.mjs ${DEMO_DATABASE_URL%/*}/menuniva_audit_empty | tail -1
echo "== 7. drop disposable databases"
for d in menuniva_audit_src menuniva_audit_dst menuniva_audit_empty; do psqlx $ADMIN_URL "DROP DATABASE IF EXISTS $d"; done
rm -f $DIR/corrupt.ndjson.gz
