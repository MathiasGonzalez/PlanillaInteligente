import { createDatabase } from '@planilla/cloudflare/d1';
import { isAppJobMessage, runAppJob, type AppJobMessage } from '@planilla/apps/jobs';

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(): void;
}

interface QueueBatch<T> {
  queue: string;
  messages: Array<QueueMessage<T>>;
}

function isDeadLetterQueue(queueName: string) {
  return queueName.endsWith('-dlq');
}

export default {
  async queue(batch: QueueBatch<AppJobMessage>, env: Cloudflare.Env) {
    if (isDeadLetterQueue(batch.queue)) {
      for (const message of batch.messages) {
        const body = message.body;
        console.error(JSON.stringify({
          event: 'app_job_dlq',
          tenantId: isAppJobMessage(body) ? body.tenantId : null,
          appId: isAppJobMessage(body) ? body.appId : null,
        }));
        message.ack();
      }
      return;
    }
    const db = createDatabase(env.DB);
    for (const message of batch.messages) {
      if (!isAppJobMessage(message.body)) {
        message.ack();
        continue;
      }
      const result = await runAppJob(db, env, env.BUCKET, message.body);
      if (result.status === 'failed') {
        message.retry();
        continue;
      }
      message.ack();
    }
  },
};
