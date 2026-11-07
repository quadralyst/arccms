/**
 * Used by vitest.config.ts. True when a run names only specs of the `server` project,
 * as in `npx vitest run functions/src/x.spec.ts`, so the app project and its Angular
 * compiler (about 35 seconds to start) are left out. Anything else, a name it cannot
 * place or the value of an option such as `--maxWorkers 5`, keeps both projects: a
 * slower run, never a missed spec.
 */
export function onlyServerSpecs(argv) {
    const args = argv.slice(2);
    if (args.some((arg) => arg === '--project' || arg.startsWith('--project='))) return false;
    const names = args.filter((arg, at) => !arg.startsWith('-') && arg !== 'run' && arg !== 'watch' && !['-t', '--testNamePattern'].includes(args[at - 1]));
    return names.length > 0 && names.every((name) => /^(\.\/)?(functions\/|scripts\/)/.test(name) || name === 'functions' || name === 'scripts');
}
