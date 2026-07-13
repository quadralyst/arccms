// waitlists/onWaitlistsCreate.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';

export const onWaitlistsCreate = onDocumentCreated('Waitlists/{waitlistsId}', async (event: any) => {
  const waitlistsId = event.params.waitlistsId;

  // Fetch email settings
  const settingsRef = db.collection('Settings').doc('email');
  const settingsSnap = await settingsRef.get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  const senderName = settings?.senderName || '';
  const senderEmail = settings?.senderEmail || '';
  const currentYear = new Date().getFullYear();

  const templates = [
    {
      template: `<div class="container" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
  <div class="header" style="background-color: #2c3e50; color: #ffffff; text-align: center; padding: 40px 20px;">
    <h1 style="margin: 0; font-size: 28px; font-weight: 700;">
      You're on the ##WAITLIST## Waitlist!
    </h1>
  </div>
  <div class="content" style="padding: 40px; text-align: center; color: #34495e; line-height: 1.6;">
    <p style="margin: 0 0 20px; font-size: 16px;">
      Hello,
    </p>
    <p style="margin: 0 0 20px; font-size: 16px;">
      Thank you for joining our waitlist! We're excited to have you. You can check your progress and see your rank on the leaderboard by clicking the links below.
    </p>
    <a href=##REFERRAL_LINK## style="display: inline-block; text-decoration: none; color: #ffffff; font-weight: 600; font-size: 16px; padding: 12px 24px; border-radius: 8px; margin: 10px; background-color: #3498db;">
      Your Referral Link
    </a>
    <a href=##LEADERBOARD_LINK## style="display: inline-block; text-decoration: none; color: #ffffff; font-weight: 600; font-size: 16px; padding: 12px 24px; border-radius: 8px; margin: 10px; background-color: #3498db;">
      Waitlist Leaderboard
    </a>
    <p style="margin: 0 0 20px; font-size: 16px; margin-top: 32px;">
      We'll notify you as soon as your spot is ready.
    </p>
    <p style="margin: 0 0 20px; font-size: 16px;">
      Best regards,
      <br>
      The Team
    </p>
<br>
---
<br>
<span style="font-size: 10px; color: #777777;">
  You are receiving this email because you signed up.
  <br>
  If you no longer wish to receive these emails, please
  <a href="##UNSUBSCRIBE_LINK##" style="color: #777777;">
    unsubscribe here
  </a>
  .
</span>
  </div>
  <div class="footer" style="text-align: center; padding: 20px; font-size: 12px; color: #9baec8; border-top: 1px solid #e2e8f0;">
    <p style="margin: 0; font-size: 12px; color: #9baec8;">
      © ${currentYear}. All rights reserved.
    </p>
  </div>
</div>
`,
      subject: 'Waitlist welcome email',
      title: 'Waitlist welcome email',
      createdAt: new Date(),
      previewText: '',
      senderName: senderName,
      createdBy: 'system',
      modifiedAt: new Date(),
      modifiedBy: 'system',
      type: 'waitlist_welcome_email',
      senderEmail: senderEmail,
    },
    {
      modifiedAt: new Date(),
      senderEmail: senderEmail,
      senderName: senderName,
      createdBy: 'system',
      template: `<div class="container" style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; padding: 40px; box-sizing: border-box;">
  <div class="header" style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb;">
    <h1 style="font-size: 24px; font-weight: 600; color: #1f2937; margin: 0;">
      ##OTP##Verification Code
    </h1>
  </div>
  <div class="content" style="padding: 30px 0; text-align: center;">
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      Hello,
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      You have requested to join our waitlist. Please use the following One-Time Password (OTP) to verify your email address. This code is valid for 15 minutes.
    </p>
    <div class="otp-code" style="display: inline-block; background-color: #e0f2fe; color: #0369a1; font-size: 32px; font-weight: 600; letter-spacing: 4px; padding: 15px 30px; border-radius: 8px; margin-bottom: 20px; border: 2px dashed #93c5fd;">##OTP##
      
    </div>
    <p class="otp-note" style="font-size: 14px; color: #6b7280; margin-bottom: 30px;">
      If you did not request this, please ignore this email.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      Thank you!</p>
  </div>
  <div class="footer" style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 12px; color: #9ca3af; margin: 0;">
      © ${currentYear} Arc CMS. All rights reserved.</p>
  </div>
</div>
`,
      subject: 'Verify Your Email to Join the Waitlist',
      previewText: '',
      createdAt: new Date(),
      type: 'waitlist_verify_otp_email',
      title: 'Waitlist verify OTP Email',
    },
  ];

  // Deterministic per-waitlist doc ids (`<type>_<waitlistId>`) so a retried or
  // re-fired create trigger upserts the same two docs instead of adding a
  // second copy each run. Existing docs are left untouched to preserve any
  // admin edits.
  let created = 0;
  const batch = db.batch();

  for (const t of templates) {
    const docId = `${t.type}_${waitlistsId}`;
    const docRef = db.collection('EmailTemplate').doc(docId);
    const existing = await docRef.get();
    if (existing.exists) continue;
    const payload = {
      ...t,
      waitlistId: waitlistsId,
      id: docId,
      createdAt: t.createdAt || new Date(),
      modifiedAt: t.modifiedAt || new Date(),
    };
    batch.set(docRef, payload);
    created++;
  }

  if (created > 0) await batch.commit();

  console.log(`Ensured ${templates.length} EmailTemplate docs for Waitlist ${waitlistsId} (created ${created}).`);
});
