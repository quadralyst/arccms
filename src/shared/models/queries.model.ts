/**
 * Pagination type
 */
export type PaginationType = 'Prev' | 'Next';

/**
 * Order by direction for queries
 */
export type OrderByDirection = 'asc' | 'desc';

/**
 * Where condition for database queries
 */
export interface WhereCondition {
    field: string;
    operator: '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'in' | 'array-contains-any' | 'not-in';
    value: any;
}

/**
 * Query parameters for database operations
 */
export interface QueryParams {
    whereConditions?: WhereCondition[];
    orConditions?: WhereCondition[];
    orderByField?: string;
    orderByDirection?: OrderByDirection;
    limitCount: number;
    currentPageNumber: number;
    previousPageNumber: number;
    endBeforeDoc?: any;
    startAfterDoc?: any;
    getOnce?: boolean;
}
