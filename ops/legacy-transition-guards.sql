-- Additional production evidence: SELECT only, no row values or connection identity.
SELECT SUBSTRING_INDEX(VERSION(), '-', 1) AS server_version,
       @@SESSION.sql_mode AS session_sql_mode;

SELECT
  COUNT(CASE WHEN `followup_count` < 0 THEN 1 END) AS `followup_count_negative`
FROM `crm_clients`;

SELECT
  COUNT(CASE WHEN `mailbox_user_id` < 0 THEN 1 END) AS `mailbox_user_id_negative`,
  COUNT(CASE WHEN `outbox_id` < 0 THEN 1 END) AS `outbox_id_negative`,
  COUNT(CASE WHEN `client_id` < 0 THEN 1 END) AS `client_id_negative`,
  COUNT(CASE WHEN `activity_id` < 0 THEN 1 END) AS `activity_id_negative`
FROM `crm_email_inbox`;

SELECT
  COUNT(CASE WHEN `created_at` IS NULL THEN 1 END) AS `created_at_null`,
  COUNT(CASE WHEN CAST(`created_at` AS CHAR) LIKE '0000-%' THEN 1 END) AS `created_at_zero_timestamp`
FROM `crm_v8_activity_events`;

SELECT
  COUNT(CASE WHEN `transfer_id` < 0 THEN 1 END) AS `transfer_id_negative`,
  COUNT(CASE WHEN `client_id` < 0 THEN 1 END) AS `client_id_negative`
FROM `crm_portfolio_transfer_items`;

SELECT
  COUNT(CASE WHEN `client_id` < 0 THEN 1 END) AS `client_id_negative`,
  COUNT(CASE WHEN `user_id` < 0 THEN 1 END) AS `user_id_negative`,
  COUNT(CASE WHEN `created_at` IS NULL THEN 1 END) AS `created_at_null`,
  COUNT(CASE WHEN CAST(`created_at` AS CHAR) LIKE '0000-%' THEN 1 END) AS `created_at_zero_timestamp`
FROM `crm_budget_change_log`;

SELECT
  COUNT(CASE WHEN `transfer_id` < 0 THEN 1 END) AS `transfer_id_negative`,
  COUNT(CASE WHEN `client_id` < 0 THEN 1 END) AS `client_id_negative`,
  COUNT(CASE WHEN `target_owner_user_id` < 0 THEN 1 END) AS `target_owner_user_id_negative`,
  COUNT(CASE WHEN `created_at` IS NULL THEN 1 END) AS `created_at_null`,
  COUNT(CASE WHEN CAST(`created_at` AS CHAR) LIKE '0000-%' THEN 1 END) AS `created_at_zero_timestamp`
FROM `crm_ionprint_sync_queue`;

SELECT
  COUNT(CASE WHEN `activity_id` < 0 THEN 1 END) AS `activity_id_negative`,
  COUNT(CASE WHEN `client_id` < 0 THEN 1 END) AS `client_id_negative`,
  COUNT(CASE WHEN `contact_id` < 0 THEN 1 END) AS `contact_id_negative`,
  COUNT(CASE WHEN `user_id` < 0 THEN 1 END) AS `user_id_negative`
FROM `crm_email_outbox`;

SELECT
  COUNT(CASE WHEN `from_user_id` < 0 THEN 1 END) AS `from_user_id_negative`,
  COUNT(CASE WHEN `to_user_id` < 0 THEN 1 END) AS `to_user_id_negative`,
  COUNT(CASE WHEN `performed_by` < 0 THEN 1 END) AS `performed_by_negative`,
  COUNT(CASE WHEN `created_at` IS NULL THEN 1 END) AS `created_at_null`,
  COUNT(CASE WHEN CAST(`created_at` AS CHAR) LIKE '0000-%' THEN 1 END) AS `created_at_zero_timestamp`
FROM `crm_portfolio_transfers`;

