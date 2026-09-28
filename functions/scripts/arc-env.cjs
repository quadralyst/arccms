/**
 * The ARC_* settings a script outside the Firebase CLI should see, read the
 * way the CLI reads them for a deploy: functions/.env, overridden by
 * functions/.env.<projectId>. Values already in `env` win over both.
 *
 * Applying the first value found instead let the committed .env beat the
 * project's own file, so a script run for the dev project read the old
 * install's database (review O3).
 */
const fs = require('node:fs');
const path = require('node:path');

function loadArcEnv(functionsDir, projectId, env = process.env) {
    const fromFiles = {};
    for (const file of ['.env', `.env.${projectId}`]) {
        let text;
        try {
            text = fs.readFileSync(path.join(functionsDir, file), 'utf-8');
        } catch {
            continue;
        }
        for (const line of text.split('\n')) {
            const match = /^\s*(ARC_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
            if (match) fromFiles[match[1]] = match[2];
        }
    }
    for (const [key, value] of Object.entries(fromFiles)) {
        if (env[key] === undefined) env[key] = value;
    }
    return env;
}

module.exports = { loadArcEnv };
