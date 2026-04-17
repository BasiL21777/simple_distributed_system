# Secure Distributed System with Observability and Security Analysis

This project implements the assignment requirements on a single machine using Docker Compose.

## Included Components
- Nginx gateway
  - Reverse proxy
  - HTTPS
  - HTTP -> HTTPS redirect
  - Load balancing across 3 API instances
  - Rate limiting
- Three API instances (`api1`, `api2`, `api3`)
  - `/task` endpoint
  - JWT validation
  - UUID request tracking
  - Audit logging to PostgreSQL
  - RabbitMQ producer
- RabbitMQ message broker
- Worker service
  - Queue consumer
  - Service identity validation using HMAC signature
  - Processing + audit logging
- PostgreSQL database
  - `audit_logs`
  - `request_states`

## Architecture
Client -> Nginx -> API1/API2/API3 -> RabbitMQ -> Worker -> PostgreSQL

## Run
```bash
cd secure-distributed-system
docker compose up --build
```

## Services
- App gateway: `https://localhost`
- RabbitMQ UI: `http://localhost:15672`
  - username: `guest`
  - password: `guest`
- PostgreSQL:
  - host: `localhost`
  - port: `5432`
  - db: `auditdb`
  - user: `appuser`
  - password: `apppass`

## Get a demo JWT token
```bash
curl -k https://localhost/token
```

## Send a normal task
Linux/macOS:
```bash
TOKEN=$(curl -sk https://localhost/token | jq -r .token)
curl -k https://localhost/task \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task":"process-order","amount":100}'
```

PowerShell:
```powershell
$token = (Invoke-RestMethod -Uri https://localhost/token -SkipCertificateCheck).token
Invoke-RestMethod -Method Post -Uri https://localhost/task -SkipCertificateCheck `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"task":"process-order","amount":100}'
```

## Test load balancing
Send the request several times. The `service` field in the response will rotate among `api1`, `api2`, and `api3`.

## Test unauthorized access
```bash
curl -k https://localhost/task -H "Content-Type: application/json" -d '{"task":"fail-auth"}'
```
Expected: HTTP 401

## Test rate limiting
Send many rapid requests in a loop:
```bash
for i in {1..20}; do
  curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/token
  curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/task \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"task":"burst"}'
done
```
Expected: some responses become `503` from Nginx rate limiting.

## Inspect database logs
```bash
docker exec -it sds-db psql -U appuser -d auditdb -c "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 20;"
docker exec -it sds-db psql -U appuser -d auditdb -c "SELECT * FROM request_states ORDER BY timestamp DESC LIMIT 20;"
```

## MITM / Wireshark steps
### HTTP mode
1. Stop the stack.
2. Replace the Nginx config:
```bash
cp nginx/nginx-http-only.conf nginx/nginx.conf
```
3. Start again with `docker compose up --build`.
4. Capture traffic in Wireshark on port `80`.
5. Show readable headers, JWT, and JSON body.

### HTTPS mode
1. Restore secure config:
```bash
# Replace nginx.conf contents with the HTTPS version from this project
```
2. Start again.
3. Capture traffic on port `443`.
4. Show encrypted TLS traffic and unreadable payload.

## Suggested screenshots for submission
1. Load balancing responses from api1/api2/api3
2. RabbitMQ queue/messages in management UI
3. Database query results for `audit_logs` and `request_states`
4. Wireshark HTTP capture showing visible token/payload
5. Wireshark HTTPS capture showing encrypted TLS packets

## Notes
- This runs on one machine but is still a valid distributed-system simulation because each component is isolated in its own container.
- The worker verifies service identity via HMAC signature on the queued message.
- Use the same Request ID to trace the full lifecycle in the database.
