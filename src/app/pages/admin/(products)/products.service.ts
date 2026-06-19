import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { IProduct, PRODUCTS_COLLECTION } from './product.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new ProductsService(),
    deps: [],
})
export class ProductsService extends DbService<IProduct> {
    constructor() {
        super(PRODUCTS_COLLECTION);
    }
}
