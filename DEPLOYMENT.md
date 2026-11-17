# Deployment

The app is a single Next.js project in `frontend/`, deployed on Vercel. There is no separate backend.

## First deploy

1. Import the GitHub repository at https://vercel.com/new.
2. Set **Root Directory** to `frontend`.
3. Add two environment variables (Project → Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `NYT_API_KEY` | Your key from https://developer.nytimes.com, with "Article Search API" enabled |
   | `TAVILY_API_KEY` | Your key from https://tavily.com |

4. Deploy.

Both keys stay on the server. Neither is prefixed with `NEXT_PUBLIC_`, so neither reaches the browser.

## Moving from the old Railway setup

Earlier versions used a Python backend on Railway.

1. In Vercel, remove `NEXT_PUBLIC_API_URL`. Nothing reads it any more.
2. Add the two variables above.
3. Push to GitHub, or redeploy from the Vercel dashboard. Environment variable changes only take effect on a new deployment.
4. Delete the Railway service from the Railway dashboard.

## Check a deployment

1. Open the site and paste an NYT article link.
2. A yellow notice naming `NYT_API_KEY` or `TAVILY_API_KEY` means that variable is not set for the deployment.
3. `https://<your-site>/api/coverage?url=<NYT link>` returns the same data as JSON.

## Updating

Push to GitHub and Vercel redeploys.

## Notes

- The page is open to anyone with the link and is marked `noindex`. Neither key has a payment card behind it, so the worst an outsider can do is use up the quotas described in the [README](./README.md#limits-and-caching).
- The API route allows itself up to 45 seconds (`maxDuration` in `frontend/app/api/coverage/route.ts`). A normal lookup takes 3 to 10 seconds; the allowance covers both upstream services timing out.
