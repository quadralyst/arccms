import { createGenericStore } from '../../../../shared/services/generic-store.service';
import { IProduct } from './product.model';
import { ProductsService } from './products.service';

/** NgRx signal store for Products (CRUD, pagination, audit fields). */
export const ProductsStore = createGenericStore<IProduct>(ProductsService, {
    limit: 50,
    sortField: 'createdAt',
    order: 'desc',
});
