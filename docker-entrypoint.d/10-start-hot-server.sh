#!/bin/sh
# Start the shared hot-state server in the background before nginx comes up.
node /app/server.js &
