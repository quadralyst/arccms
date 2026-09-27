# Writing for Google and AI assistants: a guide for authors

ArcCMS does the plumbing (structured data, authors, sources, Markdown twins, crawler policy).
This page is about the part only a writer can do. The editor's **Checks** tab scores a draft
against these points; it advises, it never blocks.

## How assistants pick what to quote

When someone asks ChatGPT, Perplexity, Gemini or Claude a question, the assistant searches,
fetches a handful of pages, and quotes *passages*, not pages. A passage gets quoted when it:

- answers a question completely on its own, in a few sentences;
- sits under a heading that matches how people ask;
- contains something checkable: a number, a date, a name, a comparison;
- comes from a page with a named author, a date, and sources.

Google's ranking rewards the same things. Write once, for both.

## The seven habits

1. **Answer first.** The first paragraph under the title, and under every heading, is a
   complete answer in 15 to 70 words. Detail comes after. If a reader (or an assistant) stops
   there, they have the answer.

2. **Headings are the questions people ask.** "How much does it cost in India?" beats
   "Pricing". Use the words a person would type.

3. **Facts, not adjectives.** "Supports 12 languages including Hindi and Tamil" is quotable.
   "World-class multilingual support" is not.

4. **Give it structure.** A list for steps or options, a table for comparisons, an FAQ block
   for the questions you keep getting. Use the editor's block menu (grid icon) or type `/faq`,
   `/key`, `/how`, `/def`. The blocks become schema.org data automatically.

5. **Say who wrote it and when.** Pick an author (Basic tab). When you substantively revise a
   page, press **Mark as updated today** (SEO tab). Do not press it for typo fixes; an honest
   date is worth more than a recent one.

6. **Cite your sources.** Add the pages you drew on under **Sources** (SEO tab). They appear at
   the end of the page and are sent to search engines as citations.

7. **Link to your own pages.** Three or more links to related pages on this site. The Checks
   tab suggests pages you have not linked to yet; one click inserts the link.

## What not to do

- Do not stuff keywords or repeat the title in every paragraph.
- Do not paste in a generic rewrite of what is already on the web. Only what you alone can say
  (your data, your case, your opinion with your name on it) gets cited.
- Do not mark a page as updated without changing it.
- Do not write an FAQ of questions nobody asks.

## Before you publish

Open the **Checks** tab. A score above 80 means the shape is right. Read the failing rules;
each one says the single thing to do. Then publish.

## After you publish

Give it a day, then paste the page URL into Google's Rich Results Test
(search.google.com/test/rich-results). Ask an assistant your heading's question and see whether
your page is the one it quotes. If not, sharpen the opening paragraph; that is almost always
where the difference is.
