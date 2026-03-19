import { Injectable } from '@angular/core';
import { createGenericStore } from '../../../../shared/services/generic-store.service';
import { IEmailLog } from './email-log.model';
import { EmailLogService } from './email-log.service';

const EmailLogStoreBase = createGenericStore<IEmailLog>(EmailLogService);

@Injectable({ providedIn: 'root' })
export class EmailLogStore extends EmailLogStoreBase {}
