#!/bin/bash
# Collecte LOCALE (IP résidentielle du Mac) : Bien'ici + Leboncoin → Firestore.
# Lancé par launchd toutes les 15 min. Ne tourne que 9h-19h (rien la nuit).
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "/Users/robertquentin/apparthunter" || exit 1

H=$(/bin/date +%H)
if [ "$H" -lt 9 ] || [ "$H" -ge 19 ]; then exit 0; fi

echo "=== $(/bin/date) ===" >> /tmp/apparthunter-collect.log
/usr/local/bin/npx tsx collectors/run.ts >> /tmp/apparthunter-collect.log 2>&1
