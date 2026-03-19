import { Injectable } from "@angular/core";
import { createGenericStore } from "../../../../shared/services/generic-store.service";
import { IMediaManager } from "./media-manager.model";
import { MediaManagerService } from "./media-manager.service";
const MediaManagerStoreBase = createGenericStore<IMediaManager>(MediaManagerService);

@Injectable({ providedIn: 'root' })
export class MediaManagerStore extends MediaManagerStoreBase {
    // Add any media-manager-specific methods or computed properties here
}
