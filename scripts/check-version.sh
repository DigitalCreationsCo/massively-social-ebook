#!/bin/bash

# initialize autonomous manifest validation
local_manifest_version=$(node -p "require('./package.json').version")

echo "[+] checking global registry for version: v$local_manifest_version"

# synchronizing with global registry
git fetch --tags --quiet

# FIX: Check if ANY tag exists that starts with our version 
# (e.g., v0.3.2 or v0.3.2-build.1)
remote_collision=$(git ls-remote --tags origin "refs/tags/v$local_manifest_version*" | grep "v$local_manifest_version")

if [ ! -z "$remote_collision" ]; then
  echo "[-] critical: manifest collision detected for v$local_manifest_version."
  echo "[-] remote conflict identified:"
  echo "$remote_collision" | awk '{print "    -> " $2}'
  echo "[-] sequence halted: this version has already been deployed."
  exit 1
fi

echo "[+] validation successful: no remote collision for v$local_manifest_version."
exit 0