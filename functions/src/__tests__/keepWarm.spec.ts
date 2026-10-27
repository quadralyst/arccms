/**
 * Keeping instances of chosen functions running (keep-warm.ts, F35): ARC_KEEP_WARM,
 * read when the functions are deployed from the environment or the project's .env
 * file, sets minInstances on the named functions only.
 */
import { describe, expect, it } from 'vitest';
import { applyKeepWarm, envFileValue, keepWarmSetting, MAX_KEPT, parseKeepWarm } from '../keep-warm.js';

/** A second generation function as firebase-functions makes one: its endpoint is a plain value. */
function v2(): { (): void; __endpoint: { platform: string; minInstances: unknown } } {
    const fn = (() => undefined) as unknown as { (): void; __endpoint: { platform: string; minInstances: unknown } };
    fn.__endpoint = { platform: 'gcfv2', minInstances: null };
    return fn;
}

/** A first generation function: its endpoint is a getter, which throws outside Firebase. */
function v1(): () => void {
    const fn = () => undefined;
    Object.defineProperty(fn, '__endpoint', { get: () => { throw new Error('GCLOUD_PROJECT is not set'); } });
    return fn;
}

describe('parseKeepWarm', () => {
    it('reads names, each with an optional count', () => {
        expect([...parseKeepWarm(' signInWithPin , custom-pinSignIn:2 ')]).toEqual([['signInWithPin', 1], ['custom-pinSignIn', 2]]);
        expect(parseKeepWarm(undefined).size).toBe(0);
        expect(parseKeepWarm('').size).toBe(0);
    });

    it('stops the deploy on a mistake, saying what to write', () => {
        for (const value of ['signInWithPin:0', `a:${MAX_KEPT + 1}`, 'a:two', 'arccms.signInWithPin', 'a b']) {
            expect(() => parseKeepWarm(value)).toThrow(/ARC_KEEP_WARM: .* such as signInWithPin/);
        }
    });
});

describe('keepWarmSetting', () => {
    const files = (map: Record<string, string>) => (file: string) => map[file] ?? null;

    it('takes the environment first, then the project file, then functions/.env', () => {
        const read = files({ '.env.demo': 'ARC_KEEP_WARM=fromProject\n', '.env': 'ARC_KEEP_WARM=fromDefault\n' });
        expect(keepWarmSetting({ ARC_KEEP_WARM: 'fromEnv', GCLOUD_PROJECT: 'demo' }, read)).toBe('fromEnv');
        expect(keepWarmSetting({ GCLOUD_PROJECT: 'demo' }, read)).toBe('fromProject');
        expect(keepWarmSetting({ GCLOUD_PROJECT: 'other' }, read)).toBe('fromDefault');
        expect(keepWarmSetting({}, files({}))).toBeUndefined();
    });

    it('reads a .env line as Firebase does: quotes off, the last one wins, other keys ignored', () => {
        expect(envFileValue('# ARC_KEEP_WARM=no\nARC_REGION=x\nARC_KEEP_WARM="a,b"\n')).toBe('a,b');
        expect(envFileValue("ARC_KEEP_WARM='a'\nARC_KEEP_WARM=b")).toBe('b');
        expect(envFileValue('ARC_KEEP_WARMER=a')).toBeUndefined();
    });
});

describe('applyKeepWarm', () => {
    it('sets minInstances on the named functions, by the name the browser calls', () => {
        const group = { signInWithPin: v2(), checkEmailAccount: v2(), custom: { pinSignIn: v2() } };
        const missing = applyKeepWarm(group, new Map([['signInWithPin', 1], ['custom-pinSignIn', 2]]));
        expect(missing).toEqual([]);
        expect(group.signInWithPin.__endpoint.minInstances).toBe(1);
        expect(group.custom.pinSignIn.__endpoint.minInstances).toBe(2);
        // The rest stay as firebase-functions made them: reset to none on every deploy.
        expect(group.checkEmailAccount.__endpoint.minInstances).toBeNull();
    });

    it('says which names the build does not have, and never reads a first generation function', () => {
        const group = { onSignInDeleted: v1(), signInWithPin: v2() };
        expect(applyKeepWarm(group, new Map([['onSignInDeleted', 1], ['gone', 1]]))).toEqual(['onSignInDeleted', 'gone']);
    });
});
