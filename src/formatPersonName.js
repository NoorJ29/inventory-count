// Standardizes a free-text person name for display/export — first letter of
// each word capitalized, everything else lowercase — regardless of how it
// was typed (e.g. "ROMAIN", "romain", "rOmAin" all become "Romain"). Raw
// storage is left untouched; this is applied only where names are shown.
function formatPersonName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = { formatPersonName };
