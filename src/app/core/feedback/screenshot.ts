/** Screenshots wider than this are scaled down: plenty to read, small to upload. */
const MAX_WIDTH = 1280;

/**
 * Whether a part of the page belongs in the screenshot. Left out: the feedback
 * panel and button (`data-feedback-ignore`), anything outside the visible area,
 * and images that have not loaded (a lazy image below the fold never loads, and
 * waiting for it made a screenshot take half a minute).
 */
export function inScreenshot(node: Node, width: number, height: number): boolean {
    if (!(node instanceof Element)) return true;
    if (node.hasAttribute('data-feedback-ignore')) return false;
    if (node instanceof HTMLImageElement && !node.complete) return false;
    const box = node.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return true; // a wrapper; its children decide
    return box.bottom > 0 && box.top < height && box.right > 0 && box.left < width;
}

/**
 * A JPEG of what the person sees now: the visible part of the page, drawn from
 * the page itself (browsers cannot capture the real screen without asking every
 * time). Returns null when it cannot be made; feedback then goes without one.
 *
 * The drawing library loads only here, the first time someone opens feedback.
 * A game canvas shows only if the game keeps its drawing (docs/feedback.md).
 */
export async function captureScreen(): Promise<Blob | null> {
    try {
        const { domToBlob } = await import('modern-screenshot');
        const width = window.innerWidth;
        const height = window.innerHeight;
        return await domToBlob(document.body, {
            type: 'image/jpeg',
            quality: 0.7,
            width,
            height,
            scale: Math.min(1, MAX_WIDTH / width),
            backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
            // Shift the page so the part in view is what gets drawn.
            style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
            filter: (node) => inScreenshot(node, width, height),
            // Per image or font; one that is slower is left out.
            timeout: 2000,
        });
    } catch (err) {
        console.warn('Feedback: no screenshot.', err);
        return null;
    }
}
