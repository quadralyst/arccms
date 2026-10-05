/**
 * The standard pages every site needs (specs/site-sections-spec.md, SS6): one
 * content type, Pages, at /info, and six pages that start as drafts with an
 * outline. Prompts are written `[Replace: ...]`, so the editor can warn before
 * one is published, and nothing here is legal advice.
 *
 * Pure data, for StandardPagesService and the tests.
 */
import type { ContentType, ContentTypeField } from '../content-types/content-types.model';
import { REPEATER_SCHEMAS, newRepeaterRow } from '../../../../../shared/models/repeater.model';

export const STANDARD_PAGES_SLUG = 'info';

/** What marks text the admin has still to write. */
export const REPLACE_MARKER = '[Replace:';

/** Whether a draft still holds outline text: in its body, title, summary or any custom field. */
export function hasReplacePrompt(values: unknown): boolean {
    return JSON.stringify(values ?? '').includes(REPLACE_MARKER);
}

/** The details the outlines fill in, from Settings, About. */
export interface OwnerDetails {
    name?: string;
    contactEmail?: string;
    address?: string;
}

const key = (name: string) => `${STANDARD_PAGES_SLUG}-${name}`;

/** The layout a new Contact page starts with: info/detail-contact.html (SS8). */
export const CONTACT_LAYOUT = 'contact';

/**
 * The Pages type's fields. The contact form switch only with the contact form
 * feature. Info boxes (SS8) are the Contact layout's own boxes, such as opening
 * hours; other pages leave the field empty and show nothing.
 */
export function standardPagesFields(withContactForm: boolean): ContentTypeField[] {
    const fields: ContentTypeField[] = [
        { key: key('locations'), label: 'Locations', type: 'maplocation', required: false, order: 0 },
        { key: key('faq'), label: 'FAQ', type: 'faq', required: false, order: 1 },
        { key: key('show-contact-details'), label: 'Show contact details', type: 'boolean', required: false, order: 2 },
    ];
    if (withContactForm) fields.push({ key: key('show-contact-form'), label: 'Show contact form', type: 'boolean', required: false, order: 3 });
    fields.push({ key: key('info-boxes'), label: 'Info boxes', type: 'infocard', required: false, order: fields.length });
    return fields;
}

export type StandardPagesType = Omit<ContentType, 'id' | 'createdAt' | 'modifiedAt' | 'createdBy' | 'modifiedBy'>;

export function standardPagesType(withContactForm: boolean): StandardPagesType {
    return {
        name: 'Pages',
        singularName: 'Page',
        slug: STANDARD_PAGES_SLUG,
        description: 'About, contact, questions and the policies every site needs.',
        icon: 'fas fa-file-lines',
        order: 2,
        hasPublicUrl: true,
        templateFolder: STANDARD_PAGES_SLUG,
        entryOrder: 'manual',
        standard: 'pages',
        schema: { type: 'WebPage', fields: {} },
        listColumns: ['title', 'status', 'createdAt'],
        fields: standardPagesFields(withContactForm),
    };
}

/** One page to create: its address, title, body, custom fields and layout. */
export interface StandardPage {
    urlSlug: string;
    title: string;
    content: string;
    customFields: Record<string, unknown>;
    /** A layout of the info folder (`detail-{layout}.html`); none for detail.html. */
    layout?: string;
}

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (text: string) => `<p>${text}</p>`;
const h2 = (text: string) => `<h2>${text}</h2>`;
const prompt = (text: string) => p(`${REPLACE_MARKER} ${text}]`);

/** "Acme, hello@acme.example, 12 MG Road", or a prompt when About is empty. */
function whoWeAre(owner: OwnerDetails): string {
    const parts = [owner.name, owner.contactEmail, (owner.address || '').replace(/\s*\n\s*/g, ', ')]
        .map((part) => (part || '').trim()).filter(Boolean).map(esc);
    return parts.length
        ? p(parts.join(', '))
        : prompt('your organisation\'s name, contact email and address');
}

const name = (owner: OwnerDetails) => esc((owner.name || '').trim()) || 'we';

