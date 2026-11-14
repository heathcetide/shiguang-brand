#!/usr/bin/env bash
# Release ling-base modules using their current go.mod paths.
# New module paths start at v0.1.0; historical tags are never moved or reused.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
PKG=""
LEVEL="patch"
ALL=false
DRY_RUN=false
LIST_TAGS=false
MODULE_ROOT="github.com/LingByte/ling-base"

usage() {
  printf '%s\n' \
    'Usage: scripts/release.sh --pkg <dir> [--level patch|minor|major] [--dry-run]' \
    '       scripts/release.sh --all [--level patch|minor|major] [--dry-run]' \
    '       scripts/release.sh --pkg <dir> --list-tags' \
    '' \
    'Examples: --pkg common/stores, --pkg providers/voice/recognizer, --pkg lingcli' \
    '--all releases libraries; release lingcli separately after publishing libraries.' \
    'This script creates local tags only and requires a clean working tree.'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pkg|--level)
      [[ $# -ge 2 && "$2" != --* ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      if [[ "$1" == --pkg ]]; then PKG="$2"; else LEVEL="$2"; fi
      shift 2 ;;
    --all) ALL=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --list-tags) LIST_TAGS=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
done

[[ "$LEVEL" == patch || "$LEVEL" == minor || "$LEVEL" == major ]] || { printf 'Invalid release level: %s\n' "$LEVEL" >&2; exit 1; }
if [[ "$ALL" == true && ( -n "$PKG" || "$LIST_TAGS" == true ) ]]; then
  printf '%s\n' '--all cannot be combined with --pkg or --list-tags' >&2
  exit 1
fi

normalize_dir() {
  local dir="$1" resolved
  case "${dir#./}" in
    stores|stores/*) printf 'stores moved to common/stores; use --pkg common/%s\n' "${dir#./}" >&2; return 1 ;;
    voice|voice/*) printf 'voice moved to providers/voice; use --pkg providers/%s\n' "${dir#./}" >&2; return 1 ;;
  esac
  resolved=$(cd "$dir" 2>/dev/null && pwd -P) || { printf 'Directory not found: %s\n' "$dir" >&2; return 1; }
  if [[ "$resolved" == "$ROOT" ]]; then
    printf '.\n'
  elif [[ "$resolved" == "$ROOT/"* ]]; then
    printf '%s\n' "${resolved#"$ROOT/"}"
  else
    printf 'Module directory must be inside this repository: %s\n' "$dir" >&2
    return 1
  fi
}

get_module_path() {
  local key value rest
  [[ -f "$1/go.mod" ]] || { printf 'No go.mod in %s\n' "$1" >&2; return 1; }
  while read -r key value rest; do
    if [[ "$key" == module ]]; then printf '%s\n' "${value//\"/}"; return; fi
  done < "$1/go.mod"
  printf 'Missing module directive in %s/go.mod\n' "$1" >&2
  return 1
}

get_prefix() {
  local dir="$1" module expected="$MODULE_ROOT"
  [[ "$dir" == . ]] || expected="$MODULE_ROOT/$dir"
  module=$(get_module_path "$dir") || return 1
  [[ "$module" == "$expected" ]] || { printf 'Module path %s does not match directory %s\n' "$module" "$dir" >&2; return 1; }
  if [[ "$dir" != . ]]; then printf '%s/\n' "${module#"$MODULE_ROOT/"}"; fi
}

# Match only this module's stable tags, not descendant modules or prereleases.
list_module_tags() {
  local prefix tag version
  prefix=$(get_prefix "$1") || return 1
  while IFS= read -r tag; do
    version="${tag#"$prefix"}"
    if [[ "$version" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
      printf '%s\n' "$tag"
    fi
  done < <(git tag --list "${prefix}v*" --sort=-v:refname)
}

get_latest_tag() {
  local tag
  # Read the entire stream to avoid SIGPIPE under set -o pipefail.
  local first=""
  while IFS= read -r tag; do [[ -n "$first" ]] || first="$tag"; done < <(list_module_tags "$1")
  printf '%s\n' "$first"
}

bump_version() {
  local major minor patch
  IFS=. read -r major minor patch <<< "$1"
  case "$2" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
  esac
  printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

has_changes() {
  local tag file
  tag=$(get_latest_tag "$1")
  if [[ -z "$tag" ]]; then return 0; fi
  while IFS= read -r file; do
    if [[ "$file" != *_test.go ]]; then return 0; fi
  done < <(git diff --name-only "$tag" -- "$1")
  return 1
}

release_module() {
  local dir="$1" prefix tag next version
  prefix=$(get_prefix "$dir") || return 1
  tag=$(get_latest_tag "$dir")
  if [[ -z "$tag" ]]; then
    next="${prefix}v0.1.0"
  else
    version="${tag#"${prefix}v"}"
    next="${prefix}v$(bump_version "$version" "$LEVEL")"
  fi
  if [[ "$DRY_RUN" == true ]]; then
    printf '  [dry-run] %s (%s)\n' "$next" "$(get_module_path "$dir")"
  else
    git tag -a "$next" -m "Release $next — $(get_module_path "$dir")"
    printf '  Tagged %s\n' "$next"
  fi
}

if [[ "$ALL" != true ]]; then
  [[ -n "$PKG" ]] || { usage >&2; exit 1; }
  PKG=$(normalize_dir "$PKG")
  get_prefix "$PKG" >/dev/null
  if [[ "$LIST_TAGS" == true ]]; then list_module_tags "$PKG"; exit 0; fi
fi

if [[ "$DRY_RUN" != true ]]; then
  if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
    printf '%s\n' 'Commit all release changes first; refusing to tag an uncommitted working tree. Use --dry-run to preview.' >&2
    exit 1
  fi
  if [[ "$PKG" == lingcli ]]; then
    go run ./scripts/moduleversions --check --require-tags
  fi
fi

if [[ "$ALL" == true ]]; then
  count=0
  while IFS= read -r manifest; do
    dir="${manifest%/go.mod}"
    dir="${dir#./}"
    [[ -n "$dir" ]] || dir=.
    # The CLI must be built with the versions of already published libraries.
    [[ "$dir" != example && "$dir" != lingcli ]] || continue
    if has_changes "$dir"; then release_module "$dir"; count=$((count + 1)); fi
  done < <(find . -type d \( -name .git -o -name vendor -o -name node_modules -o -name embed_source -o -name .next \) -prune -o -name go.mod -print | sort)
  printf '%s module(s). Publish library tags, then run make sync-cli-versions, commit, and release lingcli separately.\n' "$count"
else
  release_module "$PKG"
fi
