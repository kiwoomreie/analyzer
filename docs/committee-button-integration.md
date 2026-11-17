# 협의체 ‘분석기 시동’ 연동 — 대기 중 초안

> **상태: 대기(미확정).** 사용자 지시에 따라 수신 주소와 입력 규격이 확정되기 전까지 `/launch` 수신과 실제 자동 연결은 비활성(`LAUNCH_RECEIVER_ENABLED=false`)입니다. 이 문서와 `contracts/`·`examples/`는 앞서 만든 초안을 보존한 것이며, **확정된 인계물이 아닙니다.** 실제 협의체(Archive)에 버튼을 설치하지 않았고, 운영 주소도 설정하지 않았습니다.

## 1. 현재 상태 구분

| 항목 | 상태 |
|---|---|
| 새 앱(아파트 입지·가격 분석기) 독립 사용 | 구현·로컬 검증 완료 |
| `/launch` 수신 코드 | 구현됨, **기본 비활성(503 대기 안내, 본문 미저장)** |
| LauncherHarness 모의 연결 | 수신을 켠 시험 환경에서만 검증(로컬 http, 다른 호스트명 간 교차 사이트) |
| 운영 수신 주소(`ANALYZER_LAUNCH_URL`) | **미설정** |
| 실제 Archive 버튼 설치 | **미착수**(후속 Codex 담당) |
| 실제 운영 연결 검증 | **미검증** |

## 2. 확정 전에 정해야 할 사항

1. **입력 항목 축소 여부**: 현재 초안 계약 v1.0에는 채권정보(`selectedPrices.debt`)·만기·예상 처분·사업 전체 가격·시나리오 하락률이 남아 있습니다. 분석기는 이번 범위 축소로 이 값들을 **사용하지 않습니다**(받아도 무시). 확정 시 계약에서 제거하는 것을 권합니다.
2. **아파트 외 자산 수신 처리**: 분석기는 아파트만 다룹니다. 협의체 버튼을 아파트 사업장에서만 보이게 할지, 수신 측에서 거절할지 결정이 필요합니다.
3. 운영 호스팅 계정·HTTPS 주소, 새 앱 로그인 방식.

## 3. 초안 기준 구현 내용(참고)

- 경로·방식: `POST /launch`, `application/x-www-form-urlencoded`, hidden 필드 `payload` 1개(JSON 문자열), 본문 상한 64KiB.
- 흐름: 검증 → 미소비 자료 10분 보관 → `303 /launch/claim/{id}.{1회용 코드}` → 수령(전송한 브라우저 결속 쿠키 + 원자적 1회 사용) → 새 앱 작업공간에 임시 분석 생성(24시간) → 기본 분석 1회 자동 실행 → `303 /app/a/{분석ID}`(주소에 코드·가정값 없음).
- 거절: 금지 필드(인증·콜백·주소·저장위치·CF 등)나 비밀값 형태가 있으면 전체 거절, 원문은 저장·기록하지 않음.
- 역방향 통신 없음: iframe·postMessage·콜백·상태조회·결과 반환 없음. 새 앱 응답에는 `Cross-Origin-Opener-Policy: same-origin`이 적용되고, 버튼 예제에는 `rel="noopener noreferrer"`가 들어 있습니다.
- 스키마: `contracts/location-analysis-launch.schema.json`(v1.0 초안). 시험자료: `examples/launch-fixtures/`(manifest.json에 기대 결과). 허용값 선택·단위 정규화 예제: `examples/select-launch-assumptions.ts`. 버튼 예제: `examples/committee-launch-button.tsx`(‘채권정보 포함’ 체크 — 기본 미선택, 사업장 변경 시 초기화). 모의 송신 화면: `examples/launcher-harness/`.
- 예시 필드(`CommitteeAssumptionsExample`)는 설명용이며 실제 Archive 필드와 다를 수 있습니다.

### 로컬에서 대기 기능 시험하기

```bash
npm run build
LAUNCH_RECEIVER_ENABLED=true COOKIE_SECURE=true npm start          # http://localhost:5174
ANALYZER_LAUNCH_URL=http://localhost:5174/launch HARNESS_ALLOW_LOCALHOST=1 npm run harness   # http://127.0.0.1:5175
npm run test:e2e   # 두 번째 시험이 하네스 → 새 탭 → 자동 분석을 확인
```

### 검증한 것과 하지 않은 것

- 검증(로컬): 시험자료 10종 수락·거절, 303 전환, 다른 브라우저의 코드 단독 수령 차단(403), 새로고침 시 같은 분석으로 이동, 같은 launchId 중복·충돌(409), 세션별 분리, 64KiB 상한(413), `Origin: null`을 권한 근거로 쓰지 않음, 로그에 본문·코드 없음, 만료 정리, `window.opener === null`, 하네스의 원본 저장·협의체 요청 0건.
- 미검증: 운영 HTTPS·실제 도메인 간 쿠키 동작, 회사망·프록시·APM 로그의 본문 노출 여부, 기존 협의체의 CSP `form-action` 적합성, 기존 Render의 실제 공개 API·인증 상태(기존 운영 담당자 점검 사항).

## 4. 후속 Codex 작업 명령문 — 초안(규격 확정 후 갱신 필요)

```
[목표] 기존 협의체(HAHANGCO/Archive) 화면에 ‘분석기 시동’ 버튼을 추가해, 사용자가 선택한 아파트 사업장의
현재 가정 중 허용 필드만 ‘아파트 입지·가격 분석기’로 단방향 전송한다.

[먼저 확인] 분석기 저장소의 contracts/location-analysis-launch.schema.json, examples/launch-fixtures/,
examples/select-launch-assumptions.ts, examples/committee-launch-button.tsx 가 ‘확정’ 표시로 갱신되었는지 확인한다.
확정 전이면 버튼·매핑·모의 시험까지만 준비하고 운영 전송은 비활성으로 둔다.

[할 일]
1. 협의체 프런트에서 사업장·가정 선택 화면을 찾아 버튼(type="button")을 추가한다. 기존 form 안에 송신 form을 중첩하지 않는다.
2. 현재 화면의 상태에서 계약의 허용 필드만 고르는 매핑을 작성한다(select-launch-assumptions.ts의 매핑 부분만 실제 필드에 맞춤).
   전체 상태 객체를 직렬화하지 않는다. 아파트가 아닌 사업장에서는 버튼을 숨기거나 비활성화한다.
3. 목적지는 설정값 ANALYZER_LAUNCH_URL(https)만 사용한다. 미설정이면 버튼을 비활성화하고 ‘운영 주소 미설정’을 표시한다.
4. 부모 탭에는 ‘전송 시도’와 파일 내보내기 대안만 표시한다. 결과·수신 확인용 통신(iframe, postMessage, 콜백, 상태조회)을 추가하지 않는다.
5. 기존 Render를 추가 조회하거나 CF·DB·비밀키·배포 설정을 탐색·변경하지 않는다. 기존 기능과 다른 작업자의 변경을 보존한다.
6. examples/launch-fixtures 의 정상 자료와 같은 값·단위·기준일이 전송되는지, 새 탭 opener가 null인지, 분석기에서 자동 분석 1회가 되는지 확인한다.
7. 운영 배포는 승인된 일정에 따른다. 보고 시 ‘버튼 설치’, ‘운영 주소 설정’, ‘운영 연결 검증’을 구분한다.
```
