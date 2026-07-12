/**
 * Block design → email-safe HTML compiler (Phase 4).
 *
 * Runs entirely in the browser at save time. Output is table-based, 600px wide,
 * fully inline-styled, with bulletproof buttons and alt text — no external CSS,
 * no `<style>`. Merge fields (`##TAG##`) are preserved verbatim so the send
 * pipeline resolves them. The send pipeline just ships the stored HTML; there is
 * no server-side compiler.
 */

import {
    EmailBlock,
    EmailDesign,
    IEmailBrandKit,
    DEFAULT_BRAND_KIT,
    SOCIAL_LABELS,
    BlockAlign,
} from './email-design.model';

const WIDTH = 600;

/** Escape text for safe HTML text nodes / attribute values. */
export function escapeHtml(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Escape a URL for use in an href while keeping our own `##TAG##` merge fields
 * intact (they must reach the send pipeline unescaped).
 */
export function escapeUrl(url: string): string {
    const raw = String(url ?? '').trim();
    // Allow merge-tag-only hrefs (e.g. ##UNSUBSCRIBE_LINK##) through untouched.
    if (/^##[A-Z_]+##$/.test(raw)) return raw;
    return raw.replace(/"/g, '%22').replace(/\s/g, '%20');
}

function align(a?: BlockAlign): BlockAlign {
    return a === 'center' || a === 'right' ? a : 'left';
}

// ── Per-block renderers ──

function renderHeading(b: { text: string; level?: 1 | 2 | 3; align?: BlockAlign }, brand: IEmailBrandKit): string {
    const sizes: Record<number, number> = { 1: 26, 2: 21, 3: 17 };
    const size = sizes[b.level || 1];
    return `<h${b.level || 1} style="margin:0 0 16px;font-family:${brand.fontFamily};font-size:${size}px;line-height:1.3;font-weight:700;color:${brand.textColor};text-align:${align(b.align)};">${escapeHtml(b.text)}</h${b.level || 1}>`;
}

function renderParagraph(b: { html: string; align?: BlockAlign }, brand: IEmailBrandKit): string {
    // Inline HTML from the text block is trusted (authored in-app); we only wrap it.
    return `<p style="margin:0 0 16px;font-family:${brand.fontFamily};font-size:15px;line-height:1.6;color:${brand.textColor};text-align:${align(b.align)};">${b.html || ''}</p>`;
}

function renderImage(b: { src: string; alt?: string; href?: string; width?: number; align?: BlockAlign }): string {
    const w = b.width && b.width > 0 ? Math.min(b.width, WIDTH) : WIDTH - 80;
    const img = `<img src="${escapeUrl(b.src)}" alt="${escapeHtml(b.alt || '')}" width="${w}" style="display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;" />`;
    const wrapped = b.href ? `<a href="${escapeUrl(b.href)}" target="_blank">${img}</a>` : img;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${align(b.align)}" style="padding:0 0 16px;">${wrapped}</td></tr></table>`;
}

function renderButton(b: { text: string; href: string; align?: BlockAlign }, brand: IEmailBrandKit): string {
    // Bulletproof button: table cell with background + rounded corners.
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${align(b.align)}" style="padding:8px 0 20px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="${brand.primaryColor}" style="border-radius:6px;">
      <a href="${escapeUrl(b.href)}" target="_blank" style="display:inline-block;padding:12px 26px;font-family:${brand.fontFamily};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(b.text)}</a>
    </td>
  </tr></table>
</td></tr></table>`;
}

function renderDivider(): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:8px 0 24px;"><div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>`;
}

function renderSpacer(b: { height?: number }): string {
    const h = b.height && b.height > 0 ? b.height : 24;
    return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

function renderSocial(brand: IEmailBrandKit): string {
    const links = brand.socialLinks || [];
    if (!links.length) return '';
    const cells = links
        .map(
            (l) =>
                `<a href="${escapeUrl(l.url)}" target="_blank" style="display:inline-block;margin:0 8px;font-family:${brand.fontFamily};font-size:13px;color:${brand.linkColor};text-decoration:none;">${escapeHtml(SOCIAL_LABELS[l.platform] || l.platform)}</a>`,
        )
        .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:8px 0 16px;">${cells}</td></tr></table>`;
}

function renderRaw(b: { html: string }): string {
    return b.html || '';
}

function renderBlock(block: EmailBlock, brand: IEmailBrandKit): string {
    switch (block.type) {
        case 'heading': return renderHeading(block, brand);
        case 'paragraph': return renderParagraph(block, brand);
        case 'image': return renderImage(block);
        case 'button': return renderButton(block, brand);
        case 'divider': return renderDivider();
        case 'spacer': return renderSpacer(block);
        case 'social': return renderSocial(brand);
        case 'raw': return renderRaw(block);
        case 'columns': return renderColumns(block, brand);
        default: return '';
    }
}

function renderColumns(b: { left: EmailBlock[]; right: EmailBlock[] }, brand: IEmailBrandKit): string {
    const col = (blocks: EmailBlock[]) => (blocks || []).map((x) => renderBlock(x, brand)).join('\n');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td valign="top" width="50%" style="padding:0 8px 16px 0;">${col(b.left)}</td>
  <td valign="top" width="50%" style="padding:0 0 16px 8px;">${col(b.right)}</td>
</tr></table>`;
}

/** Render just the block content (no shell) — used by columns and previews. */
export function renderBlocks(design: EmailDesign, brand: IEmailBrandKit): string {
    return (design.blocks || []).map((b) => renderBlock(b, brand)).join('\n');
}

/**
 * Compile a design + brand kit into a complete, email-safe HTML document.
 * Wraps the block content in the branded shell (logo header + footer with
 * unsubscribe/preferences/socials/address).
 */
export function compileEmailDesign(design: EmailDesign, brandKit?: Partial<IEmailBrandKit>): string {
    const brand: IEmailBrandKit = { ...DEFAULT_BRAND_KIT, ...(brandKit || {}) };
    const content = renderBlocks(design, brand);

    const header = brand.logoUrl
        ? `<tr><td align="center" style="padding:28px 0 8px;"><img src="${escapeUrl(brand.logoUrl)}" alt="##COMPANY_NAME##" width="${brand.logoWidth || 160}" style="display:block;border:0;max-width:${brand.logoWidth || 160}px;height:auto;" /></td></tr>`
        : '';

    const social = renderSocial(brand);
    const footerBits: string[] = [];
    if (brand.footerText) footerBits.push(`<div style="margin:0 0 8px;">${brand.footerText}</div>`);
    if (brand.physicalAddress) footerBits.push(`<div style="margin:0 0 8px;">${escapeHtml(brand.physicalAddress)}</div>`);
    const footer = `<tr><td style="padding:16px 32px 28px;">${social}<div style="font-family:${brand.fontFamily};font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;">${footerBits.join('')}</div></td></tr>`;

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${brand.backgroundColor};margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px;max-width:100%;background-color:${brand.contentBackgroundColor};border-radius:12px;overflow:hidden;">
    ${header}
    <tr><td style="padding:24px 32px;font-family:${brand.fontFamily};color:${brand.textColor};">
      ${content}
    </td></tr>
    ${footer}
  </table>
</td></tr>
</table>`;
}

/**
 * Marketing guard (spec §Phase-4.4): a marketing template's compiled HTML must
 * contain the unsubscribe merge field. The brand-kit footer provides it by
 * default; this catches cases where it was removed (e.g. via a raw-HTML block or
 * a custom footer).
 */
export function compiledHtmlHasUnsubscribe(html: string): boolean {
    return typeof html === 'string' && html.includes('##UNSUBSCRIBE_LINK##');
}

/** List the `##TAG##` merge fields present in a design (for round-trip checks). */
export function extractMergeTags(design: EmailDesign): string[] {
    const html = renderBlocks(design, DEFAULT_BRAND_KIT);
    const found = new Set<string>();
    const re = /##([A-Z_]+)##/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) found.add(m[1]);
    return [...found];
}
