#!/bin/sh
# Apply the fork patches to the Composer dependencies in lizmap/vendor.
# Run from the repository root, after `composer install` in lizmap/.
# Patches target jelix/jcommunity-module 1.4.7 and jelix/jelix 1.8.27.
set -e
cd "$(dirname "$0")/../.."
for p in patches/vendor/*.patch; do
    echo "Applying $p"
    patch -p1 -N -d lizmap/vendor < "$p"
done
