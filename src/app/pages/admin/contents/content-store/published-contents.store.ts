import { Injectable } from '@angular/core';
import { createGenericStore } from '../../../../../shared/services/generic-store.service';
import { IContents } from './published-contents.model';
import { ContentsService } from './published-contents.service';

const ContentsStoreBase = createGenericStore<IContents>(ContentsService);

@Injectable({ providedIn: 'root' })
export class ContentsStore extends ContentsStoreBase { }
