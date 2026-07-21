#!/bin/bash
# ============================================================
#  deploy.sh — AutoPrompt 자동 배포 스크립트
#  사용법:
#    ./deploy.sh           # 기본: prd
#    ./deploy.sh dev       # dev 브랜치(main) 배포
#    ./deploy.sh prd       # prd 브랜치 배포
#
#  yml 설정은 리포에 함께 커밋되어 있습니다:
#    - dev 배포: 두 yml 모두 유지 → 로더가 config.dev.yml 사용
#    - prd 배포: config.dev.yml 을 삭제하여 config.yml 만 남김
# ============================================================

set -e

# ────────────────────────────────────────────────────────────
#  [설정] 아래 값을 환경에 맞게 수정하세요
# ────────────────────────────────────────────────────────────
GIT_REPO_URL="ssh://git@<bitbucket-host>/<project>/autoprompt.git"    # ← git 주소 입력
DEV_BRANCH="main"                                                    # ← dev 배포 브랜치
PRD_BRANCH="prd"                                                     # ← prd 배포 브랜치
DEPLOY_DIR="/home/idms/autoprompt"                                   # ← 서버 배포 경로
PORT=5175
# ────────────────────────────────────────────────────────────

LOG_FILE="$DEPLOY_DIR/app.log"
PID_FILE="$DEPLOY_DIR/app.pid"
DEPLOY_LOG="$DEPLOY_DIR/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$DEPLOY_LOG"
}

# ── 0. 배포 환경/브랜치 결정 ──────────────────────────────
TARGET_ENV="${1:-prd}"

case "$TARGET_ENV" in
  dev)  GIT_BRANCH="$DEV_BRANCH" ;;
  prd)  GIT_BRANCH="$PRD_BRANCH" ;;
  *)    log "  ✗ 알 수 없는 환경: $TARGET_ENV (dev|prd 만 허용)"; exit 1 ;;
esac

log "▶ 배포 환경: $TARGET_ENV  /  브랜치: $GIT_BRANCH"

# ── 1. 서버 중지 ──────────────────────────────────────────
log "▶ 서버 중지 중..."
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
  log "  서버 종료 완료"
else
  log "  실행 중인 서버 없음 (건너뜀)"
fi

# ── 2. 소스코드 갱신 ──────────────────────────────────────
log "▶ 소스코드 갱신 중..."
if [ -d "$DEPLOY_DIR/.git" ]; then
  cd "$DEPLOY_DIR"
  git fetch origin
  git reset --hard "origin/$GIT_BRANCH"
  chmod +x "$DEPLOY_DIR/deploy.sh"
  log "  git pull 완료 ($GIT_BRANCH @ $(git rev-parse --short HEAD))"
else
  log "  저장소 없음 — 최초 clone 진행..."
  mkdir -p "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  git init
  git remote add origin "$GIT_REPO_URL"
  git fetch origin
  git reset --hard "origin/$GIT_BRANCH"
  chmod +x "$DEPLOY_DIR/deploy.sh"
  log "  clone 완료 ($GIT_BRANCH @ $(git rev-parse --short HEAD))"
fi

# ── 3. 환경별 설정 파일 정리 ──────────────────────────────
# 두 yml 은 리포에 모두 들어있다. prd 배포는 dev yml 을 제거해
# 로더가 config.yml 을 선택하도록 한다.
if [ "$TARGET_ENV" = "prd" ]; then
  if [ -f "$DEPLOY_DIR/config.dev.yml" ]; then
    rm -f "$DEPLOY_DIR/config.dev.yml"
    log "  config.dev.yml 제거 (prd 모드 강제)"
  fi
  CONFIG_FILE="$DEPLOY_DIR/config.yml"
else
  CONFIG_FILE="$DEPLOY_DIR/config.dev.yml"
fi

if [ ! -f "$CONFIG_FILE" ]; then
  log "  ⚠  설정 파일이 없습니다: $CONFIG_FILE"
  exit 1
fi
log "  설정 파일 확인: $CONFIG_FILE"

# ── 4. 패키지 설치 ────────────────────────────────────────
log "▶ 패키지 설치 중 (빌드용 devDeps 포함)..."
cd "$DEPLOY_DIR"
npm install --silent
log "  패키지 설치 완료"

# ── 5. 빌드 ───────────────────────────────────────────────
log "▶ Next.js 빌드 중..."
npm run build
log "  빌드 완료"

# ── 5-1. devDependencies 정리 ─────────────────────────────
log "▶ devDependencies 정리 중..."
npm prune --omit=dev --silent
log "  정리 완료"

# ── 6. 서버 기동 ──────────────────────────────────────────
log "▶ 서버 시작 중..."
nohup node_modules/.bin/next start -p $PORT > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
log "  서버 시작 완료 (PID: $(cat "$PID_FILE"), PORT: $PORT)"
log "  로그 확인: tail -f $LOG_FILE"
log "════════════════════════ 배포 완료 ($TARGET_ENV) ════════════════════════"
