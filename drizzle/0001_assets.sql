CREATE TABLE `assets` (
  `key` text PRIMARY KEY NOT NULL,
  `content_type` text NOT NULL,
  `data` blob NOT NULL,
  `updated_at` text NOT NULL
);
