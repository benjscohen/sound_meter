#!/bin/bash

# Fail on error
set -e

# Check for required environment variables
if [[ -z "$KEYCHAIN_PASSWORD" ]]; then
  echo "Error: KEYCHAIN_PASSWORD is not set."
  exit 1
fi

if [[ -z "$CERTIFICATE_BASE64" ]]; then
  echo "Error: CERTIFICATE_BASE64 is not set."
  exit 1
fi

if [[ -z "$CERTIFICATE_PASSWORD" ]]; then
  echo "Error: CERTIFICATE_PASSWORD is not set."
  exit 1
fi

echo "Setting up keychain and importing certificate..."

# Create temporary keychain
KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

# Import certificate
CERTIFICATE_PATH=$RUNNER_TEMP/certificate.p12
echo -n "$CERTIFICATE_BASE64" | base64 --decode -o $CERTIFICATE_PATH
security import $CERTIFICATE_PATH -P "$CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k $KEYCHAIN_PATH

# Configure keychain
security list-keychain -d user -s $KEYCHAIN_PATH
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

echo "Certificate imported successfully."
