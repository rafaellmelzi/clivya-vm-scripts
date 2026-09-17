#!/bin/bash
set -euo pipefail
set -a; source /opt/clivya/.env; set +a
mkdir -p /opt/clivya
curl -fsSL "https://raw.githubusercontent.com/rafaellmelzi/clivya-vm-scripts/main/confirm-webhook.mjs" -o /opt/clivya/confirm-webhook.mjs
wc -c /opt/clivya/confirm-webhook.mjs
node --check /opt/clivya/confirm-webhook.mjs && echo SYNTAX_OK
grep -q CONFIRM_WEBHOOK_FORWARD_URL /opt/clivya/.env || echo 'CONFIRM_WEBHOOK_FORWARD_URL=https://clivya-live-ea34.vercel.app/api/webhooks/whatsapp/3354f9f2-a841-47a3-a3dc-eb8f5a56c920' >> /opt/clivya/.env
grep -q CONFIRM_WEBHOOK_PORT /opt/clivya/.env || echo 'CONFIRM_WEBHOOK_PORT=8091' >> /opt/clivya/.env
cat > /opt/clivya/start-webhook.sh <<'S'
#!/bin/bash
set -a; source /opt/clivya/.env; set +a
exec node /opt/clivya/confirm-webhook.mjs
S
chmod +x /opt/clivya/start-webhook.sh
pm2 delete clivya-confirm-webhook 2>/dev/null || true
pm2 start /opt/clivya/start-webhook.sh --name clivya-confirm-webhook
pm2 save
sleep 1
curl -sS http://127.0.0.1:8091/health; echo
INST=odontosaas-teste-721167
curl -sS -X POST -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
  "http://127.0.0.1:8080/webhook/set/$INST" \
  -d '{"webhook":{"enabled":true,"url":"http://127.0.0.1:8091/whatsapp-confirm","byEvents":false,"base64":false,"events":["MESSAGES_UPSERT","MESSAGES_UPDATE","MESSAGES_SET","CONNECTION_UPDATE"]}}'
echo
curl -sS -H "apikey: $EVOLUTION_API_KEY" "http://127.0.0.1:8080/webhook/find/$INST"; echo
pm2 status
pm2 logs clivya-confirm-webhook --lines 10 --nostream
