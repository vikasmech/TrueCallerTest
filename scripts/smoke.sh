#!/usr/bin/env bash
# Smoke test against a running API (port 4000). Uses the console mailer log at /tmp/api.log.
set -euo pipefail
API=http://localhost:4000
J="curl -s -b /tmp/cj -c /tmp/cj -H content-type:application/json"

login() { # $1 email -> sets cookie jar
  rm -f /tmp/cj
  : > /tmp/api.log.cursor
  $J -X POST $API/v1/auth/magic-link -d "{\"email\":\"$1\"}" >/dev/null
  sleep 0.5
  TOKEN=$(grep -o "token=[^ ]*" /tmp/api.log | tail -1 | cut -d= -f2)
  $J "$API/v1/auth/verify?token=$TOKEN"
  echo
  $J -X POST $API/v1/consent -d '{"noticeVersion":"2026-10-v1"}' -o /dev/null -w "consent %{http_code}\n"
}

echo "== sign in as admin"; login admin@example.com
echo "== lookup seeded strong number"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"+919000000001"}'; echo
echo "== lookup seeded some number"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"+919000000002"}'; echo
echo "== lookup unknown number"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"+919000009999"}'; echo
echo "== submit report"; R=$($J -X POST $API/v1/reports -d '{"idempotencyKey":"smoke-0001","phoneNumber":"98000 00011","channel":"call","category":"fraud","eventAt":"2026-10-08T10:00:00+05:30"}'); echo "$R"
echo "== replay same idempotency key"; $J -X POST $API/v1/reports -d '{"idempotencyKey":"smoke-0001","phoneNumber":"98000 00011","channel":"call","category":"fraud","eventAt":"2026-10-08T10:00:00+05:30"}'; echo
echo "== future event rejected"; $J -X POST $API/v1/reports -d '{"idempotencyKey":"smoke-0002","phoneNumber":"98000 00011","channel":"call","category":"fraud","eventAt":"2030-01-01T00:00:00Z"}'; echo
echo "== invalid number rejected"; $J -X POST $API/v1/reports -d '{"idempotencyKey":"smoke-0003","phoneNumber":"12345","channel":"call","category":"fraud","eventAt":"2026-10-08T10:00:00Z"}'; echo
sleep 2
echo "== lookup reported number (1 reporter -> insufficient)"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"+919800000011"}'; echo
echo "== my reports"; $J $API/v1/reports/mine; echo
ID=$(echo "$R" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "== withdraw $ID"; curl -s -b /tmp/cj -c /tmp/cj -X POST $API/v1/reports/$ID/withdraw -o /dev/null -w "%{http_code}\n"
echo "== dispute"; $J -X POST $API/v1/disputes -d '{"phoneNumber":"+919000000001","reason":"number_reassigned","details":"smoke"}'; echo
echo "== lookup shows dispute open"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"+919000000001"}' | grep -o '"dispute_status":"[a-z]*"'
echo "== moderator queue"; $J "$API/v1/admin/reports?status=accepted&limit=2"; echo
echo "== open disputes"; D=$($J "$API/v1/admin/disputes?status=open"); echo "$D"
DID=$(echo "$D" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "== uphold reassignment (new epoch)"; $J -X POST $API/v1/admin/disputes/$DID/decision -d '{"decision":"uphold_reassignment"}' -o /dev/null -w "%{http_code}\n"
sleep 2
echo "== lookup after epoch bump (should be insufficient)"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"+919000000001"}'; echo

KEY=$RANDOM
echo "== register + approve data source"
S=$($J -X POST $API/v1/admin/data-sources -d '{"provider":"Test Feed","provenanceGroupId":"feed-x","permittedUse":"pilot","permissionReference":"LIC-1","displayAllowed":true}')
SID=$(echo "$S" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4); echo "source $SID"
$J -X POST $API/v1/admin/data-sources/$SID/review -d '{"status":"approved"}' -o /dev/null -w "approve %{http_code}\n"
printf 'phone_number,category,observed_at,external_record_id,source_score,source_score_scale,expires_at\n9000000021,fraud,2026-09-15,r1,80,0-100,\n9000000021,fraud,2026-09-15,r1,80,0-100,\n9000000022,spam,2026-09-20,,,,\nbad,fraud,2026-09-15,,,,\n' > /tmp/import.csv
SUM=$(sha256sum /tmp/import.csv | cut -d' ' -f1)
echo "== upload import"
B=$(curl -s -b /tmp/cj -c /tmp/cj -X POST $API/v1/admin/imports -F sourceId=$SID -F idempotencyKey=smoke-import-$KEY -F mode=source_observation -F checksum=$SUM -F file=@/tmp/import.csv); echo "$B"
BID=$(echo "$B" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
sleep 3
echo "== preview"; $J $API/v1/admin/imports/$BID | grep -o '"state":"[a-z_]*"\|"rowCounts":{[^}]*}'
echo "== re-upload same key is idempotent"; curl -s -b /tmp/cj -c /tmp/cj -o /dev/null -w "%{http_code}\n" -X POST $API/v1/admin/imports -F sourceId=$SID -F idempotencyKey=smoke-import-$KEY -F mode=source_observation -F file=@/tmp/import.csv
echo "== row errors csv"; $J "$API/v1/admin/imports/$BID/errors?format=csv"
echo "== commit"; curl -s -b /tmp/cj -X POST $API/v1/admin/imports/$BID/commit | grep -o '"state":"[a-z_]*"'
sleep 3
echo "== committed"; $J $API/v1/admin/imports/$BID | grep -o '"state":"[a-z_]*"\|"processed":[0-9]*'
echo "== lookup imported number shows external signal, null community score"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"9000000021"}'; echo
echo "== rollback"; curl -s -b /tmp/cj -X POST $API/v1/admin/imports/$BID/rollback | grep -o '"state":"[a-z_]*"'
sleep 3
echo "== lookup after rollback"; $J -X POST $API/v1/lookup -d '{"phoneNumber":"9000000021"}' | grep -o '"external_signals":\[[^]]*\]'
echo "== done"
