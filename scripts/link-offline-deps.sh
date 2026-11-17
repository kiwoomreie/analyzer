#!/bin/sh
# 네트워크가 없는 개발 환경 전용: 미리 설치된 전역 패키지 폴더를 node_modules로 연결합니다.
# 일반 환경에서는 `npm install`을 사용하십시오.
set -e
SRC="${OFFLINE_NODE_MODULES:-/opt/npm-tools/node_modules}"
[ -e node_modules ] || ln -s "$SRC" node_modules
echo "node_modules -> $SRC"
