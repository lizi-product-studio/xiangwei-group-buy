-- Keep UUIDs as internal user keys and assign stable public numbers to
-- consumers only. Extract array ordinals and scalar IDs with JSON_TABLE, then
-- fetch each JSON object directly from the locked snapshot. MySQL JSON_TABLE
-- scalar PATH columns default to NULL ON ERROR for object/array values.
SELECT payload INTO @consumer_public_number_snapshot
FROM community_product_state
WHERE id = 1
FOR UPDATE;

SET @consumer_public_number_sequence_key = '__codex_system__:consumer-public-number-sequence-v1';

CREATE TEMPORARY TABLE consumer_public_number_assignments (
  user_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL PRIMARY KEY,
  public_number BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

SELECT COALESCE(MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(users.user_json, '$.consumerNumber')) AS UNSIGNED)), 0)
INTO @consumer_public_number_max
FROM (
  SELECT user_rows.user_id,
         JSON_EXTRACT(
           @consumer_public_number_snapshot,
           CONCAT('$.users[', user_rows.user_ordinal - 1, '][1]')
         ) AS user_json
  FROM JSON_TABLE(
    @consumer_public_number_snapshot,
    '$.users[*]' COLUMNS (
      user_ordinal FOR ORDINALITY,
      user_id VARCHAR(128) PATH '$[0]'
    )
  ) AS user_rows
) AS users
WHERE JSON_TYPE(JSON_EXTRACT(users.user_json, '$.wechatOpenId')) = 'STRING'
  AND JSON_UNQUOTE(JSON_EXTRACT(users.user_json, '$.wechatOpenId')) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM JSON_TABLE(
      @consumer_public_number_snapshot,
      '$.staff[*]' COLUMNS (staff_user_id VARCHAR(128) PATH '$[0]')
    ) AS staff
    WHERE staff.staff_user_id COLLATE utf8mb4_0900_as_cs = users.user_id COLLATE utf8mb4_0900_as_cs
  );

SELECT GREATEST(
  @consumer_public_number_max + 1,
  COALESCE(MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(entries.entry_json, '$.orderId')) AS UNSIGNED)), 1)
)
INTO @consumer_public_number_next
FROM (
  SELECT JSON_UNQUOTE(JSON_EXTRACT(
           @consumer_public_number_snapshot,
           CONCAT('$.idempotency[', entry_rows.entry_ordinal - 1, '][0]')
         )) AS entry_key,
         JSON_EXTRACT(
           @consumer_public_number_snapshot,
           CONCAT('$.idempotency[', entry_rows.entry_ordinal - 1, '][1]')
         ) AS entry_json
  FROM JSON_TABLE(
    @consumer_public_number_snapshot,
    '$.idempotency[*]' COLUMNS (
      entry_ordinal FOR ORDINALITY
    )
  ) AS entry_rows
) AS entries
WHERE entries.entry_key COLLATE utf8mb4_0900_as_cs = @consumer_public_number_sequence_key COLLATE utf8mb4_0900_as_cs;

INSERT INTO consumer_public_number_assignments (user_id, public_number)
SELECT user_id,
       @consumer_public_number_next - 1 + ROW_NUMBER() OVER (ORDER BY created_at, user_id COLLATE utf8mb4_0900_as_cs)
FROM (
  SELECT consumers.user_id,
         JSON_UNQUOTE(JSON_EXTRACT(consumers.user_json, '$.createdAt')) AS created_at
  FROM (
    SELECT user_rows.user_id,
           JSON_EXTRACT(
             @consumer_public_number_snapshot,
             CONCAT('$.users[', user_rows.user_ordinal - 1, '][1]')
           ) AS user_json
    FROM JSON_TABLE(
      @consumer_public_number_snapshot,
      '$.users[*]' COLUMNS (
        user_ordinal FOR ORDINALITY,
        user_id VARCHAR(128) PATH '$[0]'
      )
    ) AS user_rows
  ) AS consumers
  WHERE JSON_TYPE(JSON_EXTRACT(consumers.user_json, '$.wechatOpenId')) = 'STRING'
    AND JSON_UNQUOTE(JSON_EXTRACT(consumers.user_json, '$.wechatOpenId')) <> ''
    AND JSON_TYPE(JSON_EXTRACT(consumers.user_json, '$.consumerNumber')) IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(
        @consumer_public_number_snapshot,
        '$.staff[*]' COLUMNS (staff_user_id VARCHAR(128) PATH '$[0]')
      ) AS staff
      WHERE staff.staff_user_id COLLATE utf8mb4_0900_as_cs = consumers.user_id COLLATE utf8mb4_0900_as_cs
    )
) AS missing_consumers;

SET @consumer_public_number_next = @consumer_public_number_next + ROW_COUNT();

UPDATE community_product_state AS state
SET payload = JSON_SET(
      state.payload,
      '$.users',
      COALESCE((
        SELECT JSON_ARRAYAGG(JSON_ARRAY(
          users.user_id,
          CASE
            WHEN assignments.public_number IS NULL THEN users.user_json
            ELSE JSON_SET(users.user_json, '$.consumerNumber', assignments.public_number)
          END
        ))
        FROM (
          SELECT user_rows.user_id,
                 JSON_EXTRACT(
                   @consumer_public_number_snapshot,
                   CONCAT('$.users[', user_rows.user_ordinal - 1, '][1]')
                 ) AS user_json
          FROM JSON_TABLE(
            @consumer_public_number_snapshot,
            '$.users[*]' COLUMNS (
              user_ordinal FOR ORDINALITY,
              user_id VARCHAR(128) PATH '$[0]'
            )
          ) AS user_rows
        ) AS users
        LEFT JOIN consumer_public_number_assignments AS assignments
          ON assignments.user_id COLLATE utf8mb4_0900_as_cs = users.user_id COLLATE utf8mb4_0900_as_cs
      ), JSON_ARRAY()),
      '$.idempotency',
      JSON_ARRAY_APPEND(
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_ARRAY(entries.entry_key, entries.entry_json))
          FROM (
            SELECT JSON_UNQUOTE(JSON_EXTRACT(
                     @consumer_public_number_snapshot,
                     CONCAT('$.idempotency[', entry_rows.entry_ordinal - 1, '][0]')
                   )) AS entry_key,
                   JSON_EXTRACT(
                     @consumer_public_number_snapshot,
                     CONCAT('$.idempotency[', entry_rows.entry_ordinal - 1, '][1]')
                   ) AS entry_json
            FROM JSON_TABLE(
              @consumer_public_number_snapshot,
              '$.idempotency[*]' COLUMNS (
                entry_ordinal FOR ORDINALITY
              )
            ) AS entry_rows
          ) AS entries
          WHERE entries.entry_key COLLATE utf8mb4_0900_as_cs <> @consumer_public_number_sequence_key COLLATE utf8mb4_0900_as_cs
        ), JSON_ARRAY()),
        '$',
        JSON_ARRAY(
          @consumer_public_number_sequence_key,
          JSON_OBJECT(
            'fingerprint', 'consumer-public-number-sequence-v1',
            'orderId', CAST(@consumer_public_number_next AS CHAR)
          )
        )
      )
    ),
    schema_version = 4,
    updated_at = UTC_TIMESTAMP(3)
WHERE state.id = 1 AND state.schema_version < 4;

DROP TEMPORARY TABLE consumer_public_number_assignments;
