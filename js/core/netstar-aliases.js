/* Netstar device aliases for units whose feed reports a hardware ID as rego. */
window.AD = window.AD || {};

AD.netstarAliases = (function () {
  const DEVICE_TO_FLEET = Object.freeze({
    '00D2087143': 'XP58JN', // AVT05
    '00D208715E': 'XS34KN'  // AVT06
  });

  const FLEET_TO_DEVICE = Object.freeze(Object.fromEntries(
    Object.entries(DEVICE_TO_FLEET).map(([device, rego]) => [rego, device])
  ));

  const normalise = (value) => String(value == null ? '' : value).trim().toUpperCase();

  function aliasForVehicle(vehicle) {
    const savedAlias = normalise(vehicle && vehicle.netstarRego);
    if (savedAlias) return savedAlias;
    return FLEET_TO_DEVICE[normalise(vehicle && vehicle.rego)] || '';
  }

  function fleetRegoForDevice(value) {
    const key = normalise(value);
    return DEVICE_TO_FLEET[key] || key;
  }

  return { DEVICE_TO_FLEET, FLEET_TO_DEVICE, normalise, aliasForVehicle, fleetRegoForDevice };
})();
