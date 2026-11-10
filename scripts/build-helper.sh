#!/bin/sh
# Compiles native/sm-helper.swift into a universal (arm64 + x86_64) binary at
# native/bin/sm-helper. Needs the Xcode command line tools.
set -e

cd "$(dirname "$0")/.."
SRC=native/sm-helper.swift
OUT=native/bin
MIN_OS=13.0

mkdir -p "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for ARCH in arm64 x86_64; do
    xcrun swiftc -O -target "$ARCH-apple-macos$MIN_OS" "$SRC" -o "$TMP/sm-helper-$ARCH"
done

lipo -create "$TMP/sm-helper-arm64" "$TMP/sm-helper-x86_64" -output "$OUT/sm-helper"
chmod +x "$OUT/sm-helper"
echo "Built $OUT/sm-helper ($(lipo -archs "$OUT/sm-helper"))"
