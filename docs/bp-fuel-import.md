# BP fuel import and API handover

Astrea Drive can temporarily read BP Plus Vehicle Analysis PDFs. The PDF
reader excludes card-fee and summary rows, then combines diesel and AdBlue
line items that share one receipt into one fuel transaction.

## Stable transaction identity

Every BP transaction uses the same deterministic identity:

`BP + card last four digits + Sydney transaction date + normalised receipt number`

For example, receipt `001395` and API receipt `1395` are the same reference.
The resulting primary key starts with `fuel-bp-v1-`.

The future BP API adapter must:

1. Convert the transaction timestamp to its Australia/Sydney calendar date.
2. Group API line items by card and receipt.
3. Call `AD.fuelIdentity.bpId()` with the card number, date and receipt.
4. Upsert through `AD.store.importFuel()`.

That upsert replaces the historical PDF row with the authoritative API data;
it must not create a second entry. Product wording, litres and corrected costs
are intentionally excluded from identity because those can differ between the
formatted report and API while the BP receipt remains the same transaction.
