#!/usr/bin/env bash
#
# scan-suspicious.sh — offline heuristics for code that looks like it was
# appended, obfuscated, or installed rather than written.
#
# Background: this repository was once modified by a merged PR that appended
# obfuscated JavaScript to its config files. Nothing in a normal diff review
# flags that as a class of change, so this scanner looks for the mechanics
# instead: dynamic code execution, encoded payloads, install-time execution,
# dependency sources outside the registry, and code that appears after a config
# file's export has already ended.
#
# It is a heuristic gate, not a malware detector. Every finding is a prompt to
# read the line, and every suppression must be justified in
# .github/security/scan-allowlist.txt.
#
# Usage: bash scripts/security/scan-suspicious.sh
#
# Environment:
#   SCAN_BASE_REF  Git ref to diff against for workflow and dependency checks
#                  (default: origin/main when it exists). In CI this is set to
#                  origin/<base branch>.
#
# Exit codes: 0 clean, 1 findings, 2 usage/tooling/allowlist error.

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "scan-suspicious: not inside a git repository" >&2
  exit 2
}
cd "$ROOT" || exit 2

if ! command -v rg >/dev/null 2>&1; then
  echo "scan-suspicious: ripgrep (rg) is required but not on PATH" >&2
  exit 2
fi

ALLOWLIST=".github/security/scan-allowlist.txt"
findings=0
warnings=0
declare -a SUMMARY_IDS=()
declare -a SUMMARY_COUNTS=()

note() {
  local id=$1
  shift
  findings=$((findings + 1))
  local i found=0
  for i in "${!SUMMARY_IDS[@]}"; do
    if [ "${SUMMARY_IDS[$i]}" = "$id" ]; then
      SUMMARY_COUNTS[$i]=$((SUMMARY_COUNTS[$i] + 1))
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    SUMMARY_IDS+=("$id")
    SUMMARY_COUNTS+=(1)
  fi
  printf '%s\n' "$*"
}

warn() {
  warnings=$((warnings + 1))
  printf 'warning: %s\n' "$*"
}

# ---------------------------------------------------------------------------
# Allowlist: one `path:check-id` per line, each preceded by a comment that says
# why it is safe. A malformed or unjustified entry is an error, not a warning,
# so suppressions cannot accumulate silently.
# ---------------------------------------------------------------------------
declare -a ALLOW_PATHS=()
declare -a ALLOW_IDS=()

if [ -f "$ALLOWLIST" ]; then
  entry_line=0
  justification=""
  while IFS= read -r line || [ -n "$line" ]; do
    entry_line=$((entry_line + 1))
    case "$line" in
      "")
        justification=""
        continue
        ;;
      "#"*)
        justification="${line#\#}"
        justification="${justification# }"
        continue
        ;;
    esac

    if [ -z "$justification" ]; then
      echo "scan-suspicious: $ALLOWLIST:$entry_line has no justification comment above it" >&2
      exit 2
    fi

    case "$line" in
      *:*)
        allow_path="${line%:*}"
        allow_id="${line##*:}"
        ;;
      *)
        echo "scan-suspicious: $ALLOWLIST:$entry_line is not path:check-id" >&2
        exit 2
        ;;
    esac

    if ! printf '%s' "$allow_id" | grep -Eq '^[a-z0-9-]+$'; then
      echo "scan-suspicious: $ALLOWLIST:$entry_line has an invalid check id '$allow_id'" >&2
      exit 2
    fi

    ALLOW_PATHS+=("$allow_path")
    ALLOW_IDS+=("$allow_id")
    justification=""
  done <"$ALLOWLIST"
fi

