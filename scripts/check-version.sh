#!/bin/bash

# initialize autonomous manifest validation
local_manifest_version=$(node -p "require('./package.json').version")

# synchronizing with global registry tags
git fetch --tags --quiet
global_registry_version=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/v//')

# version collision detection logic
if [ "$local_manifest_version" == "$global_registry_version" ]; then
  echo "[-] critical: manifest collision detected at v$local_manifest_version."
  echo "[-] sequence halted: local version matches existing production tag."
  echo "[-] action required: execute 'npm run release:[patch|minor|major]' to increment state."
  exit 1
fi

echo "[+] validation successful: version delta identified ($global_registry_version -> $local_manifest_version)."
echo "[+] initiating upstream synchronization to production pipeline..."
exit 0