# General Memory Helper (GMH)
## Chat Export & Conversation Backup Tool

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-2-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->
![Project Status](https://img.shields.io/badge/status-active-brightgreen?style=flat-square)
![Version](https://img.shields.io/badge/version-v2.3.2-blue?style=flat-square)

> **🚀 프로젝트 상태: 멀티플랫폼 확장 진행 중**
> v2.2.0부터 babechat.ai 지원이 추가되었습니다. 향후 더 많은 AI 챗봇 플랫폼을 지원할 예정입니다.

> **⚠️ v2.2.0 이름 변경 안내**
> "Genit Memory Helper" → "General Memory Helper"로 이름이 변경되었습니다.
> Tampermonkey에서 새 스크립트로 인식될 수 있으니, **기존 스크립트를 삭제 후 새로 설치**해 주세요.
> GMH 약어와 기존 설정(localStorage)은 그대로 유지됩니다.

AI 챗봇 대화 로그를 **구조 보존 JSON/Markdown**으로 추출하고 백업하는 Tampermonkey 사용자 스크립트입니다. 개인정보 레다크션과 메시지 범위 선택 기능을 제공합니다.

### 🌐 지원 플랫폼

| 플랫폼 | 상태 | 비고 |
|--------|------|------|
| [genit.ai](https://genit.ai) | ✅ 완전 지원 | 메인 타겟 |
| [babechat.ai](https://babechat.ai) | ✅ 지원 (v2.2.0+) | 신규 추가 |

## 📥 설치 방법

이 스크립트는 [Tampermonkey](https://www.tampermonkey.net/) 확장 프로그램을 통해 사용할 수 있습니다.

1. 먼저 Tampermonkey를 설치하세요. (Chrome/Edge/Firefox 지원)
![설치 화면](assets/images/1.png)
2. 아래 버튼을 클릭해 스크립트를 설치하세요:

👉 [**최신 버전 다운로드**](https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js)
3. 브라우저가 `.user.js` 파일을 다운로드하면, Tampermonkey가 자동으로 설치 화면을 띄워줍니다.  
   "Install" 버튼을 눌러주면 완료됩니다 ✅
![설치 성공](assets/images/2.png)
![설치 성공](assets/images/3.png)
---

### 🔄 업데이트

- 새 버전이 나오면 위의 Raw 페이지에 올라갑니다.
- 기존 유저는 Tampermonkey가 자동으로 업데이트를 체크합니다.
- 문제가 생기면 아래 "긴급 킬스위치"를 참고해 GMH를 임시로 비활성화할 수 있습니다.
- **변경 사항 전체는** [`CHANGELOG.md`](./CHANGELOG.md)에서 버전별로 확인하세요.

## 사용법

- **메시지 수집**: 버튼 한 번으로 대화 전체를 자동으로 수집합니다. babechat.ai는 API를 통해, genit.ai는 스크롤을 통해 메시지를 불러옵니다.
- **Rich 구조 보존 Export (기본, Markdown 권장)**: Markdown/JSON/TXT 포맷으로 메시지·파트 구조(코드/인용/이미지 포함)를 그대로 내보냅니다.
- **메시지 범위 내보내기**: Export 섹션의 `메시지 범위` 입력에 시작/끝 **메시지 번호**(가장 최근이 1, 그 이전이 2 … 순서)를 적어 원하는 구간만 파일로 저장할 수 있습니다. `시작지정`/`끝지정` 버튼을 누르면 최근 클릭한 메시지가 북마크 큐(최대 5개)에 저장되고, 드롭다운에서 과거 책갈피를 다시 선택할 수 있습니다.

### 🎛️ 패널 제어 & 단축키

- 좌측 상단 그립(⋮⋮)을 드래그하면 패널을 좌·우 하단으로 도킹할 수 있으며 위치는 브라우저별로 기억됩니다.
- 우측 하단 손잡이로 패널 크기를 조절할 수 있습니다. 모바일에서는 자동으로 92vw/76vh 범위 안에 맞춰집니다.
- 단축키: `Alt+M` (패널 토글), `Alt+G` (패널 포커스), `Esc` (닫기), `Alt+P` (민감어 설정).
- ⚙ 버튼 → **GMH 설정**에서 자동 접힘 시간, 집중 모드, 드래그/리사이즈 허용 여부를 즉시 변경할 수 있습니다.
- 자동 접힘을 끄거나 집중 모드를 켜두면 패널이 화면을 가리지 않고 필요할 때만 등장합니다.

### 권장 UX 플로우

1. 대화 진행 → 적당히 길어지면
2. **메시지 수집** 버튼으로 전체 대화 로드
3. **파일 내보내기**에서 Rich Markdown 내보내기
4. ChatGPT/Gemini 등에 파일 업로드 후 요약 요청
5. 결과를 플랫폼 **유저노트(≤2000자)** 에 붙여넣기

## 요약 범위 선택 (중요 UX)

General Memory Helper는 **현재 화면에 로드된 대화만** JSON으로 내보냅니다.  
따라서 사용자가 원하는 구간까지 로그를 불러와야 그 부분이 요약에 포함됩니다.

- Export 패널의 `메시지 범위` 입력을 사용하면 현재 확보된 메시지 중 원하는 시작/끝 지점을 선택해 부분만 내보낼 수 있습니다. 번호는 “가장 최근 = 1”부터 올라가므로, 오래된 메시지를 지정하려면 더 큰 숫자를 입력하면 됩니다. 선택을 비우면 전체 대화가 포함되며, `시작지정`/`끝지정` 버튼으로 미리보기에서 보고 있는 메시지를 바로 지정할 수 있습니다. 

### 메시지 수집

- 패널의 **메시지 수집** 버튼을 누르면 전체 대화를 자동으로 수집합니다.
- babechat.ai는 API를 통해 즉시 전체 메시지를 가져오고, genit.ai는 스크롤을 통해 메시지를 로드합니다.

👉 수집된 메시지 범위 내에서 원하는 구간을 선택해 내보낼 수 있습니다.

### 🔧 긴급 킬스위치

GMH에 문제가 생길 경우 아래 명령으로 즉시 비활성화할 수 있습니다.

```js
// 콘솔에서 실행 (브라우저 F12)
localStorage.setItem("gmh_kill", "1"); // GMH 전체 비활성화
localStorage.removeItem("gmh_kill"); // 킬스위치 해제 (기능 복구)
```

- 킬스위치(`gmh_kill`)가 켜져 있으면 GMH 스크립트가 완전히 비활성화됩니다.
- 문제가 해결되면 킬스위치를 해제하고 페이지를 새로고침하세요.

### 🧪 실험 기능: 메모리 인덱스 (v2.1.0+)

v2.1.0부터 대화를 5개 메시지 단위 블록으로 자동 인덱싱하여 브라우저에 저장하는 기능이 추가되었습니다. (향후 의미 검색 기능을 위한 준비 단계)

**⚠️ 이 기능은 실험적이며 기본적으로 비활성화되어 있습니다.**

#### 활성화 방법 (최초 1회만)

```js
// 콘솔에서 실행 (브라우저 F12)
GMH.Experimental.MemoryIndex.enable();
// 페이지 새로고침 필요
```

활성화 후 새로고침하면 Tampermonkey 패널 상단에 **"🧠 Memory Index"** 섹션이 나타나고, **"블록 상세 보기"** 버튼으로 저장된 블록을 확인할 수 있습니다.

```js
// 기능 비활성화 (필요시)
GMH.Experimental.MemoryIndex.disable();
// 페이지 새로고침 필요
```

**참고**:
- 블록은 브라우저별로 저장되며 기기 간 동기화되지 않습니다.
- 시크릿 모드나 브라우저 초기화 시 데이터가 삭제될 수 있습니다.
- 기능을 활성화하면 새 대화부터 자동으로 블록이 생성됩니다. 기존 대화는 새 메시지가 추가될 때부터 인덱싱됩니다.

### 🧪 실험 기능: HTML 백업

대화를 standalone HTML 파일로 내보내는 기능입니다. 오프라인에서도 열람 가능한 백업을 생성합니다.

**⚠️ 현재 한계**:
- **이미지 미포함**: 현재 버전에서는 이미지가 포함되지 않습니다.

**사용 방법**:
1. Export 섹션에서 `🧪 HTML 백업 (이미지 미포함)` 버튼 클릭
2. 완료되면 `.html` 파일이 자동 다운로드됩니다

## 개발 & 테스트

- `npm install`
- `USE_ROLLUP=1 npm run build` (TypeScript 번들링, v2.0.0부터 필수)
- `npm test` (Vitest 기반 단위 테스트 – 자동으로 빌드 후 dist 산출물을 검사합니다)
- `npm run test:smoke`
  - `GENIT_TEST_URL` + `GENIT_USER`/`GENIT_PASS`를 설정하면 테스트 계정으로 로그인해 실제 세션 페이지에서 패널과 자동 스크롤을 검증합니다.
  - 공개 데모 URL이 있다면 `GENIT_DEMO_URL`을 지정해 로그인 없이 패널 렌더만 확인할 수 있습니다.
- 로그인 페이지가 기본 셀렉터와 다르다면 아래 환경변수로 조정하세요.
  - `GENIT_LOGIN_URL`, `GENIT_LOGIN_EMAIL_SELECTOR`, `GENIT_LOGIN_PASSWORD_SELECTOR`, `GENIT_LOGIN_SUBMIT_SELECTOR`, `GENIT_LOGIN_SUCCESS_SELECTOR`
- 루트 디렉터리의 `.env.example`을 복사해 `.env`를 만들면 위 환경변수를 빠르게 채울 수 있습니다.
- 버전 릴리스: `npm run bump:patch` / `npm run bump:minor` / `npm run bump:major` → 버전 상승, 메타데이터 동기화, dist 빌드, 태그 푸시가 자동으로 처리됩니다. (로컬 변경이 있다면 먼저 커밋/스태시하세요.)

### 릴리스 스크립트 메모

1. 모든 변경을 커밋하거나 정리한 뒤 `npm test`로 기본 단위 테스트를 확인합니다.
2. 릴리스할 버전에 맞춰 `npm run bump:patch` (또는 `bump:minor`/`bump:major`)를 실행하면 버전이 올라가고 원격으로 태그까지 푸시됩니다.
3. GitHub Actions 릴리스 워크플로가 태그를 감지해 dist 산출물을 업로드하니 추가 수동 작업은 필요 없습니다.

### GitHub Actions 비밀 설정

CI에서 스모크 테스트와 자동 릴리스를 활용하려면 프로젝트의 **Settings → Secrets → Actions**에 다음 키를 추가하세요.

| Secret                      | 설명                                                      |
| --------------------------- | --------------------------------------------------------- |
| `GENIT_TEST_URL`            | 로그인 후 접근 가능한 테스트용 대화 세션 URL              |
| `GENIT_DEMO_URL` (옵션)     | 로그인 불필요한 공개 데모 URL                             |
| `GENIT_USER` / `GENIT_PASS` | 테스트 계정 자격 증명                                     |
| 그 외 (옵션)                | 로그인 커스터마이징을 위한 `GENIT_LOGIN_*` 시리즈         |
| `GENIT_HOME_URL` (옵션)     | 자산 해시 핑거프린트 대상 홈 URL(기본: https://genit.ai/) |

GitHub Actions 워크플로는 비밀이 없는 경우 해당 단계(로그인/스모크)를 자동으로 건너뜁니다.

## 🔒 프라이버시 가드

- 패널 상단에서 **SAFE/STANDARD/RESEARCH** 프로필을 선택할 수 있습니다.
  - **SAFE**: 이메일·전화·주민번호·카드·IP에 더해 주소 힌트까지 가리고, 폭력/자해 등 민감 단어도 완곡화합니다.
  - **STANDARD**: 핵심 PII(이메일·전화·주민번호·카드·IP·@handle)만 가립니다. 주소나 서술은 그대로 둬야 할 때 선택하세요.
  - **RESEARCH**: 고정으로 가리는 PII만 유지하고 나머지는 최대한 원문을 살립니다. 연구/후처리 목적용이라 공유 전에 반드시 재검토가 필요합니다.
- 복사/내보내기 전에 항상 **레다크션 요약 + 공유 책임 확인창**이 뜹니다. 취소하면 작업이 중단됩니다.
- 민감한 블랙리스트/화이트리스트를 직접 등록해 특정 키워드를 항상 가리거나(블랙) 보호(화이트)할 수 있습니다.
- 미성년자 성적 맥락이 감지되면 내보내기/복사가 차단됩니다.
- 파일을 저장하면 동시에 `*.manifest.json`이 내려와 "어떤 프로필로, 무엇을 얼마나 가렸는지"를 남겨 재현성을 확보합니다.

> ⚠️ 자동 레다크션이 있더라도 업로드 전에 반드시 내용을 검토하세요.  
> 레다크션 요약(EMAIL:2, PHONE:1 등)을 보고 민감 정보가 남아 있지 않은지 확인한 뒤 외부 LLM에 공유하는 것을 권장합니다.

## FAQ

- **서버로 전송되나요?** 아니요. 모든 처리는 로컬에서만 이뤄집니다.
- **성능에 영향 있나요?** DOM 파싱만 수행, 서버 요청 증가 없음.
- **고장 시?** DOM 클래스/텍스트가 바뀌면 GitHub 이슈에 보고해주세요.

### Q. 민감한 내용이 포함되면 어떻게 하나요?

A. 스크립트는 자동으로 대화 로그를 요약하지만, 민감한 부분까지 전부 안전하게 처리해 주는 건 아닙니다.  
👉 따라서 중요한 내용은 직접 입력하거나, 요약 결과를 확인하면서 스스로 수정해 주시는 게 가장 안전합니다.

### Q. JSON 용량이 너무 크면 요약이 안 되는데요?

A. 네, 모델에는 **토큰(token)**이라는 입력 한계가 있습니다.

- 5만~10만 토큰 정도까지는 대체로 괜찮지만, 50만 이상이 되면 모델이 한 번에 처리하지 못해 요약이 빈칸으로 나올 수 있습니다.
- 해결 방법:
  1. **장면(scene) 단위**로 로그를 쪼개서 요약하기
  2. **필요한 부분만 발췌**해서 요약하기
  3. 나눠서 요약한 뒤 → 최종적으로 다시 합쳐서 정리하기

👉 즉, 토큰이 너무 많으면 “나눠서 처리”하는 것이 가장 확실한 방법입니다.

## 개발자 참고 (Developer Notes)

- 소스 코드는 `src/` 아래 TypeScript 모듈로 분리되어 있으며, `src/index.ts`가 Tampermonkey 환경에 `GMH` 네임스페이스를 노출합니다.
- Privacy/Export 로직은 각각 `src/privacy/`, `src/export/`에 있으며, UI 조립 코드는 `src/ui/`에 위치합니다. 자동 로더, 공유 등 독립 기능은 `src/features/`에 배치되어 있습니다.
- 프라이버시 프로필 드롭다운·복사/내보내기에 대한 패널 이벤트 바인딩은 `src/ui/panel-interactions.ts`에서 관리합니다.
- Privacy Gate 모달은 `src/ui/privacy-gate.ts`가 생성합니다. Tampermonkey 전역 대신 `ENV`/모듈 API를 사용하세요.
- 빌드: `USE_ROLLUP=1 npm run build`로 Rollup 번들을 생성합니다. (v2.0.0부터 필수)
- `npm run typecheck`로 TypeScript 타입 검사를 실행합니다.
- Tampermonkey/GM 전역과 공유 타입은 `types/` 아래 ambient 선언으로 관리합니다.

## 🤖 AI-Assisted Development

이 프로젝트는 **AI(Claude)의 도움을 받아 개발**되었습니다.

아이디어와 방향성을 제시하고, AI와 대화하며 함께 구현해 나가는 방식으로 진행했습니다.
코드의 상당 부분은 AI가 생성했으며, 저는 설계와 검토, 의사결정을 담당했습니다.

그렇기에 코드 품질이나 구조에 대한 **개발자분들의 피드백을 환영합니다**.
- 개선점이 보이시면 Issue나 PR로 알려주세요
- "이건 이렇게 하는 게 더 좋아요" 같은 조언도 감사히 받겠습니다

AI와 협업하는 새로운 개발 방식을 실험하는 프로젝트이기도 합니다.

## 유지보수 정책

이 스크립트는 개인 프로젝트로 제작되었으며, **유지보수는 보장되지 않습니다**.  
이슈 및 PR은 환영하지만, 학업 일정 등으로 인해 응답이 늦거나 반영되지 않을 수 있습니다.  
치명적인 버그(예: 전혀 작동하지 않는 경우)에 한해서만 가볍게 대응할 수 있습니다.  
필요하다면 자유롭게 포크해서 수정·사용해 주세요.

## 라이선스

이 프로젝트는 GPL-3.0-or-later 라이선스를 따릅니다.

---

## 🏆 기여자 성장 사다리 (Our Contributor Ladder)

`gmh` 프로젝트는 여러분의 기여와 함께 성장하며, 기여자 여러분의 성장 또한 응원합니다. 저희는 기여의 종류와 깊이에 따라 다음과 같은 역할을 부여하여 여러분의 노력을 기억하고 인정합니다.

| 역할 (Role) | 달성 조건 (How to Achieve) | 책임과 권한 (Responsibilities & Privileges) |
| :--- | :--- | :--- |
| **🥇 Tier 1: 탐험가 (Explorer)** | 첫 번째 PR이 성공적으로 병합(Merge)된 분 | 프로젝트의 공식 기여자가 되신 것을 축하합니다! 이제 당신은 `gmh` 생태계의 소중한 일원입니다. |
| **🥈 Tier 2: 건축가 (Builder)** | `AI-Friendly` 라벨이 붙은 코드 관련 PR을 처음으로 성공시킨 분 | AI를 활용해 실제 기능을 만들어내는 핵심적인 빌더입니다. 더 복잡한 이슈에 도전할 자격이 주어집니다. |
| **🥉 Tier 3: 수호자 (Guardian)** | 3회 이상 의미있는 기여를 하고, 다른 사람의 질문에 친절하게 답변하는 등 커뮤니티에 긍정적인 영향을 주신 분 | 새로운 탐험가들의 질문에 답변하고, 간단한 PR을 리뷰하며 프로젝트를 함께 지켜나가는 멘토 역할을 수행합니다. |

여러분의 첫 번째 기여를 시작으로, 수호자가 되어 새로운 기여자들을 이끌어주는 멋진 리더로 성장해보세요!

## Contributors ✨

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/devforai-creator"><img src="https://avatars.githubusercontent.com/u/212040505?v=4?s=100" width="100px;" alt="SY Dev"/><br /><sub><b>SY Dev</b></sub></a><br /><a href="#ideas-devforai-creator" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/devforai-creator/genit-memory-helper/commits?author=devforai-creator" title="Code">💻</a> <a href="https://github.com/devforai-creator/genit-memory-helper/commits?author=devforai-creator" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/tpalsdhkdwk1"><img src="https://avatars.githubusercontent.com/u/236061945?v=4?s=100" width="100px;" alt="tpalsdhkdwk1"/><br /><sub><b>tpalsdhkdwk1</b></sub></a><br /><a href="https://github.com/devforai-creator/genit-memory-helper/issues?q=author%3Atpalsdhkdwk1" title="Bug reports">🐛</a> <a href="#ideas-tpalsdhkdwk1" title="Ideas, Planning, & Feedback">🤔</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!