is_allowed() {
  local path=$1 id=$2 i
  for i in "${!ALLOW_PATHS[@]}"; do
    [ "${ALLOW_IDS[$i]}" = "$id" ] || continue
    # Deliberate glob match: the right-hand side is a pattern from the allowlist.
    # shellcheck disable=SC2053
    if [[ "$path" == ${ALLOW_PATHS[$i]} ]]; then
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Tracked files, minus generated output. `git ls-files` is what makes this a
# repository check rather than a filesystem check: an ignored or generated file
# cannot create a finding, and deleting a file from git removes it here too.
# ---------------------------------------------------------------------------
declare -a ALL_FILES=()
mapfile -d '' ALL_FILES < <(git ls-files -z)

select_files() {
  local file ext
  for file in "${ALL_FILES[@]}"; do
    case "$file" in
      node_modules/* | dist/* | .next/* | build/* | vendor/*) continue ;;
    esac
    for ext in "$@"; do
      case "$file" in
        *."$ext")
          printf '%s\0' "$file"
          break
          ;;
      esac
    done
  done
}

# run_pattern <check-id> <regex> <message> <extension>...
run_pattern() {
  local id=$1 regex=$2 message=$3
  shift 3
  local -a files=()
  mapfile -d '' files < <(select_files "$@")
  [ "${#files[@]}" -eq 0 ] && return

  local output
  output=$(rg -n --no-heading --color never --max-columns 300 \
    --max-columns-preview -e "$regex" -- "${files[@]}" 2>/dev/null) || true
  [ -z "$output" ] && return

  local hit path line
  while IFS= read -r hit; do
    path="${hit%%:*}"
    line="${hit#*:}"
    line="${line%%:*}"
    is_allowed "$path" "$id" && continue
    note "$id" "$path:$line: [$id] $message"
  done <<<"$output"
}

# ---------------------------------------------------------------------------
# 1. Long lines in source/config files. Minified assets are not excluded here
#    by name; if one is legitimate it needs an explicit allowlist entry.
# ---------------------------------------------------------------------------
skip_lockfile() {
  case "$1" in
    package-lock.json | npm-shrinkwrap.json | yarn.lock | pnpm-lock.yaml) return 0 ;;
  esac
  return 1
}

while IFS= read -r -d '' file; do
  skip_lockfile "$file" && continue
  is_allowed "$file" "long-line" && continue
  awk -v path="$file" '
    length($0) > 1000 {
      printf "%s:%d: [long-line] line is %d characters (limit 1000)\n", path, NR, length($0)
    }
  ' "$file"
done < <(select_files js jsx ts tsx mjs cjs json yml yaml sh) >/tmp/scan-long-lines.$$
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  note "long-line" "$hit"
done </tmp/scan-long-lines.$$
rm -f /tmp/scan-long-lines.$$

# ---------------------------------------------------------------------------
# 2. Dynamic code execution and encoded payloads.
# ---------------------------------------------------------------------------
run_pattern "eval" 'eval\(' "dynamic eval() call" js jsx ts tsx mjs cjs
run_pattern "new-function" 'new Function\(' "Function constructor (dynamic code)" js jsx ts tsx mjs cjs
run_pattern "atob" '\batob\(' "base64 decode via atob()" js jsx ts tsx mjs cjs
run_pattern "base64-buffer" 'Buffer\.from\([^)]*["'"'"']base64["'"'"']' "Buffer.from(..., 'base64') decode" js jsx ts tsx mjs cjs
run_pattern "child-process" "require\\(['\"](node:)?child_process['\"]\\)|from[[:space:]]+['\"](node:)?child_process['\"]|import\\(['\"](node:)?child_process['\"]\\)" "child process execution" js jsx ts tsx mjs cjs
run_pattern "config-network" "require\\(['\"](http|https|net)['\"]\\)" "raw network module imported by a config file" js ts mjs cjs
run_pattern "pipe-to-shell" '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(sh|bash)' "download piped into a shell" js ts mjs cjs sh yml yaml
run_pattern "hex-identifier" '_0x[0-9a-fA-F]{4,}' "obfuscated _0x... identifier" js jsx ts tsx mjs cjs
run_pattern "global-assignment" "global[[:space:]]*\\[[[:space:]]*['\"][^'\"]{1,3}['\"][[:space:]]*\\][[:space:]]*=" "obfuscated assignment onto a short global key" js jsx ts tsx mjs cjs

# Runs of String.fromCharCode: one call is ordinary encoding, a run of three or
# more on one line is how payloads are assembled without a literal string.
while IFS= read -r -d '' file; do
  is_allowed "$file" "fromcharcode-run" && continue
  awk -v path="$file" '
    {
      line_copy = $0
      count = gsub(/String\.fromCharCode\(/, "", line_copy)
      if (count >= 3) {
        printf "%s:%d: [fromcharcode-run] %d String.fromCharCode calls on one line\n", path, NR, count
      }
    }
  ' "$file"
done < <(select_files js jsx ts tsx mjs cjs) >/tmp/scan-fromcharcode.$$
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  note "fromcharcode-run" "$hit"
done </tmp/scan-fromcharcode.$$
rm -f /tmp/scan-fromcharcode.$$

# Hex and base64 blobs over 200 characters. The message deliberately omits the
# match: printing it would put the payload (or secret) in the CI log.
while IFS= read -r -d '' file; do
  is_allowed "$file" "encoded-blob" && continue
  rg -n --no-heading --color never --max-columns 60 --max-columns-preview \
    -e '[A-Za-z0-9+/]{200,}={0,2}' -e '[0-9a-fA-F]{200,}' -- "$file" 2>/dev/null |
    while IFS= read -r hit; do
      line="${hit#*:}"
      line="${line%%:*}"
      printf '%s:%s: [encoded-blob] base64/hex run longer than 200 characters\n' "$file" "$line"
    done
done < <(select_files js jsx ts tsx mjs cjs json yml yaml sh) >/tmp/scan-blobs.$$
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  note "encoded-blob" "$hit"
done </tmp/scan-blobs.$$
rm -f /tmp/scan-blobs.$$

# ---------------------------------------------------------------------------
# 3. Code appended after a config file's export block. This is the exact shape
#    of the earlier incident: the file still ends with a normal-looking
#    `export default` line, with additional code below it.
# ---------------------------------------------------------------------------
for file in "${ALL_FILES[@]}"; do
  case "$file" in
    node_modules/* | dist/* | .next/* | build/*) continue ;;
    *.config.js | *.config.jsx | *.config.ts | *.config.tsx | *.config.mjs | *.config.cjs) ;;
    *) continue ;;
  esac
  is_allowed "$file" "appended-code" && continue
  appended=$(awk '
    { lines[NR] = $0 }
    END {
      last = 0
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /^[[:space:]]*(export default|module\.exports)/) last = i
      }
      if (last == 0) exit
      close_at = 0
      for (i = last; i <= NR; i++) {
        if (lines[i] ~ /^[}\)\]];?[[:space:]]*$/) close_at = i
      }
      if (close_at == 0) exit
      for (i = close_at + 1; i <= NR; i++) {
        s = lines[i]
        sub(/^[[:space:]]+/, "", s)
        sub(/[[:space:]]+$/, "", s)
        if (s == "" || s ~ /^\/\// || s ~ /^\/\*/ || s ~ /^\*/) continue
        print i
        exit
      }
    }
  ' "$file")
  if [ -n "$appended" ]; then
    note "appended-code" "$file:$appended: [appended-code] code after the closing brace of the export block"
  fi
