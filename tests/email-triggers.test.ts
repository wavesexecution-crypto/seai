import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db } from '../src/db/db.js';
import { config } from '../src/config.js';
import { setMailSender, resetMailSender, type MailSender } from '../src/mail/dispatch.js';
import {
  notifyChangeCompleted,
  notifyChangeReceived,
  notifyChangeStatus,
  notifyMaintenanceRequested,
  notifyWaitingForClient,
  notifyWebsiteIntake,
  notifyWelcome,
} from '../src/mail/notify.js';
import { listDeliveries, listEvents } from '../src/mail/store.js';
import type { OutgoingMail, SendResult } from '../src/mail/transport.js';

const sent: OutgoingMail[] = [];
const fakeSender: MailSender = async (mail: OutgoingMail): Promise<SendResult> => {
  sent.push(mail);
  return { messageId: '<notify@seai.store>', response: '250 OK' };
};

async function settle(): Promise<void> {
  // The notify helpers are fire-and-forget, so let their promises settle.
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
}

beforeAll(async () => {
  setMailSender(fakeSender);
  await db.init();
});

afterAll(async () => {
  resetMailSender();
  await db.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('lifecycle notifications', () => {
  it('sends a welcome email that mentions the customer name', async () => {
    notifyWelcome('welcome@example.com', 'Aarav Sharma', 'usr_welcome');
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('welcome@example.com');
    expect(sent[0].html).toContain('Aarav Sharma');
    const events = await listEvents({ event_name: 'account.welcome' });
    expect(events.some((e) => e.customer_id === 'usr_welcome')).toBe(true);
  });

  it('records a change request once and links it to the dashboard', async () => {
    notifyChangeReceived('change@example.com', 'Update the opening hours', 'Homepage', 'normal', 'req_notify_1', 'usr_change');
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('https://dash.seai.store/modify?id=req_notify_1');
  });

  it('sends one email per status transition and dedupes a repeat', async () => {
    const request = { id: 'req_notify_2', title: 'Swap the hero photo' };
    notifyChangeStatus('status@example.com', 'reviewing', request, 'usr_status');
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Reviewing');

    notifyChangeStatus('status@example.com', 'in_progress', request, 'usr_status');
    await settle();
    expect(sent).toHaveLength(2);

    // Same status again: no new email.
    notifyChangeStatus('status@example.com', 'in_progress', request, 'usr_status');
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('maps the completed and waiting helpers onto the right templates', async () => {
    notifyWaitingForClient('wait@example.com', 'Add a testimonial', 'req_notify_3', 'Send the testimonial text', 'usr_wait');
    notifyChangeCompleted('done@example.com', 'Add a testimonial', 'req_notify_3', 'usr_wait');
    await settle();
    const templates = sent.map((m) => m.headers?.['X-SEAI-Template']);
    expect(templates).toEqual(['change.waiting_for_client', 'change.completed']);
    expect(sent[0].html).toContain('Send the testimonial text');
  });

  it('sends the intake receipt with the plan and website name', async () => {
    notifyWebsiteIntake(
      'intake@example.com',
      { planName: 'Premium One-Page Website', websiteName: 'Sharma Dental Studio', domain: 'sharmadental.example.com', page: 'Homepage', summary: 'New clinic' },
      'usr_intake',
    );
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Premium One-Page Website');
    expect(sent[0].html).toContain('Sharma Dental Studio');
  });

  it('formats the maintenance price as an amount and asks for payment', async () => {
    notifyMaintenanceRequested('maint@example.com', 'Website Maintenance', 457, 'sub_1', 'usr_maint');
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('₹457');
  });

  it('routes every notification to the QA override when one is configured', async () => {
    config.mailQaRecipient = 'qa-inbox@example.com';
    try {
      notifyWelcome('real-customer@example.com', 'Aarav Sharma', 'usr_qa');
      await settle();
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('qa-inbox@example.com');
    } finally {
      config.mailQaRecipient = '';
    }
  });

  it('records a failed notification without throwing to the caller', async () => {
    setMailSender(async () => {
      throw new Error('provider unavailable');
    });
    expect(() => notifyWelcome('fail@example.com', 'Aarav Sharma', 'usr_fail')).not.toThrow();
    await settle();
    const deliveries = await listDeliveries({ recipient: 'fail@example.com' });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('failed');
    setMailSender(fakeSender);
  });
});
