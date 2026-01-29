# SVG visibility app

This app loads an SVG file, pulls visible IDs from Google Sheets, and toggles the visibility of SVG groups.

## Files
- Backend: [server.js](server.js)
- Frontend: [public/index.html](public/index.html)
- Client logic: [public/app.js](public/app.js)
- Sample SVG: [public/assets/diagram.svg](public/assets/diagram.svg)
- Environment template: [.env.example](.env.example)

## Google Sheets setup
1. Create a Google Cloud project and enable the Google Sheets API.
2. Create an API key.
3. Make the Google Sheet public (anyone with the link can view).
4. In the sheet, create columns:
  - Column A: `id` (e.g., `#1`, `#2` in A3, A4, ...)
  - Column B: `visible` (TRUE / FALSE) or leave blank to default to visible

Example:

| id  | visible |
|-----|---------|
| #1  | TRUE    |
| #2  | FALSE   |
| #3  | TRUE    |

## Configure environment
- Copy `.env.example` to `.env`
- Set:
  - `GOOGLE_API_KEY`
  - `GOOGLE_SHEETS_RANGE` (e.g., `A3:B`)
  - `GOOGLE_SHEETS_SHEET_NAME` (only needed if you want to prefix the range)
  - `SAVED_SVG_FOLDER` (optional folder for saved SVGs)

## Run
- Install dependencies: `npm install`
- Start server: `npm start`
- Open http://localhost:3000

## Simple toggle mechanism
Update the `visible` column in Google Sheets to TRUE or FALSE, then click **Refresh visibility** in the UI. IDs like `#1` are normalized to `1` before matching SVG group IDs.

### Item number mapping
If your sheet uses item numbers (`1`, `2`, `3`, ...), the server expands them to match SVG IDs with that prefix. Example: item `1` maps to `1.1`, `1.2`; item `2` maps to `2.1`, `2.2`; item `3` maps to `3.1`, `3.2`, `3.3`, `3.4`, etc. The SVG ID list is inferred from the SVG file configured in `SVG_SOURCE_URL`.

## Save image
Click **Save Image** to send the current visible IDs to the backend. The server loads the SVG from the known URL, applies visibility server-side, renders it to PNG using resvg, and stores it in `SAVED_SVG_FOLDER` (default: `./saved-svg`) via `/api/save-svg`.
