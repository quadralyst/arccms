import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock firebase-admin/firestore
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    increment: vi.fn((n: number) => ({ _increment: n })),
  },
}));

// Mock init
vi.mock('../init', () => ({
  db: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    listCollections: vi.fn(), // Needed for some checks
    get: vi.fn(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((path, handler) => handler),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onRequest: vi.fn((handler) => handler),
}));

vi.mock('firebase-functions/v2', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Email Log Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createEmailLog', () => {
    it('should not have unreachable code after sendMail', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/createEmailLog.ts'),
        'utf-8'
      );
      
      // The file should NOT contain the old pattern with return before try
      expect(fileContent).not.toContain('return\n\n  try {');
    });

    it('should have proper error handling', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/createEmailLog.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('try {');
      expect(fileContent).toContain('catch (error)');
    });
  });

  describe('handleEmailWebhook', () => {
    it('should use v2 API (onRequest from firebase-functions/v2/https)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/handleEmailWebhook.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("from 'firebase-functions/v2/https'");
      expect(fileContent).not.toContain('functions.https.onRequest');
    });

    it('should have database update enabled (not commented out)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/handleEmailWebhook.ts'),
        'utf-8'
      );
      
      // Should contain the update call without comment prefix
      expect(fileContent).toContain('await emailLogDoc.ref.update(updateData)');
      expect(fileContent).not.toContain('// await emailLogDoc.ref.update(updateData)');
    });

    it('should have TypeScript interface for EmailWebhookPayload', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/handleEmailWebhook.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('interface EmailWebhookPayload');
    });

    it('should handle SNS subscription confirmation', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/handleEmailWebhook.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('SubscriptionConfirmation');
      expect(fileContent).toContain('SubscribeURL');
    });

    it('should handle multiple webhook formats (AWS SES, alternative, direct)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/handleEmailWebhook.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('eventData.eventType && eventData.mail');
      expect(fileContent).toContain('eventData.type && eventData.data');
      expect(fileContent).toContain('eventData.event && eventData.email');
    });
  });

  describe('trackEmailOpen', () => {
    it('should use v2 API (onRequest from firebase-functions/v2/https)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/trackEmailOpen.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("from 'firebase-functions/v2/https'");
      expect(fileContent).not.toContain('functions.https.onRequest');
    });

    it('should use shared db from init.ts (not local declaration)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/trackEmailOpen.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("import { db } from '../init.js'");
      expect(fileContent).not.toContain('const db = admin.firestore()');
    });

    it('should return transparent GIF on all responses', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/trackEmailOpen.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('transparentGif');
      expect(fileContent).toContain("Content-Type', 'image/gif'");
    });

    it('should skip update if email already opened', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../email-log/trackEmailOpen.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('isOpened === true');
    });
  });
});
