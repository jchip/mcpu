#!/bin/bash
set -e

# Start a shell that will be our "parent"
bash -c "echo Parent PID: $$; sleep 30" &
PARENT_PID=$!
echo "Started parent process: $PARENT_PID"

# Give it a moment to start
sleep 1

# Start daemon with this parent PID
echo "Starting daemon with ppid=$PARENT_PID..."
./bin/mcpu-daemon.mjs --ppid=$PARENT_PID &
DAEMON_PID=$!

# Wait for daemon to start
sleep 2

# Check if PID file was created
PID_FILE="$HOME/.local/share/mcpu/daemon.$PARENT_PID-$DAEMON_PID.json"
if [ -f "$PID_FILE" ]; then
    echo "✓ PID file created: $PID_FILE"
    cat "$PID_FILE"
else
    echo "✗ PID file not found"
    exit 1
fi

# Kill the parent process to trigger auto-shutdown
echo ""
echo "Killing parent process $PARENT_PID..."
kill $PARENT_PID 2>/dev/null || true

# Wait for daemon to detect parent death and shutdown (monitor checks every 5 seconds)
echo "Waiting for daemon to detect parent death and shutdown..."
sleep 8

# Check if PID file was removed
if [ -f "$PID_FILE" ]; then
    echo "✗ FAILED: PID file still exists after shutdown"
    echo "File contents:"
    cat "$PID_FILE"
    # Cleanup
    rm -f "$PID_FILE"
    kill $DAEMON_PID 2>/dev/null || true
    exit 1
else
    echo "✓ SUCCESS: PID file was properly removed"
fi

# Cleanup any remaining process
kill $DAEMON_PID 2>/dev/null || true
echo ""
echo "Test passed!"
