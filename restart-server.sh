#!/bin/bash
# restart-server.sh
# Script to restart the Next.js dev server

echo "🔄 Restarting Diet Fantasy dev server..."

# Find and kill the process on port 3000
PID=$(lsof -ti:3000)

if [ -z "$PID" ]; then
    echo "ℹ️  No server running on port 3000"
else
    echo "🛑 Stopping server (PID: $PID)..."
    kill $PID
    sleep 2
    
    # Force kill if still running
    if lsof -ti:3000 > /dev/null 2>&1; then
        echo "⚠️  Force killing server..."
        kill -9 $PID
        sleep 1
    fi
    
    echo "✅ Server stopped"
fi

echo ""
echo "🚀 Starting server..."
echo "📝 Watch the console for debug logs when you run route generation"
echo ""

npm run dev
