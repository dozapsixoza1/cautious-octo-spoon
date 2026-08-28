const { getSetting } = require('./settingsService');

// Пакеты пополнения: сколько Stars -> сколько GRAM начислим (с бонусом на крупные пакеты)
// Курс берётся динамически из настроек (можно менять из админки без перезапуска).
function getPackages() {
  const rate = getSetting('stars_to_gram_rate');
  return [
    { stars: 50, gram: Math.round(50 * rate) },
    { stars: 150, gram: Math.round(150 * rate * 1.05) }, // +5%
    { stars: 500, gram: Math.round(500 * rate * 1.12) }, // +12%
  ];
}

function getPackage(stars) {
  return getPackages().find((p) => p.stars === stars);
}

module.exports = { getPackages, getPackage };
