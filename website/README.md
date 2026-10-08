# ACE public website

Static marketing site for `https://ace.org.ai`, adapted from the owner's supplied
ACE Website HTML. The original isometric illustrations, paper palette and local
Geist Mono / Newsreader fonts are preserved. The site uses ordinary static HTML,
CSS and a small script for scrolling and clipboard feedback; it needs no React,
runtime compiler, remote font request or application credentials.

The content describes the verified Linux 0.4.0 testing candidate from `0b913fb`,
complete-task repairs and the explicitly controlled learning comparison. It
links to the real Observatory, repository, candidate release and a public local
getting-started guide. Downloads still require repository access. Unverified
platform binaries, general model efficacy and completed production operations
are not presented as available features.

Validate with a local static server and Chromium, then deploy separately from the
ACE control plane:

```sh
python3 -m http.server 8790 --bind 127.0.0.1 --directory website/public
npx wrangler deploy --config website/wrangler.jsonc
```

Cloudflare serves static assets; this deployment has no evaluator, AI, container,
database or session bindings. The HTML and deployment configuration are tracked
so future changes can be reviewed and reproduced. Do not place secrets here.