done

# ---------------------------------------------------------------------------
# 4. Install-time execution and dependency provenance.
# ---------------------------------------------------------------------------
while IFS= read -r hit; do
  is_allowed "package.json" "install-hook" && break
  file="${hit%%:*}"
  rest="${hit#*:}"
  line="${rest%%:*}"
  note "install-hook" "$file:$line: [install-hook] lifecycle script would run on install"
done < <(rg -n --no-heading --color never \
  -e '"(preinstall|install|postinstall|prepare|prepublish|prepublishOnly)"[[:space:]]*:' \
  -- package.json 2>/dev/null)

# npm lockfiles: every package must come from the public registry, or from the
# local vendored tarball recorded as `file:`. Anything else — git URLs, GitHub
# shorthands, tarballs on another host, a private registry — is a finding.
for lockfile in package-lock.json npm-shrinkwrap.json; do
  [ -f "$lockfile" ] || continue
  is_allowed "$lockfile" "dependency-source" && continue
  grep -nE '^[[:space:]]*"resolved":[[:space:]]*"[^"]+"' "$lockfile" 2>/dev/null |
    sed -E 's/^([0-9]+):[[:space:]]*"resolved":[[:space:]]*"([^"]+)".*/\1\t\2/' |
    awk -F '\t' '
      {
        url = $2
        if (url ~ /^https:\/\/registry\.npmjs\.org\//) next
        if (url ~ /^file:/) next
        if (url ~ /^git\+/ || url ~ /^git:\/\// || url ~ /^github:/ || url ~ /^git@/) {
          kind = "git"
        } else if (url ~ /^https?:\/\//) {
          kind = "tarball or non-default registry"
        } else {
          kind = "unrecognised source"
        }
        printf "%s\t%s\t%s\n", $1, url, kind
      }
    ' |
    while IFS=$'\t' read -r line url kind; do
      note "dependency-source" "$lockfile:$line: [dependency-source] $kind: $url"
    done
done

# Typosquat heuristic: flag (never fail) newly added dependencies whose name is
# one or two edits away from a popular package. Only runs when a base ref is
# available, so it compares against the branch point rather than the whole file.
read_dependency_names() {
  awk '
    /^[[:space:]]*"(dev)?[dD]ependencies"[[:space:]]*:[[:space:]]*\{/ { in_deps = 1; next }
    in_deps && /^[[:space:]]*\}/ { in_deps = 0; next }
    in_deps && match($0, /^[[:space:]]*"[^"]+"/) {
      name = substr($0, RSTART, RLENGTH)
      gsub(/^[[:space:]]*"|"$/, "", name)
      print name
    }
  ' "$1"
}

