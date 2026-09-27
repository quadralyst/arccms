import { Injectable } from '@angular/core';
import { DbService } from '../../../../shared/services/db.service';
import { ISmsLog, SMS_LOGS_COLLECTION } from './sms-log.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new SmsLogService(),
    deps: [],
})
export class SmsLogService extends DbService<ISmsLog> {
    constructor() {
        super(SMS_LOGS_COLLECTION);
    }
}
