-- Convert legacy activation employees to the administrator-managed password
-- setup state without deleting employee, role or pickup-point facts.
-- The temporary table makes credential/session changes target only legacy
-- employees; newly-created ACTIVE employees are never disabled.
CREATE TEMPORARY TABLE legacy_password_setup_users (
  user_id VARCHAR(128) PRIMARY KEY
);

INSERT INTO legacy_password_setup_users (user_id)
SELECT staff_rows.user_id
FROM community_product_state AS state
JOIN JSON_TABLE(
  state.payload,
  '$.staff[*]' COLUMNS(
    user_id VARCHAR(128) PATH '$[0]',
    staff_json VARCHAR(65535) PATH '$[1]'
  )
) AS staff_rows ON TRUE
WHERE state.id = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(CAST(staff_rows.staff_json AS JSON), '$.status')) = 'PENDING_ACTIVATION';

SET @legacy_password_setup_user_ids = COALESCE(
  (SELECT JSON_ARRAYAGG(user_id) FROM legacy_password_setup_users),
  JSON_ARRAY()
);

UPDATE community_product_state
SET payload = JSON_SET(
      payload,
      '$.staff',
      COALESCE((
        SELECT JSON_ARRAYAGG(
          JSON_ARRAY(
            user_id,
            CASE
              WHEN JSON_UNQUOTE(JSON_EXTRACT(CAST(staff_json AS JSON), '$.status')) = 'PENDING_ACTIVATION'
              THEN JSON_SET(
                CAST(staff_json AS JSON),
                '$.status', 'PASSWORD_SETUP_REQUIRED'
              )
              ELSE CAST(staff_json AS JSON)
            END
          )
        )
        FROM JSON_TABLE(
          payload,
          '$.staff[*]' COLUMNS(
            user_id VARCHAR(128) PATH '$[0]',
            staff_json VARCHAR(65535) PATH '$[1]'
          )
        ) AS staff_rows
      ), JSON_ARRAY())
    ),
    schema_version = 3,
    updated_at = UTC_TIMESTAMP(3)
WHERE id = 1 AND schema_version < 3;

UPDATE community_product_state
SET payload = JSON_SET(
      JSON_SET(
        payload,
        '$.credentials',
        COALESCE((
          SELECT JSON_ARRAYAGG(
            JSON_ARRAY(
              credential_id,
              CASE
                WHEN JSON_CONTAINS(
                  @legacy_password_setup_user_ids,
                  JSON_QUOTE(JSON_UNQUOTE(JSON_EXTRACT(CAST(credential_json AS JSON), '$.userId')))
                )
                THEN JSON_SET(
                  CAST(credential_json AS JSON),
                  '$.legacyDisabled',
                  JSON_EXTRACT('true', '$')
                )
                ELSE CAST(credential_json AS JSON)
              END
            )
          )
          FROM JSON_TABLE(
            payload,
            '$.credentials[*]' COLUMNS(
              credential_id VARCHAR(128) PATH '$[0]',
              credential_json VARCHAR(65535) PATH '$[1]'
            )
          ) AS credential_rows
        ), JSON_ARRAY())
      ),
      '$.sessions',
      COALESCE((
        SELECT JSON_ARRAYAGG(CAST(session_json AS JSON))
        FROM JSON_TABLE(
          payload,
          '$.sessions[*]' COLUMNS(session_json VARCHAR(65535) PATH '$')
        ) AS session_rows
        WHERE NOT JSON_CONTAINS(
          @legacy_password_setup_user_ids,
          JSON_QUOTE(JSON_UNQUOTE(JSON_EXTRACT(CAST(session_json AS JSON), '$[1].userId')))
        )
      ), JSON_ARRAY())
    ),
    updated_at = UTC_TIMESTAMP(3)
WHERE id = 1;

DROP TEMPORARY TABLE legacy_password_setup_users;
