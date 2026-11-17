# Free Coverage Finder

Paste a New York Times link and get pointed to free coverage of the same story.

1. It looks the link up in NYT's official Article Search API and shows the headline, summary, byline and date, credited and linked to NYT.
2. It searches a fixed list of free-to-read outlets for the same story, published around the same days, and lists direct links.
3. It always adds a "search this outlet" link for every outlet, so the page is useful even when no match turns up.

The page shows headlines and links only. It never requests nytimes.com and never copies article text from any outlet.

The project was first called `nyt-grabber`, and a few names still say so. Earlier versions fetched NYT pages and extracted the article text; that approach was dropped.

## How it works

```
phone or computer browser
      |  paste a link, or open /?url=<link>
      v
Next.js on Vercel (frontend/)
  app/page.tsx                 the page
  app/api/coverage/route.ts    server only, holds the keys
      |--> api.nytimes.com     Article Search: find the story by its URL
      '--> api.tavily.com      search the free-outlet list around the publish date
```

For one link:

1. The link is checked and cleaned: it must be an `nytimes.com` article link (those contain a date), and tracking parameters are dropped. The link is only ever used as text.
2. NYT's API is asked for the story by its URL. If that finds nothing, it is asked once more by the words and date in the link, and a result is accepted only if its own URL is the pasted one.
3. Tavily searches the outlet list with the headline (plus the name of the person the story is about, when the headline leaves it out), from 2 days before to 5 days after the publish date. If fewer than 3 results survive step 4, it searches once more with the words from the link and a wider window (7 days before to 30 after). At most two searches per link.
4. Results are filtered:
   - Only listed outlets are kept. Section, topic, author, video, transcript, newsletter and live-blog pages are dropped.
   - A story that appears twice (an AMP copy, or a wire story republished under the same headline) counts once.
   - The search gives every result a relevance score from 0 to 1, and pads thin result lists with unrelated pages that score near zero. A result is kept at 0.25 or above. Between 0.15 and 0.25 it is kept only if its headline shares wording with the story.
5. Each result is labelled **Same story** or **Related**. Same story needs all of:
   - published within 3 days of the NYT story;
   - a search score of 0.5 or more;
   - a headline that names the person the story is about and shares a word with the NYT headline or link, or shares three words.

   Opinion pieces, reviews and other non-news items only ever get Related. Up to 2 results per outlet and 8 in total are shown, same-story first, with AP, NPR and PBS ahead of the rest.

"The person the story is about" comes from NYT's own tags, which are ranked. Only people among a story's top three tags count. Someone tagged further down is treated as mentioned in passing, and their name is ignored when matching.

## Setup

You need two free keys:

| Variable | Where to get it |
| --- | --- |
| `NYT_API_KEY` | https://developer.nytimes.com — create an app and enable "Article Search API" |
| `TAVILY_API_KEY` | https://tavily.com |

Put them in `frontend/.env.local` (see [frontend/.env.example](./frontend/.env.example)), then:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Without the keys the page still works: it says which key is missing and shows the outlet search links.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Vercel.

## Using it

- Paste a link and press **Find free coverage**. Pasting share text that contains a link ("Headline https://…") works too.
- **Paste** reads the clipboard and searches in one tap, in browsers that allow it.
- `/?url=<link>` opens straight to the result, so results can be bookmarked or shared.
- A gift link (`?unlocked_article_code=…`) gets a note saying it already opens the full article on nytimes.com.

## Outlets

The list lives in [frontend/lib/outlets.ts](./frontend/lib/outlets.ts). Each entry has an access level:

| Access | Outlets | Shown |
| --- | --- | --- |
| Free | AP News, NPR, PBS News, The Guardian, Al Jazeera, CBS News, ABC News, Politico | Yes |
| Mostly free: everyday news is free, a paid tier holds some stories | NBC News, The Hill | Yes, with the note "Some stories need a subscription" |
| Limited: metered or dynamic paywall | Reuters, CNN, BBC | No, unless `INCLUDE_LIMITED_OUTLETS` in that file is set to `true` |

Access and search links were last checked in November 2026. Outlets change their paywalls; update the list when one does.

The outlet search links go to the outlet's own search where that was confirmed to work (AP, PBS, Al Jazeera, CBS, ABC, NBC). The others (NPR, The Guardian, Politico, The Hill) use a Google search limited to the outlet's site.

## Limits and caching

- NYT API: 5 requests a minute and 500 a day. A lookup uses 1 request, or 2 when the first finds nothing.
- Tavily free tier: 1,000 credits a month. A search costs 1 credit, so a link costs 1 or 2.
- Coverage search results are cached on the server for an hour, so reopening a link does not spend credits. After the hour, the old result is served once more while a fresh one is fetched. Failed and empty searches are not cached.
- NYT story details are not cached; NYT's API terms restrict providing cached content to others, and this page is open to anyone with the link.
- Every upstream call has a timeout (5 seconds for NYT, 12 for Tavily). A lookup normally takes 3 to 10 seconds; the search is the slow part.

## When something is missing

| Situation | What the page shows |
| --- | --- |
| Not an NYT article link | An error saying what to paste |
| NYT's API has no record, is rate-limited, or has no key | A notice, and coverage searched with the words and date in the link |
| The coverage search fails, is out of quota, or has no key | A notice, the story card and the outlet search links |
| No matches found | "No direct matches found" and the outlet search links |

## Tests

```bash
cd frontend
npm test          # unit tests (Vitest); no network, invented fixtures
npm run lint
npx tsc --noEmit
npm run build
```

## What to expect

The matching was tuned on seven real stories on 16 November 2026. The thresholds in [frontend/lib/rank.ts](./frontend/lib/rank.ts) come from that small sample, so expect to adjust them.

| Kind of story | What came back |
| --- | --- |
| A widely covered event (a House leader stepping down, two weeks old) | AP, NPR, CBS and NBC as Same story, plus two Related pieces |
| An event from six months earlier | Al Jazeera and The Guardian as Same story |
| A profile | Nothing the same, as expected; three Related pieces about the same person |
| An opinion piece | Related news coverage of the same topic |
| A story published two hours earlier | Nothing. No other outlet had covered it yet |

Known limits:

- **Fresh stories.** Until other outlets publish, there is nothing to find. Try again later, or use the outlet search links.
- **The search varies.** The same query can return different results minutes apart, so a repeat lookup after the cache expires may differ.
- **Labels are approximate.** Outlets word the same event differently, so a true match can be labelled Related, and a look-alike can occasionally be labelled Same story.
- **Skipped on purpose.** Politico's live-update posts and newsletters, and video pages on any outlet, are not listed even when they cover the story.

Confirmed against the live APIs: the Article Search filter `fq=url:"…"` finds an article by its link; the summary arrives as `abstract`; no article body text is returned; and Tavily honours the outlet list, `topic: news` and the date range together.

## NYT API terms

The NYT APIs are for non-commercial use, and may not be used in a product that competes with NYT's own. The page credits NYT with its API logo linked to https://developer.nytimes.com wherever NYT data appears, links every story to nytimes.com, and is marked `noindex`. Keep it a personal tool. Terms: https://developer.nytimes.com/terms

## License

MIT
