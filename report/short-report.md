# Short Report – Secure Distributed System

## Objective
The system demonstrates a secure distributed architecture with HTTPS, load balancing, JWT authentication, asynchronous processing via RabbitMQ, request state tracking, rate limiting, audit logging, and a MITM comparison between HTTP and HTTPS.

## System Design
The client sends a request to Nginx. Nginx terminates HTTPS, applies rate limiting, and forwards the request to one of three API instances using load balancing. Each API validates the JWT token, generates a unique Request ID, stores logs and request states in PostgreSQL, and publishes the task to RabbitMQ. The worker consumes the task, validates the service identity using an HMAC signature, processes the task, and records additional logs and states.

## Security Controls
- HTTPS enabled in Nginx using a local self-signed certificate
- HTTP to HTTPS redirection
- JWT authentication on `/task`
- Rate limiting in Nginx
- Service identity validation between API and worker using HMAC
- Persistent audit logging in PostgreSQL

## Request States
The following states are recorded in the database:
- RECEIVED
- AUTHENTICATED
- QUEUED
- CONSUMED
- PROCESSED
- FAILED

## Testing Summary
- Normal authenticated requests succeed and receive a Request ID.
- Multiple requests show load balancing among api1, api2, and api3.
- Unauthorized requests return HTTP 401.
- Rapid bursts trigger Nginx rate limiting.
- RabbitMQ stores and delivers messages to the worker.
- PostgreSQL stores audit logs and request state transitions.

## MITM Analysis
In HTTP mode, traffic can be captured in Wireshark and sensitive values such as headers, JWT tokens, and request payloads are visible in plain text. In HTTPS mode, traffic is encrypted using TLS, and the payload and token are no longer readable. This demonstrates the security benefit of HTTPS against Man-in-the-Middle observation.

## Conclusion
The implementation satisfies the assignment goals by combining secure communication, distributed request handling, asynchronous processing, observability, and practical security validation.