/** The six pages, in their footer order. */
export function standardPages(owner: OwnerDetails, withContactForm: boolean): StandardPage[] {
    const faqSchema = REPEATER_SCHEMAS['faq'];
    const faqRow = (position: number, question: string, answer: string) =>
        ({ ...newRepeaterRow(faqSchema, position), question: `${REPLACE_MARKER} ${question}]`, answer: `${REPLACE_MARKER} ${answer}]` });
    const legalNote = prompt('have this page checked against the law where you work. This outline is not legal advice');

    return [
        {
            urlSlug: 'about',
            title: 'About',
            content: [
                h2('Who we are'), prompt(`who ${name(owner)} are, in two or three sentences`),
                h2('What we do'), prompt('what you offer, and who it is for'),
                h2('Why we do it'), prompt('what you care about'),
            ].join(''),
            customFields: {},
        },
        {
            urlSlug: 'contact',
            title: 'Contact',
            content: prompt('a line or two on how to reach you and when you reply, such as "Write to us, call or visit. We answer within one working day."'),
            customFields: {
                [key('show-contact-details')]: true,
                ...(withContactForm ? { [key('show-contact-form')]: true } : {}),
                [key('info-boxes')]: [{
                    ...newRepeaterRow(REPEATER_SCHEMAS['infocard'], 0),
                    icon: { set: 'fa', name: 'clock', style: 'regular', classes: 'fa-regular fa-clock', label: 'Clock' },
                    headline: 'Opening hours',
                    info: `${REPLACE_MARKER} your opening hours, such as Monday to Friday, 9am to 6pm]`,
                }],
            },
            layout: CONTACT_LAYOUT,
        },
        {
            urlSlug: 'faq',
            title: 'Frequently asked questions',
            content: prompt('one line introducing the questions, or delete this line'),
            customFields: {
                [key('faq')]: [
                    faqRow(0, 'a question people often ask', 'its answer, in plain words'),
                    faqRow(1, 'another question', 'its answer'),
                    faqRow(2, 'a third question', 'its answer'),
                ],
            },
        },
        {
            urlSlug: 'privacy-policy',
            title: 'Privacy Policy',
            content: [
                legalNote,
                h2('Who we are'), whoWeAre(owner),
                h2('What we collect'), prompt('the personal details you collect, such as name, email, and what visitors send through forms'),
                h2('Why we use it'), prompt('why you need each, such as replying to messages or sending a newsletter someone signed up for'),
                h2('Who we share it with'), prompt('the services that process it for you, such as your email or hosting provider'),
                h2('How long we keep it'), prompt('how long you keep each kind of detail'),
                h2('Your rights'), prompt('how someone can see, correct or delete their details'),
                h2('Cookies'), p('See our <a href="/info/cookie-policy">Cookie Policy</a>.'),
                h2('Changes to this policy'), prompt('how you tell people when this policy changes'),
                h2('Contact us'), prompt('how to reach you about privacy'),
            ].join(''),
            customFields: {},
        },
        {
            urlSlug: 'terms',
            title: 'Terms',
            content: [
                legalNote,
                h2('Who we are'), whoWeAre(owner),
                h2('Using this site'), prompt('what people may and may not do on your site'),
                h2('Accounts'), prompt('the rules for accounts, or delete this section if people do not sign in'),
                h2('Payments'), prompt('prices, payments and refunds, or delete this section if you sell nothing'),
                h2('Content'), prompt('who owns what is on the site, and what people may reuse'),
                h2('Limits of our liability'), prompt('what you are and are not responsible for'),
                h2('Changes to these terms'), prompt('how you tell people when these terms change'),
                h2('Governing law'), prompt('the country or state whose law applies'),
                h2('Contact us'), prompt('how to reach you about these terms'),
            ].join(''),
            customFields: {},
        },
        {
            urlSlug: 'cookie-policy',
            title: 'Cookie Policy',
            content: [
                legalNote,
                h2('What cookies are'), p('Cookies are small files a website stores in your browser, to remember things between visits.'),
                h2('The cookies we use'), prompt('each cookie or storage your site uses, such as analytics, and what it is for'),
                h2('Your choices'), p('You can accept or refuse non-essential cookies in the banner when you first visit, and delete cookies in your browser\'s settings at any time.'),
                h2('Changes to this policy'), prompt('how you tell people when this policy changes'),
                h2('Contact us'), prompt('how to reach you about cookies'),
            ].join(''),
            customFields: {},
        },
    ];
}
