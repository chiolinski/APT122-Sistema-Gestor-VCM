function scopeSectionRows(rows = [], teachingSectionIds = [], restrictToTeachingSections = false) {
  if (!restrictToTeachingSections) return rows;
  const allowed = new Set(teachingSectionIds.map((id) => String(id).toLowerCase()));
  return rows.filter((row) => allowed.has(String(row.sectionId).toLowerCase()));
}

module.exports = { scopeSectionRows };
