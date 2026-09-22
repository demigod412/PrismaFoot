# Changelog

## 0.3.0 — combined update
- **Top 20 tips** page (`/top`): strongest single tip per match, Today → Next 7 days, ranked by probability with a small confidence boost; competition filter; 7-day track record.
- **Mobile date bar** rebuilt: instant highlight + loading spinner, selected day kept centred, ‹ › day buttons, native calendar picker; swipes no longer trigger pull-to-refresh.
- **International football**: friendlies, Nations League, World Cup & AFCON qualifiers, World Cup / Euro / AFCON / Copa América. National teams rated together across competitions (3 years of history, 365-day half-life); no home advantage at tournament finals. "International" filter in scanners and Top 20.
- **Fix**: API-Football cup competitions (Champions League, internationals) were skipped.
- **Lighter sync**: one request per season per competition (was ~26), capped injury calls — fits free plans.
- **Over 4.5 / Under 2.5 / 3.5 / 4.5** markets and scanners.
- `setup-lightsail.sh`: repo-folder installs, multi-app, dash-safe DB names, 60-minute sync timeout.

After deploying: `npx prisma db push` runs automatically in `setup-lightsail.sh update` (adds new columns).
