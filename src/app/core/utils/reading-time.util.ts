/**
 * Calculates the estimated reading time for content
 * Based on average reading speed of 200 words per minute
 * 
 * @param contentHtml - HTML content string
 * @returns Reading time in minutes (rounded up)
 */
export function calculateReadingTime(contentHtml: string): number {
    const READING_SPEED_WPM = 200;

    if (!contentHtml) {
        return 0;
    }

    // Strip HTML tags
    let cleanText = contentHtml.replace(/<[^>]*>/g, ' ');

    // Strip HTML entities
    cleanText = cleanText.replace(/&[a-z0-9]+;/gi, ' ');

    // Normalize whitespace
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    // Count words
    const words = cleanText.split(' ').filter(word => word.length > 0);
    const wordCount = words.length;

    if (wordCount === 0) {
        return 0;
    }

    // Calculate reading time and round up
    return Math.ceil(wordCount / READING_SPEED_WPM);
}

/**
 * Gets detailed reading statistics for content
 * 
 * @param contentHtml - HTML content string
 * @returns Object with word count and reading time in minutes
 */
export function getReadingStats(contentHtml: string): { wordCount: number; readingTimeMinutes: number } {
    const READING_SPEED_WPM = 200;

    if (!contentHtml) {
        return { wordCount: 0, readingTimeMinutes: 0 };
    }

    // Strip HTML tags
    let cleanText = contentHtml.replace(/<[^>]*>/g, ' ');

    // Strip HTML entities
    cleanText = cleanText.replace(/&[a-z0-9]+;/gi, ' ');

    // Normalize whitespace
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    // Count words
    const words = cleanText.split(' ').filter(word => word.length > 0);
    const wordCount = words.length;

    if (wordCount === 0) {
        return { wordCount: 0, readingTimeMinutes: 0 };
    }

    return {
        wordCount,
        readingTimeMinutes: Math.ceil(wordCount / READING_SPEED_WPM),
    };
}
