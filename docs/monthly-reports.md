# Monthly reports

From the dashboard, choose **Monthly report**, select a reporting month, and choose **PDF report** or **Excel workbook**.

The PDF uses the Astrea logo, navy and mint palette, vector charts and A4 portrait pages. It includes an executive summary, twelve-month cost analysis, current fleet and compliance information, monthly statistics, and up to four prioritised recommendations. Longer content flows onto additional pages. Excel retains the five-sheet workbook.

Both exports use `AD.fleetReport.gather(month)` so their cost totals agree. Reporting dates use Australia/Sydney. The current month ends at today's date; a completed month ends at its last calendar day. Future costs are excluded. Fleet statuses, open defects and compliance reflect the current records as of the issue date, not historical month-end states.

The comparison target is the average of the twelve months shown, including the selected month. Current-month comparisons against it are adjusted for elapsed calendar days. It is not an approved budget; sparse records can lower the baseline. Previous-month comparisons explicitly use the previous full month.

Recommendations are deterministic suggestions derived from the recorded data, not an AI service. No fleet data is sent to a model. PDF and Excel generation run in the browser; their libraries load on demand from jsDelivr. If loading fails, the menu displays a retry message and re-enables the choices.

Run calculation regression checks with:

```sh
node --test tests/fleet-report.test.cjs
```

For layout changes, generate both a completed-month and a month-to-date PDF, render every page, and check the cover, charts, legends, page breaks and closing recommendations. Also check an empty fleet, mobile format picker, the Excel download and retry after a failed library request.
