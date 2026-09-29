import { Injectable } from '@angular/core';
import { createGenericStore } from '../../../../shared/services/generic-store.service';
import { ISmsLog } from './sms-log.model';
import { SmsLogService } from './sms-log.service';

const SmsLogStoreBase = createGenericStore<ISmsLog>(SmsLogService);

@Injectable({ providedIn: 'root' })
export class SmsLogStore extends SmsLogStoreBase {}
