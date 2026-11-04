# Deploy the GPS verification update

Apply these to the existing Astrea Drive Supabase project, in this order:

1. In **SQL Editor**, create a new query, paste the full contents of
   `supabase/create-odometer-sync-fn.sql`, and run it. This replaces the existing
   sync function; it does not change fleet readings until the next sync.
2. In **Edge Functions → netstar → Code**, replace `index.ts` with
   `supabase/functions/netstar/index.ts` and deploy the update. Keep the existing
   secrets and authentication settings unchanged.
3. After the updated website is published, refresh Astrea Drive, open Fleet,
   and click **Sync odometers from GPS**.

Higher GPS readings update mileage. Equal readings mark the existing mileage as
GPS verified and refresh its sync timestamp. Lower GPS readings leave mileage,
source and timestamp untouched. Missing/zero readings and unmatched registrations
are skipped. The result dialog explains each outcome and lists fleet registrations
that Netstar did not return. Netstar readings are still yesterday's odometer values.

The existing nightly schedule does not need changing. The UI also works with the
older server, but displays a message that detailed verification needs a server update.

## Regression checks

Install `@electric-sql/pglite` in a test environment, then run
`node --test tests/odometer-sync.test.cjs`. Alternatively set `PGLITE_MODULE` to the
absolute path of its `dist/index.cjs`. Tests run the actual SQL against an isolated
PostgreSQL engine and use synthetic records; they never contact the live database.
