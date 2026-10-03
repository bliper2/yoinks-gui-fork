'use strict'

// Turns CHANGELOG.md into docs/changelog.html, the page GitHub Pages serves
// next to the landing page. The changelog only uses "## version" headings and
// "- item" bullets, so this is a small purpose-built converter.

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

function render(markdown) {
  const releases = []
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) releases.push({ version: heading[1].trim(), items: [] })
    else if (releases.length && /^- /.test(line)) releases[releases.length - 1].items.push(line.slice(2).trim())
  }
  const sections = releases
    .map(
      ({ version, items }, index) => `    <section class="release" id="v${escape(version)}">
      <h2>${escape(version)}${index === 0 ? ' <span class="latest">Latest</span>' : ''}</h2>
      <ul>
${items.map(item => `        <li>${inline(item)}</li>`).join('\n')}
      </ul>
    </section>`,
    )
    .join('\n')

  return `<!doctype html>
<!-- Generated from CHANGELOG.md by "npm run sync". Do not edit by hand. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yoinks changelog</title>
<meta name="description" content="What changed in each version of Yoinks.">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<style>
  :root { --bg: #f6f7fb; --card: #ffffff; --text: #141925; --muted: #525c70; --border: rgba(15, 23, 42, .12); --accent: #8b6bff; --accent2: #22d3ee; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1015; --card: #161920; --text: #e8edf4; --muted: #9aa3b5; --border: rgba(255, 255, 255, .1); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
  a { color: inherit; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 20px 60px; }
  header { padding: 18px 0; display: flex; align-items: center; gap: 12px; }
  header img { width: 36px; height: 36px; }
  header strong { font-size: 20px; }
  header nav { margin-left: auto; display: flex; gap: 18px; font-size: 14px; color: var(--muted); }
  header nav a { text-decoration: none; }
  header nav a:hover { color: var(--text); }
  h1 { font-size: clamp(28px, 5vw, 40px); margin: 24px 0 6px; letter-spacing: -.02em; }
  .lead { color: var(--muted); margin: 0 0 24px; }
  .release { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 18px 22px; margin-bottom: 14px; }
  .release h2 { margin: 0 0 8px; font-size: 22px; }
  .latest { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; color: #fff; background: linear-gradient(120deg, var(--accent), var(--accent2)); vertical-align: middle; }
  .release ul { margin: 0; padding-left: 20px; }
  .release li { margin: 6px 0; }
  code { background: rgba(127, 127, 127, .15); padding: 1px 5px; border-radius: 5px; font-size: .92em; }
  footer { color: var(--muted); font-size: 14px; text-align: center; padding-top: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="logo.svg" alt="">
    <strong>Yoinks</strong>
    <nav>
      <a href="./">Home</a>
      <a href="https://github.com/bliper2/yoinks-gui-fork/releases/latest">Download</a>
      <a href="https://github.com/bliper2/yoinks-gui-fork">GitHub</a>
      <a href="https://discord.gg/yEF99JeG9b">Discord</a>
    </nav>
  </header>
  <main>
    <h1>Changelog</h1>
    <p class="lead">What changed in each version of Yoinks.</p>
${sections}
  </main>
  <footer>Also posted in the <a href="https://discord.gg/yEF99JeG9b">Discord</a> and on each <a href="https://github.com/bliper2/yoinks-gui-fork/releases">GitHub release</a>.</footer>
</div>
</body>
</html>
`
}

module.exports = { render }