levenshtein() {
  local a=$1 b=$2 i j
  local -a prev cur
  local la=${#a} lb=${#b}
  for ((j = 0; j <= lb; j++)); do prev[j]=$j; done
  for ((i = 1; i <= la; i++)); do
    cur[0]=$i
    for ((j = 1; j <= lb; j++)); do
      if [ "${a:i-1:1}" = "${b:j-1:1}" ]; then
        cur[j]=${prev[j-1]}
      else
        local del=${prev[j]} ins=${cur[j-1]} sub=${prev[j-1]}
        local min=$del
        [ "$ins" -lt "$min" ] && min=$ins
        [ "$sub" -lt "$min" ] && min=$sub
        cur[j]=$((min + 1))
      fi
    done
    prev=("${cur[@]}")
  done
  printf '%s' "${prev[$lb]}"
}

BASE_REF=${SCAN_BASE_REF:-}
if [ -z "$BASE_REF" ] && git rev-parse --verify -q origin/main >/dev/null; then
  BASE_REF=origin/main
fi

if [ -n "$BASE_REF" ] && git rev-parse --verify -q "$BASE_REF" >/dev/null; then
  current_deps=$(mktemp)
  base_deps=$(mktemp)
  read_dependency_names package.json | sort -u >"$current_deps"
  git show "$BASE_REF:package.json" 2>/dev/null | read_dependency_names /dev/stdin | sort -u >"$base_deps"
  popular="react react-dom next zod typescript eslint prettier express lodash axios webpack vite tailwindcss postcss dotenv chalk commander uuid moment jest mocha vitest tsx ts-node node-fetch cross-env rimraf glob minimist semver debug ws jsonwebtoken bcrypt mongoose prisma redis cors helmet nodemon concurrently husky lint-staged"
  while IFS= read -r dep; do
    [ -n "$dep" ] || continue
    base_name=${dep##*/}
    for known in $popular; do
      [ "$base_name" = "$known" ] && continue
      case "$dep" in
        @*)
          # A scoped package is compared on its package name, not the scope.
          ;;
      esac
      distance=$(levenshtein "$base_name" "$known")
      limit=1
      [ "${#known}" -ge 8 ] && limit=2
      if [ "$distance" -le "$limit" ] && [ "$distance" -gt 0 ]; then
        warn "$dep is $distance edit(s) from popular package '$known' (typosquat check, not gating)"
      fi
    done
  done < <(comm -13 "$base_deps" "$current_deps")
  rm -f "$current_deps" "$base_deps"
else
  warn "no usable base ref; skipping typosquat and workflow-diff checks"
fi

# ---------------------------------------------------------------------------
# 5. Hidden characters: zero-width spaces/joiners, bidi overrides, and other
#    characters that make source read differently than it executes.
# ---------------------------------------------------------------------------
while IFS= read -r -d '' file; do
  is_allowed "$file" "hidden-unicode" && continue
  rg -n --pcre2 --no-heading --color never \
    -e '[\x{00AD}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]' \
    -- "$file" 2>/dev/null |
    while IFS= read -r hit; do
      line="${hit#*:}"
      line="${line%%:*}"
      printf '%s:%s: [hidden-unicode] zero-width or bidi control character\n' "$file" "$line"
    done
done < <(select_files js jsx ts tsx mjs cjs json yml yaml sh md) >/tmp/scan-unicode.$$
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  note "hidden-unicode" "$hit"
done </tmp/scan-unicode.$$
rm -f /tmp/scan-unicode.$$

# ---------------------------------------------------------------------------
# 6. Workflow changes that weaken the controls established for this repository.
#    Only *added* lines in workflows are considered, so a PR is not blamed for
#    a pattern that already existed on the base branch.
# ---------------------------------------------------------------------------
if [ -n "${BASE_REF:-}" ] && git rev-parse --verify -q "$BASE_REF" >/dev/null; then
  git diff --unified=0 "$BASE_REF"...HEAD -- .github/workflows/ 2>/dev/null |
    awk '
      /^diff --git / { next }
      /^\+\+\+ b\// { file = substr($0, 7); next }
      /^@@ / {
        match($0, /\+[0-9]+/)
        line = substr($0, RSTART + 1, RLENGTH - 1) + 0
        next
      }
      /^\+/ && !/^\+\+\+/ && file != "" {
        printf "%s\t%d\t%s\n", file, line, substr($0, 2)
        line++
      }
    ' |
    while IFS=$'\t' read -r file line content; do
      if [[ "$content" == *pull_request_target* ]] && ! is_allowed "$file" "workflow-pull-request-target"; then
        note "workflow-pull-request-target" "$file:$line: [workflow-pull-request-target] workflow now runs on pull_request_target"
      fi
      if [[ "$content" =~ permissions:[[:space:]]*write-all ]] && ! is_allowed "$file" "workflow-write-all"; then
        note "workflow-write-all" "$file:$line: [workflow-write-all] workflow grants write-all permissions"
      fi
      if [[ "$content" =~ uses:[[:space:]]*([^[:space:]]+) ]]; then
        ref="${BASH_REMATCH[1]}"
        case "$ref" in
          ./*) continue ;;
        esac
        sha="${ref##*@}"
        if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]] && ! is_allowed "$file" "workflow-unpinned"; then
          note "workflow-unpinned" "$file:$line: [workflow-unpinned] action is not pinned to a 40-char commit SHA"
        fi
      fi
    done
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo
if [ "$warnings" -gt 0 ]; then
  echo "$warnings warning(s) (not gating)"
fi
if [ "$findings" -eq 0 ]; then
  echo "scan-suspicious: no findings"
  exit 0
fi

echo "scan-suspicious: $findings finding(s)"
for i in "${!SUMMARY_IDS[@]}"; do
  printf '  %-32s %s\n' "${SUMMARY_IDS[$i]}" "${SUMMARY_COUNTS[$i]}"
done
echo "Review each line above. Suppress a verified false positive in $ALLOWLIST with a comment explaining why."
exit 1
