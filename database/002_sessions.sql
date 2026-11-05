CREATE TABLE IF NOT EXISTS user_sessions (
    sid VARCHAR(255) NOT NULL,
    sess JSON NOT NULL,
    expired DATETIME NOT NULL,
    PRIMARY KEY (sid),
    INDEX idx_user_sessions_expired (expired)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
