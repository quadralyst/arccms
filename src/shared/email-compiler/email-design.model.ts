/**
 * Block-based email design model (Phase 4, D3).
 *
 * A design is a list of blocks authored in the block editor. The compiler
 * ({@link ./compiler}) turns a design + brand kit into email-safe table HTML.
 * Merge fields are stored verbatim as `##TAG##` text and survive compilation.
 */

export type EmailBlockType =
    | 'heading'
    | 'paragraph'
    | 'image'
    | 'button'
    | 'divider'
    | 'spacer'
    | 'columns'
    | 'social'
    | 'raw';

export type BlockAlign = 'left' | 'center' | 'right';

export interface EmailBlockBase {
    id: string;
    type: EmailBlockType;
}

export interface HeadingBlock extends EmailBlockBase {
    type: 'heading';
    text: string;
    level?: 1 | 2 | 3;
    align?: BlockAlign;
}

export interface ParagraphBlock extends EmailBlockBase {
    type: 'paragraph';
    /** Rich-ish inline HTML (bold/italic/link) authored via tiptap in the text block only. */
    html: string;
    align?: BlockAlign;
}

export interface ImageBlock extends EmailBlockBase {
    type: 'image';
    src: string;
    alt?: string;
    href?: string;
    width?: number;
    align?: BlockAlign;
}

export interface ButtonBlock extends EmailBlockBase {
    type: 'button';
    text: string;
    href: string;
    align?: BlockAlign;
}

export interface DividerBlock extends EmailBlockBase {
    type: 'divider';
}

export interface SpacerBlock extends EmailBlockBase {
    type: 'spacer';
    height?: number;
}

export interface ColumnsBlock extends EmailBlockBase {
    type: 'columns';
    left: EmailBlock[];
    right: EmailBlock[];
}

export interface SocialBlock extends EmailBlockBase {
    type: 'social';
}

export interface RawBlock extends EmailBlockBase {
    type: 'raw';
    html: string;
}

export type EmailBlock =
    | HeadingBlock
    | ParagraphBlock
    | ImageBlock
    | ButtonBlock
    | DividerBlock
    | SpacerBlock
    | ColumnsBlock
    | SocialBlock
    | RawBlock;

export interface EmailDesign {
    blocks: EmailBlock[];
}

// ── Brand kit (Settings/email_brand, §3.2) ──

export interface SocialLink {
    platform: 'x' | 'linkedin' | 'github' | 'youtube' | 'instagram' | 'facebook';
    url: string;
}

export interface IEmailBrandKit {
    logoUrl?: string;
    logoWidth?: number;
    primaryColor: string;
    backgroundColor: string;
    contentBackgroundColor: string;
    textColor: string;
    linkColor: string;
    fontFamily: string;
    /** Supports ##COMPANY_NAME##, ##UNSUBSCRIBE_LINK##, ##PREFERENCES_LINK##. */
    footerText?: string;
    physicalAddress?: string;
    socialLinks?: SocialLink[];
}

/** Email-safe font whitelist. */
export const SAFE_FONTS: string[] = [
    "Arial, Helvetica, sans-serif",
    "'Helvetica Neue', Helvetica, Arial, sans-serif",
    "Georgia, 'Times New Roman', serif",
    "'Trebuchet MS', Tahoma, sans-serif",
    "Verdana, Geneva, sans-serif",
    "Tahoma, Verdana, sans-serif",
    "'Courier New', Courier, monospace",
];

export const DEFAULT_BRAND_KIT: IEmailBrandKit = {
    logoUrl: '',
    logoWidth: 160,
    primaryColor: '#3b82f6',
    backgroundColor: '#f4f4f7',
    contentBackgroundColor: '#ffffff',
    textColor: '#374151',
    linkColor: '#3b82f6',
    fontFamily: SAFE_FONTS[0],
    footerText: 'You are receiving this email because you signed up. <a href="##UNSUBSCRIBE_LINK##">Unsubscribe</a> · <a href="##PREFERENCES_LINK##">Preferences</a>',
    physicalAddress: '',
    socialLinks: [],
};

/** Platform → label used for social-row link text (kept simple, no remote images). */
export const SOCIAL_LABELS: Record<SocialLink['platform'], string> = {
    x: 'X',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    youtube: 'YouTube',
    instagram: 'Instagram',
    facebook: 'Facebook',
};
