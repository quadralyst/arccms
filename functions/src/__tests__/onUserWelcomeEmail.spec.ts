/**
 * Tests for the welcome-on-signup trigger
 * (functions/src/users/onUserWelcomeEmail.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTemplateGet, mockQueueEmail } = vi.hoisted(() => ({
  mockTemplateGet: vi.fn(),
  mockQueueEmail: vi.fn().mockResolvedValue({ id: 'log-1', status: 'pending' }),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn(() => ({
      where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockTemplateGet }) }),
    })),
  },
}));

vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_path: string, handler: any) => handler),
}));

import { onUserCreateWelcomeEmail } from '../users/onUserWelcomeEmail.js';

const handler = onUserCreateWelcomeEmail as unknown as (event: any) => Promise<void>;

const template = {
  empty: false,
  docs: [{ data: () => ({ senderEmail: 's@x.com', senderName: 'S', subject: 'Welcome', template: 'hi ##NAME##', isActive: true }) }],
};

function event(user: any) {
  return { data: { data: () => user } };
}

describe('onUserCreateWelcomeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTemplateGet.mockResolvedValue(template);
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
  });

  it('queues a marketing welcome email for a new user', async () => {
    await handler(event({ email: 'new@user.com', name: 'New User' }));

    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
      source: 'auth',
      category: 'marketing',
      type: 'signup_welcome_email',
      toEmail: 'new@user.com',
      toName: 'New User',
      isSubscribed: true,
    }));
  });

  it('does nothing when the user has no email', async () => {
    await handler(event({ name: 'No Email' }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('does nothing when no welcome template exists', async () => {
    mockTemplateGet.mockResolvedValue({ empty: true, docs: [] });
    await handler(event({ email: 'x@y.com' }));
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('passes isSubscribed=false through when the user opted out', async () => {
    await handler(event({ email: 'x@y.com', isSubscribed: false }));
    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ isSubscribed: false }));
  });

  it('does not throw when queueEmail fails', async () => {
    mockQueueEmail.mockRejectedValue(new Error('boom'));
    await expect(handler(event({ email: 'x@y.com' }))).resolves.toBeUndefined();
  });
});
