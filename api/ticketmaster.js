// Proxies Ticketmaster Discovery API calls, injecting the key server-side. Client passes
// ?market=dc or ?market=balt to select which of the two hardcoded region queries to run
// (DC and Baltimore use different radius/size, matching what fetchTicketmaster() needs).
const MARKETS = {
  dc:   { city: 'Washington', stateCode: 'DC', radius: 12, size: 40 },
  balt: { city: 'Baltimore',  stateCode: 'MD', radius: 15, size: 20 },
};

export default async function handler(req, res) {
  const market = MARKETS[req.query.market];
  if (!market) {
    return res.status(400).json({ error: 'market must be "dc" or "balt"' });
  }
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 14 * 86400000);
    const fmt = d => d.toISOString().split('T')[0];

    const url = `https://app.ticketmaster.com/discovery/v2/events.json` +
      `?apikey=${process.env.TICKETMASTER_KEY}` +
      `&city=${market.city}&stateCode=${market.stateCode}&radius=${market.radius}&unit=miles` +
      `&size=${market.size}&sort=date,asc` +
      `&startDateTime=${fmt(now)}T00:00:00Z` +
      `&endDateTime=${fmt(end)}T23:59:59Z`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Ticketmaster request failed: HTTP ${response.status}`);

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
