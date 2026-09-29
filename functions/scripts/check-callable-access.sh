#!/usr/bin/env bash
# Check that every callable function is reachable by the browser SDK.
#
# WHY: Firebase grants `allUsers → roles/run.invoker` when it CREATES a callable.
# If that step is missed (a partially-failed deploy, for instance) the function is
# unreachable, and a later `firebase deploy` does NOT retry the grant — updates skip
# IAM. The symptom is easy to misread: Cloud Run returns HTTP 403, and so does a
# function whose own admin check rejected you. Tell them apart by the BODY:
#
#   HTML "403 Forbidden"          → Cloud Run refused; needs the IAM grant
#   JSON  PERMISSION_DENIED       → the function ran and refused you; working fine
#
# Fix a blocked one with:
#   gcloud run services add-iam-policy-binding arccms-<lowercased-name> \
#     --region=us-central1 --member=allUsers --role=roles/run.invoker --project=<id>
# (or Cloud Console → Cloud Run → service → Security → allow unauthenticated)
#
# Usage: ./check-callable-access.sh [projectId] [region]
set -uo pipefail

# Project/region come from the environment, not positional args: any positional
# argument is treated as a function name to check. (Reading them positionally meant
# `check-callable-access.sh someFunction` silently used "someFunction" as the
# project id and reported every function as 404 / NOT DEPLOYED.)
PROJECT="${FIREBASE_PROJECT:-xlm-project-864ff}"
REGION="${FIREBASE_REGION:-us-central1}"
BASE="https://${REGION}-${PROJECT}.cloudfunctions.net"

# Every onCall function in the build, by plain name (custom ones as custom-<name>).
# Read from functions/lib, so the list always matches what was deployed: a feature
# the app turned off (src/custom/features.ts) is not built, so it is not checked.
# They deploy as arccms-<name> (docs/coexistence-spec.md, CO-D5).
LIB="$(cd "$(dirname "$0")/.." && pwd)/lib/index.js"
if [ ! -f "$LIB" ]; then
  echo "No build at $LIB. Run: npm run build --prefix functions"
  exit 1
fi
CALLABLES=()
while IFS= read -r name; do
  [ -n "$name" ] && CALLABLES+=("$name")
done < <(node --input-type=module -e "
  const m = await import('file://$LIB');
  const walk = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    v && v.__endpoint ? (v.__endpoint.callableTrigger ? [p + k] : [])
      : v && typeof v === 'object' ? walk(v, p + k + '-') : []);
  console.log(walk(m.arccms ?? {}, '').join('\\n'));
" 2>/dev/null)
if [ ${#CALLABLES[@]} -eq 0 ]; then
  echo "Could not read the callables from $LIB."
  exit 1
fi

# The app's callables (functions/src/custom/public-callables.txt, docs/custom-code.md),
# deployed as arccms-custom-<name>.
CUSTOM_LIST="$(dirname "$0")/../src/custom/public-callables.txt"
if [ -f "$CUSTOM_LIST" ]; then
  while IFS= read -r line; do
    name="$(printf '%s' "$line" | sed 's/#.*//' | tr -d '[:space:]')"
    # Already listed when it is in the build; kept here so a missing one is reported.
    if [ -n "$name" ] && [[ ! " ${CALLABLES[*]} " == *" custom-$name "* ]]; then CALLABLES+=("custom-$name"); fi
  done < "$CUSTOM_LIST"
fi

blocked=()
missing=()
# Any positional arguments narrow the check to just those functions.
if [ "$#" -gt 0 ]; then CALLABLES=("$@"); fi

for fn in "${CALLABLES[@]}"; do
  resp=$(curl -s -m 20 -w '\n%{http_code}' -X POST "$BASE/arccms-$fn" -H "Content-Type: application/json" -d '{"data":{}}' 2>/dev/null)
  code=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  if [ -z "$code" ]; then
    printf "%-34s ⚠️  no response\n" "$fn"
  elif [ "$code" = "404" ]; then
    # Not deployed. Checked explicitly because a 404 body is not "403 Forbidden",
    # so a naive check would report a missing function as healthy.
    printf "%-34s ❌ NOT DEPLOYED (404)\n" "$fn"
    missing+=("$fn")
  elif echo "$body" | grep -qi "403 Forbidden"; then
    printf "%-34s ❌ BLOCKED by Cloud Run — needs invoker grant\n" "$fn"
    blocked+=("$fn")
  else
    printf "%-34s ✅ reachable\n" "$fn"
  fi
done

echo
if [ ${#missing[@]} -gt 0 ]; then
  echo "Not deployed: ${missing[*]}"
  echo "Every callable here is in the build, so a missing one means the"
  echo "deploy used an old build or skipped it. Rebuild (npm run build --prefix functions) and redeploy."
fi
if [ ${#blocked[@]} -eq 0 ]; then
  if [ ${#missing[@]} -gt 0 ]; then exit 1; fi
  echo "All callables reachable."
else
  echo "Run these to fix:"
  for fn in "${blocked[@]}"; do
    echo "  gcloud run services add-iam-policy-binding arccms-$(echo "$fn" | tr '[:upper:]' '[:lower:]') \\"
    echo "    --region=$REGION --member=allUsers --role=roles/run.invoker --project=$PROJECT"
  done
  exit 1
fi
