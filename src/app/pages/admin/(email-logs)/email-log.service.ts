import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { EMAIL_LOGS_COLLECTION, IEmailLog } from './email-log.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new EmailLogService(),
    deps: [],
})
export class EmailLogService extends DbService<IEmailLog> {
    constructor() {
        super(EMAIL_LOGS_COLLECTION);
    }
}
