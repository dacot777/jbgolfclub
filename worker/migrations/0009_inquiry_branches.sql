ALTER TABLE inquiries ADD COLUMN branch TEXT CHECK(branch IN ('hanam','cheongdam','seohyeon'));

-- A delayed retry of a create request must not restore a deleted inquiry.
CREATE TABLE deleted_inquiry_ids (
  id TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;
