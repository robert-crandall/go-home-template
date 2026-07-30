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
  origin=$(git remote get-url origin 2>/dev/null || true)
  if [ -z "$origin" ]; then
    echo "no origin remote, so MODULE can't be inferred. Pass it: make init MODULE=github.com/you/thing" >&2
    exit 1
  fi
  # https://host/owner/repo.git and git@host:owner/repo.git both become
  # host/owner/repo, which is what a Go module path looks like.
  module=${origin%.git}
  module=${module#*://}
  module=${module#*@}
  module=${module/://}
fi

case "$module" in
  */*) ;;
  *) echo "MODULE must look like a Go module path, e.g. github.com/you/thing (got: $module)" >&2; exit 1 ;;
esac

slug=${module##*/}
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

replace() {
  OLD="$1" NEW="$2" perl -pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/g' -- "${files[@]}"
}

# Order matters: the slug is a substring of the module path, so replacing it
# first would leave "github.com/robert-crandall/<newslug>" behind.
#
# An identifier the new app happens to share (forking into another org under the
# same repo name keeps the slug) is skipped rather than replaced, and dropped
# from the check below - otherwise the check fails on a string that is now
# legitimately the app's own.
stale=()
for pair in "$old_module|$module" "$old_name|$name" "$old_slug|$slug"; do
  old=${pair%%|*}
  new=${pair##*|}
  if [ "$old" != "$new" ]; then
    replace "$old" "$new"
    stale+=(-e "$old")
  fi
done

# The check that makes this reliable rather than a checklist people half-follow.
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
