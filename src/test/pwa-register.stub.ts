/** Tests stand-in for `virtual:pwa-register`, which only the PWA build plugin provides. */
export function registerSW(): (reload?: boolean) => Promise<void> {
    return async () => undefined;
}
