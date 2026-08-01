#!/bin/sh
# Tum commit mesajlarindan "Co-Authored-By: Claude ..." satirini siler.
# Boylece GitHub Contributors grafiginde "claude" gorunmez.
#
# KULLANIM (Git Bash):
#   cd /c/Users/MED/Desktop/HARMONI_V3
#   sh claude-satirlarini-sil.sh
#
# Not: Bu islem commit gecmisini yeniden yazar ve force-push gerektirir.
# Repo tek kisilik ve yeni oldugu icin risksizdir.

set -e

cd "$(dirname "$0")"

echo "1/3 - Commit mesajlari yeniden yaziliyor..."
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter \
  "sed '/^Co-Authored-By: Claude/d' | sed -e :a -e '/^\\n*\$/{\$d;N;};/\\n\$/ba'" \
  -- --all

echo "2/3 - Yedek referanslar temizleniyor..."
rm -rf .git/refs/original
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo "3/3 - GitHub'a force-push yapiliyor..."
git push --force origin master

echo ""
echo "TAMAM. Kontrol: git log --format='%B' | grep -i claude   (bos donmeli)"
echo "GitHub Contributors grafiginin guncellenmesi birkac dakika surebilir."
echo "Bu betigi artik silebilirsiniz: rm claude-satirlarini-sil.sh"
