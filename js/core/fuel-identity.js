/* Stable fuel-transaction identities shared by manual imports and future APIs. */
window.AD = window.AD || {};

AD.fuelIdentity = (function () {
  const text = (value) => String(value == null ? '' : value).trim();

  function receiptKey(value) {
    const key = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key) return '';
    return /^\d+$/.test(key) ? (key.replace(/^0+(?=\d)/, '') || '0') : key;
  }

  function cardKey(value) {
    const digits = text(value).replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : digits;
  }

  function dateKey(value) {
    const valueText = text(value);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valueText);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const au = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(valueText);
    if (!au) return '';
    const year = au[3].length === 2 ? `20${au[3]}` : au[3];
    return `${year}-${au[2].padStart(2, '0')}-${au[1].padStart(2, '0')}`;
  }

  // The BP report and API can describe products differently. Identity is at
  // receipt level, so product wording, litres and corrected totals do not
  // affect the ID when BP later supplies the authoritative API record.
  function bpReferenceKey(row) {
    const card = cardKey(row && (row.cardNumber || row.card));
    const date = dateKey(row && row.date);
    const receipt = receiptKey(row && (row.docket || row.receipt || row.receiptNumber));
    return card && date && receipt ? `bp|${card}|${date}|${receipt}` : '';
  }

  function hash32(value, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function bpId(row) {
    const key = bpReferenceKey(row);
    if (!key) return '';
    // Two independent hashes make accidental collisions materially less likely
    // than the legacy 32-bit spreadsheet ID while keeping the key compact.
    return `fuel-bp-v1-${hash32(key, 0x811c9dc5)}${hash32(key, 0x9e3779b9)}`;
  }

  return { receiptKey, cardKey, dateKey, bpReferenceKey, bpId };
})();
