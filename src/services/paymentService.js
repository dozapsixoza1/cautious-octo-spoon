const { STARS_TO_GRAM_RATE } = require('../config');

// Пакеты пополнения: сколько Stars -> сколько GRAM начислим (с бонусом на крупные пакеты)
const PACKAGES = [
  { stars: 50, gram: 50 * STARS_TO_GRAM_RATE },
  { stars: 150, gram: Math.round(150 * STARS_TO_GRAM_RATE * 1.05) }, // +5%
  { stars: 500, gram: Math.round(500 * STARS_TO_GRAM_RATE * 1.12) }, // +12%
];

function getPackage(stars) {
  return PACKAGES.find((p) => p.stars === stars);
}

module.exports = { PACKAGES, getPackage };
