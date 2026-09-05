#!/bin/bash
# Stop the autossh tunnel to andresb

echo "Stopping SSH tunnel to andresb..."
pkill -f "autossh.*andresb"
if [ $? -eq 0 ]; then
    echo "Tunnel stopped successfully"
else
    echo "No tunnel process found"
fi
