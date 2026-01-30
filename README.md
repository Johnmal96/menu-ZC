# SVG visibility app

This app loads an SVG file, pulls visible IDs from Google Sheets, and toggles the visibility of SVG groups.

## Files
- Backend: [server.js](server.js)
- Frontend: [public/index.html](public/index.html)
- Client logic: [public/app.js](public/app.js)
- SVG assets: [public/assets/](public/assets/)
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
If your sheet uses base item numbers (`1`, `2`, `3`, ...), the app treats them as “base IDs”. Any SVG element with an ID like `1.1`, `1.2`, etc is considered visible when base ID `1` is visible (same for `2.*`, `3.*`, ...). This is applied both in the browser preview and during PNG export.

This approach avoids parsing huge SVG files on the `/api/visibility` endpoint (which can crash on low-memory hosts).

## Save image
Click **Save Image** to send the current visible IDs to the backend. The server loads the SVG from the known URL, applies visibility server-side, renders it to PNG using resvg, and stores it in `SAVED_SVG_FOLDER` (default: `./saved-svg`) via `/api/save-svg`.

## Save PNG to Google Drive (no user sign-in)
The UI includes **Save to Google Drive**, which renders the PNG server-side and uploads it into a Drive folder using a **service account**.

### Setup
1) Create a Google Cloud **service account** and generate a JSON key.
2) In Google Drive, share your target folder with the service account email (Editor permission).
3) Set Render environment variables:

- `GOOGLE_DRIVE_FOLDER_ID` (from the folder URL)
- `GOOGLE_DRIVE_CLIENT_EMAIL` (service account email)
- `GOOGLE_DRIVE_PRIVATE_KEY` (service account private key)
- Optional: `GOOGLE_DRIVE_MAKE_PUBLIC=1` (default) to set "Anyone with the link" reader permissions on uploaded PNGs

Private key note: if your platform stores newlines as `\n`, keep it that way; the server converts `\n` to real newlines automatically.

### Endpoint
- `POST /api/save-drive` with JSON body `{ svgUrl, renderSvgUrl?, visibleIds[] }` returns `{ fileId, webViewLink, webContentLink }`.

## Deploy to Render (Git LFS)
If your SVGs are tracked with Git LFS, Render needs `git-lfs` installed to pull the real SVG files (otherwise it will only have small pointer files).

Recommended **Build Command**:

`apt-get update; apt-get install -y git-lfs; git lfs install --local; git lfs pull; npm install`

Then redeploy and verify:
- `https://<your-app>.onrender.com/api/health` returns JSON
- `https://<your-app>.onrender.com/assets/menu1.svg` is the real SVG (not a text pointer starting with `version https://git-lfs.github.com/spec/v1`)
