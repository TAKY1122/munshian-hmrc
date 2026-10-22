# munshian-hmrc

The HMRC Making Tax Digital (MTD) VAT code shared by **munshian-vat** and **munshian-ledger**. Anything about talking to HMRC lives here, so a change is made once and both apps get it.

What's in it:

- **`createClient(settings)`**: HMRC sign-in (OAuth), VAT obligations, submit a return, liabilities, payments, Check a UK VAT number, agent invitations and sandbox test users.
- **Fraud prevention headers** for the `WEB_APP_VIA_SERVER` connection method: `buildFraudHeaders`, `readDevice`, `clientPort`, and `browser/device-info.js` (the browser half).
- **The 9 VAT boxes**: HMRC's field names and wording (`BOXES`), `validateBoxes` (HMRC's rules), `toHmrcBody`.
- **`writeReceiptPdf`**: a PDF copy of a filed return with HMRC's receipt.

HMRC keys (client ID, secret, redirect address) are **not** kept here. Each app keeps its own in its `.env`.

## Using it in an app

In the app's `package.json`:

```json
"munshian-hmrc": "https://codeload.github.com/TAKY1122/munshian-hmrc/tar.gz/<commit>"
```

```js
const hmrc = require('munshian-hmrc');
const client = hmrc.createClient({ ...hmrc.HOSTS.sandbox, clientId, clientSecret, redirectUri, scopes: ['read:vat', 'write:vat'] });
```

## Making a change

1. Change the code here, run `npm test`, raise the version in `package.json` (1.0.0 → 1.0.1 for a fix, 1.1.0 for something new) and merge to `main`.
2. In each app, put the new commit's ID at the end of the `munshian-hmrc` address in `package.json`, run `npm install`, test, and deploy.

Each app is pinned to an exact commit, so a change here never alters a live app by surprise: the app moves only at step 2.
