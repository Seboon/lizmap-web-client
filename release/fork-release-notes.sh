#!/bin/sh
# Write the GitHub release notes of a fork release on stdout.
#
# Usage: release/fork-release-notes.sh TAG [REPOSITORY]
#   TAG         tag of the release, e.g. 3.9.11-fork.1 (a "## TAG" section
#               must exist in CHANGELOG-fork.md)
#   REPOSITORY  owner/name on GitHub, for the comparison link (optional)
#
# Used by .github/workflows/fork-release.yml; can also be run by hand.
#
# @copyright 2026 S.Poudroux / Kheper 3D
# @license MPL-2.0
set -e
cd "$(dirname "$0")/.."

TAG="$1"
REPO="$2"
if [ -z "$TAG" ]; then
    echo "Usage: $0 TAG [REPOSITORY]" >&2
    exit 1
fi

# Official version the fork is based on: the part before "-fork".
BASE="${TAG%%-fork*}"

# Section "## TAG ..." of the changelog, without its title, up to the next
# "## " title.
CHANGES=$(awk -v tag="$TAG" '
    /^## / { if (found) exit; if ($2 == tag) { found = 1; next } }
    found { print }
' CHANGELOG-fork.md)
if [ -z "$(printf '%s' "$CHANGES" | tr -d '[:space:]')" ]; then
    echo "ERROR: no \"## $TAG\" section in CHANGELOG-fork.md" >&2
    exit 1
fi

cat <<NOTES
Release of the fork of Lizmap Web Client, based on the official version $BASE.

To install or upgrade Lizmap, **use only the file \`lizmap-web-client-$TAG.zip\`** below: it contains the PHP dependencies (with the fork patches) and the built JavaScript. The *Source code* archives are the source only: they must be built first (see the README).

## Requirements

Same as the official Lizmap Web Client $BASE:

* PHP 8.1 minimum
* QGIS Server 3.34 minimum
* Lizmap QGIS Server plugin 2.13.0 minimum
* QGIS projects targeting Lizmap Web Client 3.6.0 minimum
* Lizmap QGIS Desktop plugin 4.4.9 recommended

For the elevation profile: the ElevationProfile QGIS Server plugin.

Upgrade from an official version up to $BASE only.

## Changelog
$CHANGES
NOTES

# Comparison link with the previous fork release, or with the official
# version for the first one.
PREVIOUS=$(git tag --list '*-fork.*' --sort=-version:refname | grep -vx "$TAG" | head -n 1 || true)
[ -n "$PREVIOUS" ] || PREVIOUS="$BASE"
if [ -n "$REPO" ] && git rev-parse -q --verify "refs/tags/$PREVIOUS" >/dev/null; then
    echo
    echo "**Full changelog**: https://github.com/$REPO/compare/$PREVIOUS...$TAG"
fi
