#!/usr/bin/env bash
# Apply a branch ruleset to the repository's default branch.
#
# This script only creates a ruleset (a repository-level setting). It does NOT
# enable secret scanning, push protection, Dependabot security updates, or
# private vulnerability reporting: those calls are commented out at the bottom
# because they change repository security settings and should be enabled
# deliberately.
#
# USAGE
#   scripts/security/apply-ruleset.sh --dry-run    # print the payload, change nothing
#   scripts/security/apply-ruleset.sh              # create the ruleset with gh
#
# REQUIREMENTS
#   - gh authenticated with admin rights on the repository
#   - The repository's default branch (resolved with `gh repo view`)
#
# REQUIRED CHECKS
#   Status-check names are placeholders until the Part 2 workflows exist.
#   Override them without editing the script:
#     REQUIRED_CHECKS="ci,security / dependency-review" scripts/security/apply-ruleset.sh
#   The default `ci` is the existing job in .github/workflows/ci.yml. The second
#   entry is an intentionally failing-to-match placeholder so this is not
#   silently applied with only one gate.

set -euo pipefail

DRY_RUN=false
REPO=""

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --repo)
      if [ $# -lt 2 ]; then
        echo "error: --repo requires OWNER/REPO" >&2
        exit 2
      fi
      REPO="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required" >&2
  exit 1
fi

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
fi

if [ -z "$REPO" ]; then
  echo "error: could not resolve repository; pass --repo OWNER/REPO" >&2
  exit 1
fi

DEFAULT_BRANCH="$(gh repo view "$REPO" --json defaultBranchRef --jq '.defaultBranchRef.name')"
if [ -z "$DEFAULT_BRANCH" ] || [ "$DEFAULT_BRANCH" = "null" ]; then
  echo "error: could not resolve the default branch for $REPO" >&2
  exit 1
fi

# Comma-separated status-check contexts. TODO(Part 2): replace the placeholder
# with the real workflow/job names before running this for real.
REQUIRED_CHECKS="${REQUIRED_CHECKS:-ci,security-placeholder-confirm-after-part-2}"

STATUS_CHECKS_JSON=""
IFS=',' read -r -a CHECK_ARRAY <<<"$REQUIRED_CHECKS"
for check in "${CHECK_ARRAY[@]}"; do
  # Trim surrounding whitespace.
  check="$(printf '%s' "$check" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$check" ] || continue
  escaped="${check//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  if [ -n "$STATUS_CHECKS_JSON" ]; then
    STATUS_CHECKS_JSON="$STATUS_CHECKS_JSON,"
  fi
  STATUS_CHECKS_JSON="$STATUS_CHECKS_JSON{\"context\":\"$escaped\"}"
done

if [ -z "$STATUS_CHECKS_JSON" ]; then
  echo "error: REQUIRED_CHECKS resolved to an empty list" >&2
  exit 1
fi

PAYLOAD="$(cat <<JSON
{
  "name": "default-branch-protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [$STATUS_CHECKS_JSON]
      }
    },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}
JSON
)"

echo "Repository:      $REPO"
echo "Default branch:  $DEFAULT_BRANCH (~DEFAULT_BRANCH)"
echo "Required checks: $REQUIRED_CHECKS"
echo "Bypass actors:   none"
echo

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN - no API call made. Payload that would be POSTed to"
  echo "repos/$REPO/rulesets:"
  echo
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

echo "Creating ruleset on repos/$REPO/rulesets ..."
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "repos/$REPO/rulesets" \
  --input - <<<"$PAYLOAD"

echo
echo "Ruleset created. Verify in Settings -> Rules -> Rulesets."
echo "Enabling 'Require review from Code Owners' also requires .github/CODEOWNERS,"
echo "which this repository now has."

# ─────────────────────────────────────────────────────────────────────────────
# NOT EXECUTED. Uncomment one block at a time, after reviewing its effect.
# These change repository security settings, so they are deliberately manual.
#
# Secret scanning (GitHub Advanced Security; availability depends on the plan
# and repository visibility):
#
# gh api --method PATCH \
#   -H "Accept: application/vnd.github+json" \
#   "repos/$REPO" \
#   -f 'security_and_analysis[secret_scanning][status]=enabled'
#
# Push protection (blocks pushes containing detected secrets):
#
# gh api --method PATCH \
#   -H "Accept: application/vnd.github+json" \
#   "repos/$REPO" \
#   -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
#
# Dependabot security updates (Dependabot PRs for known vulnerabilities):
#
# gh api --method PUT \
#   -H "Accept: application/vnd.github+json" \
#   "repos/$REPO/automated-security-fixes"
#
# Private vulnerability reporting (Security tab -> Report a vulnerability):
#
# gh api --method PUT \
#   -H "Accept: application/vnd.github+json" \
#   "repos/$REPO/private-vulnerability-reporting"
# ─────────────────────────────────────────────────────────────────────────────
