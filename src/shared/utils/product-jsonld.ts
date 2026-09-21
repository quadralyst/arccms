/**
 * Product + Offer JSON-LD for the pricing page (docs/discoverability-spec.md, D5):
 * built from the real product records, not a mapping, because products have
 * a fixed shape. Display price rules live in pricing-utils; this reads the
 * resolved price so the markup never claims a price the page does not show.
 */
import { JsonLd, SCHEMA_CONTEXT } from './structured-data';

export interface ProductLike {
    id: string;
    name: string;
    description?: string;
    price?: number | null;
    currency?: string;
    type?: 'one_time' | 'subscription';
    interval?: 'month' | 'year';
    features?: string[];
}

export function buildProductNodes(products: ProductLike[], pageUrl: string, sellerId?: string): JsonLd[] {
    return products.flatMap(product => {
        const name = (product.name || '').trim();
        if (!name) return [];
        const node: JsonLd = {
            '@context': SCHEMA_CONTEXT,
            '@type': 'Product',
            '@id': `${pageUrl}#${product.id}`,
            name,
        };
        const description = (product.description || '').trim();
        if (description) node['description'] = description;
        if (product.features?.length) node['additionalProperty'] = product.features.filter(Boolean).map(f => ({ '@type': 'PropertyValue', name: f }));
        // An Offer needs a real price and currency; a free or unpriced product has none.
        if (typeof product.price === 'number' && product.price >= 0 && product.currency) {
            // Discounted prices come out of floating-point maths; money has two decimals.
            const price = Math.round(product.price * 100) / 100;
            const offer: JsonLd = {
                '@type': 'Offer',
                price,
                priceCurrency: product.currency.toUpperCase(),
                url: pageUrl,
                availability: 'https://schema.org/InStock',
            };
            if (product.type === 'subscription' && product.interval) {
                offer['priceSpecification'] = {
                    '@type': 'UnitPriceSpecification',
                    price,
                    priceCurrency: product.currency.toUpperCase(),
                    billingDuration: 1,
                    billingIncrement: 1,
                    unitCode: product.interval === 'year' ? 'ANN' : 'MON',
                };
            }
            if (sellerId) offer['seller'] = { '@id': sellerId };
            node['offers'] = offer;
        }
        return [node];
    });
}
