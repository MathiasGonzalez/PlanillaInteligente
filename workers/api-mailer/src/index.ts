import { WorkerEntrypoint } from 'cloudflare:workers';
import { renderLoginCode } from '@planilla/email/login-code';

interface Env {
  EMAIL: {
    send(message: {
      to: string;
      from: string;
      subject: string;
      html: string;
      text: string;
    }): Promise<{ messageId?: string }>;
  };
  EMAIL_FROM: string;
}

export class Mailer extends WorkerEntrypoint<Env> {
  async sendLoginCode(payload: { to: string; code: string; expiresInMinutes: number }) {
    const message = await renderLoginCode({
      code: payload.code,
      expiresInMinutes: payload.expiresInMinutes,
    });
    try {
      const result = await this.env.EMAIL.send({
        to: payload.to,
        from: this.env.EMAIL_FROM,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (!result.messageId) return { messageId: null };
      console.log(JSON.stringify({ event: 'login_code_sent', messageId: result.messageId }));
      return { messageId: result.messageId };
    } catch {
      console.error(JSON.stringify({ event: 'login_code_failed' }));
      return { messageId: null };
    }
  }
}

export default {
  fetch() {
    return new Response('planilla mailer', { status: 200 });
  },
};
