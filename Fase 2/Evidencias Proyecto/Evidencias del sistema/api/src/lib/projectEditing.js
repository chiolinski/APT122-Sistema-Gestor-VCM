function getProtectedRemovedSectionIds(currentSections = [], nextSectionIds = []) {
  const selected = new Set(nextSectionIds.map((id) => String(id).toLowerCase()));
  return currentSections
    .filter((section) => !selected.has(String(section.id).toLowerCase()) && Boolean(section.hasActivity))
    .map((section) => section.id);
}

module.exports = { getProtectedRemovedSectionIds };
