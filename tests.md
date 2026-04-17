
## Health
```bash
# Test 1: Direct HTTPS health check
curl -k https://localhost:8443/health

# Test 2: See which API instance responds (run multiple times)
for i in {1..10}; do
  curl -k -s https://localhost:8443/health | jq '.service'
done

```

## Token

```bash
TOKEN=$(curl -k -s https://localhost:8443/token | jq -r '.token')
echo "Token: $TOKEN"

```

## Task

```bash
curl -k -X POST https://localhost:8443/task \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task": "process data", "userId": 123}'
```

# Rate limit
```bash
for i in {1..20}; do
  curl -k -s -o /dev/null -w "%{http_code}\n" https://localhost:8443/health
done | sort | uniq -c
```