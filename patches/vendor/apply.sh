#!/bin/sh
# Apply the fork patches to the Composer dependencies in lizmap/vendor.
#
# Run automatically by Composer after `composer install` / `composer update`
# (see the "scripts" section of lizmap/composer.json), so `make build` and
# `make package` produce a patched vendor/. Can also be run by hand from
# anywhere.
#
# Safe to run several times: a patch already applied is skipped.
# The patches target jelix/jcommunity-module 1.4.7 and jelix/jelix 1.8.27
# (versions pinned in lizmap/composer.json). If a patch neither applies nor
# is already applied, the dependency version has probably changed: the
# script stops with an error and the patch must be updated.
#
# @copyright 2026 S.Poudroux / Kheper 3D
# @license MPL-2.0
set -e
cd "$(dirname "$0")/../.."
VENDOR=lizmap/vendor

for p in patches/vendor/*.patch; do
    if patch -p1 -R -s -f --dry-run -d "$VENDOR" < "$p" >/dev/null 2>&1; then
        echo "Already applied: $p"
    elif patch -p1 -N -s -f --dry-run -d "$VENDOR" < "$p" >/dev/null 2>&1; then
        patch -p1 -N -s -f -d "$VENDOR" < "$p"
        echo "Applied: $p"
    else
        echo "ERROR: $p does not apply to $VENDOR." >&2
        echo "Check the installed versions of jelix/jcommunity-module and jelix/jelix" >&2
        echo "against the ones targeted by the patch, then update the patch." >&2
        exit 1
    fi
done
