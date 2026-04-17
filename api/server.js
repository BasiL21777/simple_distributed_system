const express = require('express');
const jwt = require('jsonwebtoken');
const amqp = require('amqplib');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const SERVICE_NAME = process.env.SERVICE_NAME || 'api';
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const TASK_QUEUE = process.env.TASK_QUEUE || 'task_queue';
const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET || 'service-shared-secret';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://appuser:apppass@db:5432/auditdb';

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL });
let channel;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signMessage(body) {
  return crypto.createHmac('sha256', SERVICE_SHARED_SECRET).update(body).digest('hex');
}

async function connectRabbitWithRetry() {
  while (true) {
    try {
      console.log(`[${SERVICE_NAME}] trying to connect to RabbitMQ...`);
      const conn = await amqp.connect(RABBITMQ_URL);

      conn.on('error', (err) => {
        console.error(`[${SERVICE_NAME}] RabbitMQ connection error:`, err.message);
      });

      conn.on('close', () => {
        console.error(`[${SERVICE_NAME}] RabbitMQ connection closed`);
      });

      channel = await conn.createChannel();
      await channel.assertQueue(TASK_QUEUE, { durable: true });

      console.log(`[${SERVICE_NAME}] connected to RabbitMQ`);
      return;
    } catch (err) {
      console.error(
        `[${SERVICE_NAME}] RabbitMQ not ready, retrying in 5 seconds...`,
        err.message
      );
      await sleep(5000);
    }
  }
}

async function logAudit({ requestId = null, action, status, source, details = null }) {
  await pool.query(
    `INSERT INTO audit_logs (service_name, request_id, action, status, source, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [SERVICE_NAME, requestId, action, status, source, details]
  );
}

async function logState({ requestId, state, status = 'success' }) {
  await pool.query(
    `INSERT INTO request_states (request_id, service_name, state, status)
     VALUES ($1, $2, $3, $4)`,
    [requestId, SERVICE_NAME, state, status]
  );
}

app.get('/health', async (req, res) => {
  res.json({ ok: true, service: SERVICE_NAME });
});

app.get('/token', (req, res) => {
  const token = jwt.sign(
    { sub: 'demo-user', role: 'client' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.json({
    token,
    usage: 'Use this token in Authorization: Bearer <token>'
  });
});

app.post('/task', async (req, res) => {
  const requestId = uuidv4();

  try {
    await logAudit({
      requestId,
      action: 'REQUEST_RECEIVED',
      status: 'success',
      source: 'client',
      details: JSON.stringify(req.body || {})
    });

    await logState({ requestId, state: 'RECEIVED' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      await logAudit({
        requestId,
        action: 'JWT_MISSING',
        status: 'failure',
        source: 'client',
        details: 'Missing bearer token'
      });

      await logState({ requestId, state: 'FAILED', status: 'failure' });

      return res.status(401).json({
        error: 'Missing bearer token',
        requestId,
        service: SERVICE_NAME
      });
    }

    try {
      jwt.verify(token, JWT_SECRET);
    } catch (err) {
      await logAudit({
        requestId,
        action: 'JWT_INVALID',
        status: 'failure',
        source: 'client',
        details: err.message
      });

      await logState({ requestId, state: 'FAILED', status: 'failure' });

      return res.status(401).json({
        error: 'Invalid token',
        requestId,
        service: SERVICE_NAME
      });
    }

    await logAudit({
      requestId,
      action: 'JWT_VALIDATED',
      status: 'success',
      source: 'client',
      details: 'JWT validated successfully'
    });

    await logState({ requestId, state: 'AUTHENTICATED' });

    const task = {
      requestId,
      submittedByService: SERVICE_NAME,
      submittedAt: new Date().toISOString(),
      payload: req.body || {}
    };

    const body = JSON.stringify(task);
    const signature = signMessage(body);

    const envelope = JSON.stringify({
      body,
      metadata: {
        fromService: SERVICE_NAME,
        signature
      }
    });

    if (!channel) {
      throw new Error('RabbitMQ channel is not ready');
    }

    channel.sendToQueue(TASK_QUEUE, Buffer.from(envelope), { persistent: true });

    await logAudit({
      requestId,
      action: 'TASK_QUEUED',
      status: 'success',
      source: 'service',
      details: `Queued by ${SERVICE_NAME}`
    });

    await logState({ requestId, state: 'QUEUED' });

    res.status(202).json({
      message: 'Task accepted',
      requestId,
      service: SERVICE_NAME,
      nextState: 'QUEUED'
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}]`, err);

    try {
      await logAudit({
        requestId,
        action: 'API_ERROR',
        status: 'failure',
        source: 'service',
        details: err.message
      });

      await logState({ requestId, state: 'FAILED', status: 'failure' });
    } catch (_) {}

    res.status(500).json({
      error: 'Internal server error',
      requestId,
      service: SERVICE_NAME
    });
  }
});

app.get('/logs', async (req, res) => {
  const logs = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50');
  const states = await pool.query('SELECT * FROM request_states ORDER BY timestamp DESC LIMIT 50');

  res.json({
    service: SERVICE_NAME,
    auditLogs: logs.rows,
    states: states.rows
  });
});

(async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`[${SERVICE_NAME}] connected to PostgreSQL`);

    await connectRabbitWithRetry();

    app.listen(PORT, () => {
      console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}] startup error`, err);
    process.exit(1);
  }
})();
