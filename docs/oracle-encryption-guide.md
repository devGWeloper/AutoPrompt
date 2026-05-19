# Oracle 암호화 가이드 (명세 §6.2)

> 명세 §6.2: "프롬프트 내용은 Oracle DB에서 암호화 저장 (TDE 또는 컬럼 암호화 검토)".
> 본 문서는 운영 DBA가 적용할 수 있는 두 가지 접근을 정리한다. **코드 변경은 없다** —
> 애플리케이션은 평문으로 read/write 하고, 암복호화는 Oracle 계층에서 투명하게 처리된다.

## 보호 대상 컬럼

| 테이블 | 컬럼 | 민감도 |
|--------|------|--------|
| `PM_PROMPT_VERSION` | `SYSTEM_PROMPT`, `USER_PROMPT`, `EXTRA_PARAMS` | 높음 (지식재산) |
| `PM_TEST_CASE` | `INPUT_DATA`, `EXPECTED_OUTPUT` | 중간 (테스트 데이터) |
| `PM_TEST_RESULT` | `ACTUAL_OUTPUT` | 중간 (모델 출력) |
| `PM_RAGAS_RESULT` | `ANSWER`, `CONTEXTS`, `GROUND_TRUTH` | 중간 |
| `PM_AUDIT_LOG` | `BEFORE_VALUE`, `AFTER_VALUE` | 높음 (위 값의 스냅샷 포함) |

## 옵션 A — TDE Tablespace Encryption (권장)

전체 테이블스페이스를 암호화. 운영 단순·성능 영향 최소(블록 단위, 캐시 후 평문).

1. 키스토어(wallet) 구성 — `sqlnet.ora`:
   ```
   ENCRYPTION_WALLET_LOCATION =
     (SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/opt/oracle/admin/wallet)))
   ```
2. 키스토어 생성 및 오픈:
   ```sql
   ADMINISTER KEY MANAGEMENT CREATE KEYSTORE '/opt/oracle/admin/wallet' IDENTIFIED BY <pw>;
   ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN IDENTIFIED BY <pw>;
   ADMINISTER KEY MANAGEMENT SET KEY IDENTIFIED BY <pw> WITH BACKUP;
   ```
3. 암호화 테이블스페이스 생성 후 PM 테이블 이관:
   ```sql
   CREATE TABLESPACE pm_enc DATAFILE '...' SIZE 1G ENCRYPTION USING 'AES256'
     DEFAULT STORAGE(ENCRYPT);
   ALTER TABLE PM_PROMPT_VERSION MOVE TABLESPACE pm_enc;
   -- 인덱스 REBUILD 필요
   ```
4. **자동 오픈**: auto-login keystore 사용 시 DB 재기동 후에도 자동 오픈.
   wallet 파일은 DB 백업과 **분리 보관**.

## 옵션 B — TDE Column Encryption (선택적)

표 일부 컬럼만 암호화. 인덱싱·범위검색 제약이 있으므로 위 표의 고민감 컬럼에 한정.

```sql
ALTER TABLE PM_PROMPT_VERSION MODIFY (SYSTEM_PROMPT ENCRYPT USING 'AES256');
ALTER TABLE PM_PROMPT_VERSION MODIFY (USER_PROMPT  ENCRYPT USING 'AES256');
ALTER TABLE PM_AUDIT_LOG      MODIFY (BEFORE_VALUE ENCRYPT, AFTER_VALUE ENCRYPT);
```

제약: 암호화 컬럼은 B-tree 외 인덱스/외래키/`LONG`·일부 LOB 제약. 본 스키마의
대상 컬럼은 `CLOB/TEXT` 또는 비인덱스 컬럼이므로 영향 없음.

## 운영 체크리스트

- [ ] Wallet 비밀번호를 시크릿 매니저로 관리, DB 백업과 분리
- [ ] Auto-login keystore로 무중단 재기동 보장
- [ ] 키 로테이션 정책 수립 (`ADMINISTER KEY MANAGEMENT SET KEY ...`)
- [ ] `V$ENCRYPTED_TABLESPACES` / `DBA_ENCRYPTED_COLUMNS`로 적용 검증
- [ ] 백업(RMAN)도 암호화되는지 확인
- [ ] 전송 구간은 별도: Oracle Native Network Encryption 또는 TLS 적용

## 애플리케이션 영향

없음. `oracledb` 드라이버/SQLAlchemy 모델/마이그레이션 변경 불필요 —
TDE는 SQL 계층에 투명하다. 컬럼 암호화 적용 시 정렬·LIKE 성능만 모니터링한다.
