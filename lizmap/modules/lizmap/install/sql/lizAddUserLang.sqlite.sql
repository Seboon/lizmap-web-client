-- Adds the "lang" column to jlx_user: locale of the user, used to send
-- them e-mails in their language (see ../upgrade_userlang.php).
--
-- @copyright 2026 S.Poudroux / Kheper 3D
-- @license MPL-2.0
ALTER TABLE jlx_user ADD COLUMN lang VARCHAR(10) DEFAULT '';
