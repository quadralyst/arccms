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
#   gcloud run services add-iam-policy-binding <lowercased-name> \
#     --region=us-central1 --member=allUsers --role=roles/run.invoker --project=<id>
# (or Cloud Console → Cloud Run → service → Security → allow unauthenticated)
#
# Usage: ./check-callable-access.sh [projectId] [region]
set -uo pipefail

PROJECT="${1:-xlm-project-864ff}"
REGION="${2:-us-central1}"
BASE="https://${REGION}-${PROJECT}.cloudfunctions.net"

# Every onCall function the browser invokes. Keep in sync with functions/src/index.ts.
CALLABLES=(
  requestFormOtp verifyFormOtp
  adminAddContact adminSetContactConsent adminUpdateContactLists adminSetContactDisabled
  adminSetContactTags adminUpsertContactField adminDeleteContactField adminSetContactFields
  backfillContacts backfillFormLists backfillPendingContacts stampFormTargetLists
  migrateTagsToContacts migrateFormDataToContactFields migrateWelcomeToSequences
  normalizeWaitlistTemplateIds dedupeEmailTemplates seedEmailTemplates
  previewBroadcastAudience sendTestEmail sendAnnouncement unsubscribeLegacyLink
  getOptimizedLeaderboard ensureWaitlistExists
)

blocked=()
for fn in "${CALLABLES[@]}"; do
  resp=$(curl -s -m 20 -w '\n%{http_code}' -X POST "$BASE/$fn" -H "Content-Type: application/json" -d '{"data":{}}' 2>/dev/null)
  code=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  if [ -z "$code" ]; then
    printf "%-34s ⚠️  no response\n" "$fn"
  elif [ "$code" = "404" ]; then
    # Not deployed. Checked explicitly because a 404 body is not "403 Forbidden",
    # so a naive check would report a missing function as healthy.
    printf "%-34s ⚠️  NOT DEPLOYED (404)\n" "$fn"
  elif echo "$body" | grep -qi "403 Forbidden"; then
    printf "%-34s ❌ BLOCKED by Cloud Run — needs invoker grant\n" "$fn"
    blocked+=("$fn")
  else
    printf "%-34s ✅ reachable\n" "$fn"
  fi
done

echo
if [ ${#blocked[@]} -eq 0 ]; then
  echo "All callables reachable."
else
  echo "Run these to fix:"
  for fn in "${blocked[@]}"; do
    echo "  gcloud run services add-iam-policy-binding $(echo "$fn" | tr '[:upper:]' '[:lower:]') \\"
    echo "    --region=$REGION --member=allUsers --role=roles/run.invoker --project=$PROJECT"
  done
  exit 1
fi
