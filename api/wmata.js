// Proxies WMATA API calls, injecting the key server-side. Client passes the relative
// WMATA path (e.g. "Incidents.svc/json/Incidents" or
// "StationPrediction.svc/json/GetPrediction/A01") as ?path=, checked against an allowlist
// so this can't be used as an open relay for arbitrary hosts/paths.
const ALLOWED = [
  /^Incidents\.svc\/json\/Incidents$/,
  /^Incidents\.svc\/json\/BusIncidents$/,
  /^StationPrediction\.svc\/json\/GetPrediction\/[A-Za-z0-9]+$/,
  /^TrainPositions\/StandardRoutes(\?.*)?$/,
  /^TrainPositions\/TrainPositions(\?.*)?$/,
  // Temporary — investigating whether NextBusService can replace the clock-math Metrobus
  // panel. jStops is needed first, just to look up a real StopID to test predictions against.
  // Case-insensitive: WMATA's own docs and API are inconsistent about casing between services.
  /^Stops\.svc\/json\/jStops(\?.*)?$/i,
  /^NextBusService\.svc\/json\/jPredictions(\?.*)?$/i,
];

export default async function handler(req, res) {
  const path = req.query.path || '';
  if (!ALLOWED.some(re => re.test(path))) {
    return res.status(400).json({ error: 'Unknown or disallowed WMATA path' });
  }
  try {
    const response = await fetch(`https://api.wmata.com/${path}`, {
      headers: { api_key: process.env.WMATA_KEY },
    });
    if (!response.ok) throw new Error(`WMATA request failed: HTTP ${response.status}`);

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
