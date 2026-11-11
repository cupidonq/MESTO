#!/bin/sh
# Bezobidnyi rozygrysh dlya macOS i Linux: otkryvaet kartinku i zvuk odin raz.
cd "$(dirname "$0")" || exit 1
opener=open; command -v open >/dev/null 2>&1 || opener=xdg-open
$opener eye.jpg >/dev/null 2>&1 &
$opener hacked.mp3 >/dev/null 2>&1 &
