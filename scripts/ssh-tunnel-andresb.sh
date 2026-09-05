#!/bin/bash
# SSH tunnel script for andresb with autossh
# Forwards: 8000, 8888, 7999, 54322

HOST="andresb"

echo "Starting SSH tunnel to $HOST with autossh..."
echo "Forwarded ports: 8000, 8888, 7999, 54322"

# Kill any existing autossh for this host
pkill -f "autossh.*$HOST" 2>/dev/null
sleep 1

# Start autossh in background
autossh -M 0 \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -o "ExitOnForwardFailure yes" \
  -f \
  -L 8000:localhost:8000 \
  -L 8888:localhost:8888 \
  -L 7999:localhost:7999 \
  -L 54322:localhost:54322 \
  -N "$HOST"

# Wait a moment for connection
sleep 3

# Check if autossh is running
if pgrep -f "autossh.*$HOST" > /dev/null; then
    echo "✓ Tunnel started successfully (PID: $(pgrep -f 'autossh.*$HOST'))"

    # Check port status
    PORT_8000=$(lsof -i :8000 2>/dev/null | grep LISTEN | wc -l)
    PORT_8888=$(lsof -i :8888 2>/dev/null | grep LISTEN | wc -l)
    PORT_7999=$(lsof -i :7999 2>/dev/null | grep LISTEN | wc -l)
    PORT_54322=$(lsof -i :54322 2>/dev/null | grep LISTEN | wc -l)

    echo "Port status: 8000:$PORT_8000 8888:$PORT_8888 7999:$PORT_7999 54322:$PORT_54322"
    echo "Tunnel is running in background. Use './ssh-tunnel-andresb-stop.sh' to stop."
else
    echo "✗ Failed to start tunnel"
    exit 1
fi
