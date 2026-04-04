#!/bin/sh
set -e

DICT_URL="https://github.com/f3liz-dev/sudachi.rs/releases/download/v0.1.7/system_core.xdic"

echo "Downloading dictionary file from ${DICT_URL}..."
echo

# Create dict directory if it doesn't exist
mkdir -p dict

curl -L "${DICT_URL}" -o "dict/system_core.xdic"

echo
echo "Placed dictionary file to \`dict/system_core.xdic\` ."
