-- Run while the intended database is selected. SELECT only; no application rows.
-- String defaults, ENUM/SET members and arbitrary expressions are redacted.
SELECT SUBSTRING_INDEX(VERSION(), '-', 1) AS server_version,
       DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE();

SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
  'crm_activities',
  'crm_work_queue_days',
  'crm_activity_details',
  'crm_activity_history',
  'crm_budget_change_log',
  'crm_budgets',
  'crm_clients',
  'crm_contacts',
  'crm_email_inbox',
  'crm_email_outbox',
  'crm_imported_history',
  'crm_ionprint_sync_queue',
  'crm_portfolio_transfer_items',
  'crm_portfolio_transfers',
  'crm_templates',
  'crm_v8_activity_events',
  'crm_v8_stop_reasons',
  'user_sessions',
  'users'
)
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       CASE WHEN DATA_TYPE IN ('enum', 'set') THEN CONCAT(DATA_TYPE, '([redacted members])')
            ELSE COLUMN_TYPE END AS safe_column_type,
       IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
       DATETIME_PRECISION, CHARACTER_SET_NAME, COLLATION_NAME,
       CASE
         WHEN COLUMN_DEFAULT IS NULL THEN
           CASE WHEN IS_NULLABLE = 'YES' THEN 'IMPLICIT_SQL_NULL' ELSE 'NO_DEFAULT' END
         WHEN UPPER(COLUMN_DEFAULT) = 'NULL' THEN 'EXPLICIT_SQL_NULL'
         WHEN DATA_TYPE IN ('tinyint','smallint','mediumint','int','bigint','decimal','float','double')
              AND REPLACE(COLUMN_DEFAULT, CHAR(39), '') REGEXP '^[+-]?[0-9]+([.][0-9]+)?$'
           THEN CONCAT('NUMBER:', REPLACE(COLUMN_DEFAULT, CHAR(39), ''))
         WHEN DATA_TYPE IN ('timestamp','datetime')
              AND LOWER(COLUMN_DEFAULT) REGEXP '^current_timestamp([(][0-9]*[)])?$'
           THEN CONCAT('TEMPORAL:', LOWER(COLUMN_DEFAULT))
         ELSE 'REDACTED_LITERAL_OR_EXPRESSION'
       END AS safe_default,
       CASE WHEN LOWER(EXTRA) IN ('', 'auto_increment', 'on update current_timestamp()',
                                  'on update current_timestamp', 'default_generated')
            THEN EXTRA ELSE '[redacted extra]' END AS safe_extra
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
  'crm_activities',
  'crm_work_queue_days',
  'crm_activity_details',
  'crm_activity_history',
  'crm_budget_change_log',
  'crm_budgets',
  'crm_clients',
  'crm_contacts',
  'crm_email_inbox',
  'crm_email_outbox',
  'crm_imported_history',
  'crm_ionprint_sync_queue',
  'crm_portfolio_transfer_items',
  'crm_portfolio_transfers',
  'crm_templates',
  'crm_v8_activity_events',
  'crm_v8_stop_reasons',
  'user_sessions',
  'users'
)
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
  'crm_activities',
  'crm_work_queue_days',
  'crm_activity_details',
  'crm_activity_history',
  'crm_budget_change_log',
  'crm_budgets',
  'crm_clients',
  'crm_contacts',
  'crm_email_inbox',
  'crm_email_outbox',
  'crm_imported_history',
  'crm_ionprint_sync_queue',
  'crm_portfolio_transfer_items',
  'crm_portfolio_transfers',
  'crm_templates',
  'crm_v8_activity_events',
  'crm_v8_stop_reasons',
  'user_sessions',
  'users'
)
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
  'crm_activities',
  'crm_work_queue_days',
  'crm_activity_details',
  'crm_activity_history',
  'crm_budget_change_log',
  'crm_budgets',
  'crm_clients',
  'crm_contacts',
  'crm_email_inbox',
  'crm_email_outbox',
  'crm_imported_history',
  'crm_ionprint_sync_queue',
  'crm_portfolio_transfer_items',
  'crm_portfolio_transfers',
  'crm_templates',
  'crm_v8_activity_events',
  'crm_v8_stop_reasons',
  'user_sessions',
  'users'
)
ORDER BY TABLE_NAME, CONSTRAINT_TYPE;

SELECT COUNT(*) AS migration_tracking_tables_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('knex_migrations','knex_migrations_lock');
