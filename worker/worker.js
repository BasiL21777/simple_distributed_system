const amqp = require('amqplib');
const { Pool } = require('pg');
const crypto = require('crypto');

const SERVICE_NAME = process.env.SERVICE_NAME || 'worker';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const TASK_QUEUE = process.env.TASK_QUEUE || 'task_queue';
const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET || 'service-shared-secret';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://appuser:apppass@db:5432/auditdb';

const pool = new Pool({ connectionString: DATABASE_URL });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signMessage(body) {
  return crypto.createHmac('sha256', SERVICE_SHARED_SECRET).update(body).digest('hex');
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

      const channel = await conn.createChannel();
      await channel.assertQueue(TASK_QUEUE, { durable: true });
      channel.prefetch(1);

      console.log(`[${SERVICE_NAME}] connected to RabbitMQ`);
      return channel;
    } catch (err) {
      console.error(
        `[${SERVICE_NAME}] RabbitMQ not ready, retrying in 5 seconds...`,
        err.message
      );
      await sleep(5000);
    }
  }
}

(async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`[${SERVICE_NAME}] connected to PostgreSQL`);

    const channel = await connectRabbitWithRetry();

    console.log(`[${SERVICE_NAME}] waiting for messages...`);

    channel.consume(TASK_QUEUE, async (msg) => {
      if (!msg) return;

      try {
        const parsed = JSON.parse(msg.content.toString());
        const { body, metadata } = parsed;
        const computed = signMessage(body);
        const task = JSON.parse(body);
        const requestId = task.requestId;

        if (computed !== metadata.signature) {
          await logAudit({
            requestId,
            action: 'IDENTITY_VALIDATION_FAILED',
            status: 'failure',
            source: 'service',
            details: `from=${metadata.fromService}`
          });

          await logState({
            requestId,
            state: 'FAILED',
            status: 'failure'
          });

          channel.ack(msg);
          return;
        }

        await logAudit({
          requestId,
          action: 'MESSAGE_CONSUMED',
          status: 'success',
          source: 'service',
          details: `from=${metadata.fromService}`
        });

        await logState({
          requestId,
          state: 'CONSUMED'
        });

        await sleep(1500);

        if (task.payload && task.payload.forceFail === true) {
          throw new Error('Forced failure for testing');
        }

        await logAudit({
          requestId,
          action: 'TASK_PROCESSED',
          status: 'success',
          source: 'service',
          details: JSON.stringify(task.payload || {})
        });

        await logState({
          requestId,
          state: 'PROCESSED'
        });

        channel.ack(msg);
      } catch (err) {
        try {
          let requestId = null;

          try {
            const parsed = JSON.parse(msg.content.toString());
            const task = JSON.parse(parsed.body);
            requestId = task.requestId;
          } catch (_) {}

          await logAudit({
            requestId,
            action: 'WORKER_ERROR',
            status: 'failure',
            source: 'service',
            details: err.message
          });

          if (requestId) {
            await logState({
              requestId,
              state: 'FAILED',
              status: 'failure'
            });
          }
        } finally {
          channel.ack(msg);
        }
      }
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}] startup error`, err);
    process.exit(1);
  }
})();
