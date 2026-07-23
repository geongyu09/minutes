# Oracle Always Free 배포 (가장 쉬운 길)

도메인·HTTPS·방화벽 설정 없이, **SSH 터널**로만 서버에 접속하는 방식입니다.
회원님이 직접 할 일은 아래 4가지뿐이고, 나머지는 `oracle-vm-setup.sh`가 처리합니다.

## 회원님이 직접 해야 하는 일 (제가 대신 못 함)

### ① Oracle 계정 + 무료 VM 만들기
1. <https://www.oracle.com/cloud/free/> 가입 (카드 본인인증 필요, 과금 안 됨).
2. 콘솔 → **Instances → Create Instance**.
3. Shape: **Ampere (VM.Standard.A1.Flex)** 선택, 이미지: **Ubuntu 24.04**.
4. SSH 키를 만들어 등록(콘솔이 안내). 다운로드한 키 파일을 노트북에 보관.
5. 생성되면 **공인 IP(Public IP)**를 적어 둡니다.

> 이 방식은 8787 포트를 인터넷에 열지 않습니다. 그래서 방화벽(Security List) 설정은 건드릴 필요가 없습니다. SSH(22번)만 쓰면 됩니다.

### ② VM에 접속
노트북 터미널에서:
```bash
ssh -i <다운받은키> ubuntu@<VM_공인IP>
```

### ③ 설치 스크립트 실행 (VM 안에서)
```bash
curl -fsSL https://raw.githubusercontent.com/geongyu09/minutes/feature/notion-oauth/deploy/oracle-vm-setup.sh | bash
```
- 처음 실행하면 `.env` 파일을 만들고 **멈춥니다.**
- 안내대로 `nano ~/minutes/apps/server/.env`로 값 5개를 채우고 저장(`Ctrl+O`, `Enter`, `Ctrl+X`).
- 스크립트를 **한 번 더** 실행하면 빌드·기동까지 끝납니다.

### ④ 노트북에서 접속 (SSH 터널)
서버를 쓸 때마다 노트북 터미널에서:
```bash
ssh -i <다운받은키> -L 8787:localhost:8787 ubuntu@<VM_공인IP>
```
이 창을 켜 둔 동안, 노트북의 `http://localhost:8787` 이 VM의 서버로 연결됩니다.
데스크톱 앱과 노션 로그인 콜백이 기존 `localhost` 설정 그대로 동작합니다.

## 최초 색인
접속(④)된 상태에서 앱으로 노션을 연결한 뒤, 최초 1회 전체 색인:
```bash
curl -X POST http://localhost:8787/index?mode=full -H "Authorization: Bearer <앱토큰>"
```
이후는 서버가 10분 주기로 자동 증분 색인합니다.

## 알아두기
- 이 경로는 **혼자/소수 사용**에 맞습니다. 여러 사람이 각자 접속하려면 SSH 터널 대신 도메인+HTTPS가 필요하고, 그 경우 무인증 엔드포인트 보호가 선행돼야 합니다(`docs/07-server-admin.md`의 보안 주의사항).
- 데이터는 도커 볼륨 `minutes-data`에 남습니다. 백업은 그 볼륨을 통째로 보관하세요.
