# v2.0.1 버그 수정 목록

**발견 일시**: 2025-10-09
**테스트 환경**: Edge 브라우저
**심각도**: 관리 가능한 수준

## 발견된 버그

### 1. 진행률 표시 업데이트 버그
- **위치**: 자동 로더
- **증상**: "25/100 메시지" 형태의 진행률이 제대로 업데이트되지 않음
- **우선순위**: Medium
- **관련 파일**: `src/ui/auto-loader-controls.ts`, `src/features/auto-loader.ts`

### 2. 범위 입력 필드 버그
- **위치**: 내보내기 범위 선택
- **증상 1**: "시작" 입력 필드에 숫자 입력 시 범위가 업데이트되지 않음
- **증상 2**: "끝" 입력 필드에 숫자 입력 시 범위가 업데이트되지 않음
- **우선순위**: High (핵심 기능)
- **관련 파일**: `src/ui/range-controls.ts`

### 3. 최근 15메시지 복사 버그
- **위치**: 빠른 내보내기
- **증상**: "최근 15메시지" 복사 기능이 작동하지 않음
- **우선순위**: Medium
- **관련 파일**: `src/ui/panel-interactions.ts`, `src/features/share.ts`

### 4. 키보드 단축키 미작동
- **위치**: Modern UI
- **증상**:
  - 모든 단축키가 작동하지 않음
  - 대신 Edge 브라우저 기본 단축키만 실행됨
  - 예상: `Ctrl+Shift+G`, `Ctrl+Shift+E`, `Ctrl+Shift+A`
- **우선순위**: Low (보조 기능)
- **관련 파일**: `src/ui/panel-shortcuts.ts`
- **참고**: preventDefault() 호출 확인 필요

## 콘솔 로그

```
userscript.html?name=Genit-Prompt-IDE.user.js&id=7c9ffd9b-56f9-4d1a-864a-4d620740d469:375 [GPI] Userscript loaded
4bd1b696-297801fe0d6c69f3.js:1 [Intervention] Images loaded lazily and replaced with placeholders. Load events are deferred. See https://go.microsoft.com/fwlink/?linkid=2048113
```

- 다른 userscript (GPI)와 충돌 가능성 확인 필요
- Edge lazy loading 경고는 정상

## 정상 작동 확인된 기능

- ✅ 패널 표시/숨김
- ✅ 패널 드래그/리사이즈
- ✅ Modern/Legacy UI 전환
- ✅ 프라이버시 프로필 선택
- ✅ 프라이버시 게이트 표시
- ✅ JSON/Markdown/TXT 내보내기 (일부 기능 제외)
- ✅ 가이드 프롬프트 복사
- ✅ 스냅샷 다운로드

## 다음 단계

1. v2.0.1 hotfix로 High 우선순위 버그 수정
2. v2.1.0에서 나머지 버그 및 개선사항 반영

## 참고

- v2.0.0 릴리스는 성공적
- TypeScript 마이그레이션으로 인한 회귀 버그일 가능성
- strict mode로 인한 타입 관련 이슈 가능성
