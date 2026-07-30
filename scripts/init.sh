#!/usr/bin/env bash
#
# Rename a copy of this template so it stops thinking it's the template.
#
#   make init                                        # infers everything from origin
#   make init MODULE=github.com/you/thing NAME=Thing
#
# There are three identifiers to replace and they are passed in as arguments,
# never written here. That is deliberate: bash reads a script lazily, so a
# script that rewrites its own text mid-run is a real bug, and the final "no old
# identifier survives" check would otherwise trip on this file forever. The
# Makefile is where the template's identity lives; make has already read it by
# the time we rewrite it.
set -euo pipefail

old_module=${1:?usage: init.sh OLD_MODULE OLD_NAME OLD_SLUG}
old_name=${2:?usage: init.sh OLD_MODULE OLD_NAME OLD_SLUG}
old_slug=${3:?usage: init.sh OLD_MODULE OLD_NAME OLD_SLUG}

cd "$(git rev-parse --show-toplevel)"

# MODULE defaults to whatever origin points at, so the common case is a bare
# `make init` right after clicking "Use this template".
module=${MODULE:-}
if [ -z "$module" ]; then
  module=$(git remote get-url origin 2>/dev/null || true)
  if [ -z "$module" ]; then
    echo "no origin remote, so MODULE can't be inferred. Pass it: make init MODULE=github.com/you/thing" >&2
    exit 1
  fi
fi

# https://host/owner/repo.git and git@host:owner/repo.git both become
# host/owner/repo, which is what a Go module path looks like. This runs on an
# explicit MODULE too, because pasting the repo URL you just copied from GitHub
# is the obvious thing to do.
module=${module%.git}
module=${module%/}
module=${module#*://}
module=${module#*@}
module=${module/://}

# A module with no path element gives an empty slug, and an empty slug would
# replace the old one with nothing everywhere - a silently gutted tree.
slug=${module##*/}
case "$module" in
  */*) ;;
  *) echo "MODULE must look like a Go module path, e.g. github.com/you/thing (got: $module)" >&2; exit 1 ;;
esac
if [ -z "$slug" ]; then
  echo "MODULE has no repository name: $module" >&2
  exit 1
fi

name=${NAME:-$slug}

if [ "$module" = "$old_module" ]; then
  echo "MODULE is still $old_module - nothing to rename. Point origin at your own repo, or pass MODULE=github.com/you/thing" >&2
  exit 1
fi

echo "==> module: $old_module -> $module"
echo "==> name:   $old_name -> $name"
echo "==> slug:   $old_slug -> $slug"

# Collect the tracked text files. Binary files are skipped so image assets don't
# get mangled, and the text test runs per file rather than through
# `grep -IlZ | xargs -0` because BSD and GNU grep disagree about which flag
# means NUL-delimited output.
files=()
while IFS= read -r -d '' file; do
  if grep -Iq . "$file" 2>/dev/null; then
    files+=("$file")
  fi
done < <(git ls-files -z)

if [ ${#files[@]} -eq 0 ]; then
  echo "no tracked text files to rewrite - is this a git checkout?" >&2
  exit 1
fi

# All three substitutions happen in one pass, longest match first. Sequential
# passes would cascade: the slug is a substring of the module path, and a new
# name that contains an old one (`MODULE=github.com/you/go-home-template-plus`)
# would get rewritten a second time into `go-home-template-plus-plus` - silently,
# because by then the old identifier really is gone and the check below passes.
# One pass with an alternation can't do that: every byte is rewritten at most
# once, and the longest-first ordering means the module path wins over its own
# trailing slug.
OLD_MODULE="$old_module" NEW_MODULE="$module" \
OLD_NAME="$old_name" NEW_NAME="$name" \
OLD_SLUG="$old_slug" NEW_SLUG="$slug" \
perl -pi -e '
  BEGIN {
    %map = (
      $ENV{OLD_MODULE} => $ENV{NEW_MODULE},
      $ENV{OLD_NAME}   => $ENV{NEW_NAME},
      $ENV{OLD_SLUG}   => $ENV{NEW_SLUG},
    );
    $re = join "|", map { quotemeta } sort { length($b) <=> length($a) } keys %map;
  }
  s/($re)/$map{$1}/g;
' -- "${files[@]}"

# The check that makes this reliable rather than a checklist people half-follow.
# An old identifier that survives *inside* the new identity is not a leftover -
# `go-home-template-plus` contains `go-home-template` by construction - so those
# get reported as unchecked rather than failed.
stale=()
for old in "$old_module" "$old_name" "$old_slug"; do
  case "$module|$name|$slug" in
    *"$old"*) echo "note: not checking for \"$old\" - your new identity contains it" ;;
    *) stale+=(-e "$old") ;;
  esac
done

if [ ${#stale[@]} -gt 0 ]; then
  leftovers=$(grep -lF "${stale[@]}" -- "${files[@]}" || true)
  if [ -n "$leftovers" ]; then
    echo >&2
    echo "rename incomplete - the old identity survives in:" >&2
    echo "$leftovers" >&2
    exit 1
  fi
fi

echo
echo "Renamed. Next:"
echo "  make setup    # deps, upload dir, .env, first frontend build"
echo "  make build && make run"
