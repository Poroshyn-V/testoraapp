// Rough static FX rates to USD for alert math.
// Alerts compare relative dynamics, so ±few % accuracy is fine;
// without this EUR/GBP/SEK amounts were summed as if they were USD.
const USD_RATES = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  CHF: 1.13,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.60,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0027,
  RON: 0.22,
  JPY: 0.0066,
  MXN: 0.055,
  BRL: 0.18,
  ZAR: 0.055
};

export function toUSD(amount, currency) {
  const value = parseFloat(amount) || 0;
  const rate = USD_RATES[(currency || 'USD').toUpperCase()] ?? 1;
  return value * rate;
}
