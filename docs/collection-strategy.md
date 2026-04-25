# Collection Strategy

이 프로젝트는 원본 서비스를 실시간으로 반복 조회하는 방식보다,
하루 1회 집계 파일을 생성하는 방식을 전제로 합니다.

## 왜 이렇게 하나

- 수업용 서비스에 과도한 요청을 보내지 않기 위해서
- 운영자가 이상 트래픽으로 느낄 가능성을 줄이기 위해서
- 개인 식별 정보가 그대로 남지 않도록 중간 단계에서 걸러내기 위해서

## 권장 주기

- 매일 오후 6시 1분 1회
- 토론 마감 직후 한 번만 갱신

## 저장 권장 필드

- `id`
- `title`
- `status`
- `period`
- `agendaSetter`
- `architect`
- `participantsTarget`
- `participantsJoined`
- `proCount`
- `conCount`
- `avgDurationMin`
- `insightAuthors`
- `persuasiveCount`
- `bestInsightCount`
- `participants[].nickname`
- `participants[].joined`
- `participants[].side`
- `participants[].insight`

## 저장 비권장 필드

- `studentId`
- 개별 세션의 상세 로그
- 원문 인사이트 전문
- 로그인 토큰이나 인증 정보

## 운영 원칙

- 기본 화면은 익명 집계
- 닉네임은 참여 확인용 화면에서만 토글 공개
- 필요한 최소 필드만 보관
- 원본 서비스와는 분리된 집계 파일로 시각화
