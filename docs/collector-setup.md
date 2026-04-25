# Collector Setup

이 수집기는 Firestore REST API를 사용해 하루 1회 집계 파일만 갱신하도록 설계되어 있습니다.

## 요청 성격

- `users` 1회
- `debates` 1회
- 각 debate별 `votes`, `comments`, `sessions`, `payloads`
- 요청 사이 기본 지연: `250ms`

즉 토론이 10개여도 대략 42회 안팎의 읽기로 끝납니다.
실시간 감시처럼 계속 붙는 구조가 아니라, 짧게 한 번 읽고 끝나는 형태입니다.

## 필요한 값

`config/collector.config.json` 안에 아래 값이 필요합니다.

- `firebase.projectId`
- `firebase.apiKey`

형식은 [collector.config.example.json](/Users/alltimesuho/Desktop/코딩/testknow/config/collector.config.example.json) 을 보면 됩니다.

## 실행

```bash
npm run collect
```

미리 결과만 보고 싶으면:

```bash
npm run collect:dry
```

## 출력

출력 파일은 기본적으로 [debates.json](/Users/alltimesuho/Desktop/코딩/testknow/data/debates.json) 입니다.

프론트 화면은 이 파일만 읽습니다.

## 보관 원칙

- `studentId` 저장 금지
- 원문 인사이트 전문 저장 금지
- 기본 화면은 익명 집계 유지
- 닉네임은 참여 확인 토글에서만 공개
