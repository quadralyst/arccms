import { db } from '../init.js';
import { mergeValueHtml } from '../mail-config/mailConfig.js';

/**
 * The site's email layout for mail written in code (specs/app-email-spec.md, AE-D7):
 * app templates, the app's own HTML, and the app's language versions of account
 * emails. The look comes from Settings, Email, Brand Kit (`Settings/email_brand`).
 */

/** The Brand Kit fields the layout reads. Mirrors IEmailBrandKit (src/shared/email-compiler/email-design.model.ts). */
export interface EmailBrand {
  logoUrl?: string;
  logoWidth?: number;
  primaryColor: string;
  backgroundColor: string;
  contentBackgroundColor: string;
  textColor: string;
  linkColor: string;
  fontFamily: string;
  physicalAddress?: string;
}

/** The Brand Kit's defaults (DEFAULT_BRAND_KIT in the browser; a spec keeps them equal). */
export const DEFAULT_EMAIL_BRAND: EmailBrand = {
  logoUrl: '',
  logoWidth: 160,
  primaryColor: '#3b82f6',
  backgroundColor: '#f4f4f7',
  contentBackgroundColor: '#ffffff',
  textColor: '#374151',
  linkColor: '#3b82f6',
  fontFamily: 'Arial, Helvetica, sans-serif',
  physicalAddress: '',
};

/** The Brand Kit, over its defaults. A failed read gives the defaults: the email still goes. */
export async function readEmailBrand(): Promise<EmailBrand> {
  try {
    const snap = await db.collection('Settings').doc('email_brand').get();
    return { ...DEFAULT_EMAIL_BRAND, ...((snap.data() as Partial<EmailBrand> | undefined) ?? {}) };
  } catch (err) {
    console.warn('emailLayout: could not read Settings/email_brand, using the defaults', err);
    return { ...DEFAULT_EMAIL_BRAND };
  }
}

const COLOR = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$/;
const FONT = /^[\w\s,'"-]{1,120}$/;

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : fallback;
}

/**
 * `inner` (HTML with ##TAG## tokens, resolved when it is sent) inside the site's
 * layout: the logo, the content card in the brand's colours and font, and a footer
 * with the company name and address. `lang` marks the language for screen readers.
 */
export function wrapInEmailLayout(inner: string, brand: EmailBrand = DEFAULT_EMAIL_BRAND, lang = ''): string {
  const bg = color(brand.backgroundColor, DEFAULT_EMAIL_BRAND.backgroundColor);
  const card = color(brand.contentBackgroundColor, DEFAULT_EMAIL_BRAND.contentBackgroundColor);
  const text = color(brand.textColor, DEFAULT_EMAIL_BRAND.textColor);
  const link = color(brand.linkColor, DEFAULT_EMAIL_BRAND.linkColor);
  const font = typeof brand.fontFamily === 'string' && FONT.test(brand.fontFamily) ? brand.fontFamily : DEFAULT_EMAIL_BRAND.fontFamily;
  const logoUrl = typeof brand.logoUrl === 'string' && /^https:\/\//.test(brand.logoUrl) ? brand.logoUrl : '';
  const logoWidth = Math.min(Math.max(Number(brand.logoWidth) || 160, 40), 600);
  const logo = logoUrl
    ? `<div style="text-align:center;padding:24px 0 8px;"><img src="${mergeValueHtml(logoUrl)}" width="${logoWidth}" alt="##COMPANY_NAME##" style="max-width:100%;height:auto;"/></div>`
    : '';
  const address = brand.physicalAddress ? `<br>${mergeValueHtml(brand.physicalAddress)}` : '';
  const langAttr = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang) ? ` lang="${lang}"` : '';
  return `<div${langAttr} style="background:${bg};padding:24px 12px;font-family:${font.replace(/"/g, "'")};">
  ${logo}
  <div style="max-width:600px;margin:0 auto;background:${card};border-radius:12px;overflow:hidden;color:${text};line-height:1.6;">
    <style>a{color:${link};}</style>
    <div style="padding:32px;">
      ${inner}
    </div>
  </div>
  <div style="max-width:600px;margin:0 auto;text-align:center;padding:16px;font-size:12px;color:#9ca3af;">
    © ${new Date().getFullYear()} ##COMPANY_NAME##${address}
  </div>
</div>`;
}
