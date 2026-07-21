import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// GitHub Pages serves a project repo from /<repo>/, Vercel serves from /.
// DOCS_BASE lets the same build target both without editing this file:
//   GitHub Pages → DOCS_BASE=/Fix-Spotify/   (set in the workflow)
//   Vercel       → unset, defaults to /
const base = process.env.DOCS_BASE || '/';

export default withMermaid(
  defineConfig({
    base,
    lang: 'en-US',
    title: 'Fix_Spotify',
    description:
      'One music library, three sources, no account. Windows and Android — search, stream and download from JioSaavn, SoundCloud and YouTube.',
    cleanUrls: true,

    // No "Last updated" stamp. It reads as staleness rather than freshness: a
    // page that is simply still correct looks abandoned next to one touched by
    // an unrelated typo fix, and the date says nothing about either.
    lastUpdated: false,

    head: [
      ['link', { rel: 'icon', type: 'image/png', href: `${base}logo.png` }],
      ['meta', { name: 'theme-color', content: '#1DB954' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'Fix_Spotify — Documentation' }],
      [
        'meta',
        {
          property: 'og:description',
          content: 'Three sources, one library, no account. Windows and Android.',
        },
      ],
    ],

    themeConfig: {
      logo: '/logo.png',
      siteTitle: 'Fix_Spotify',

      // MiniSearch, bundled with VitePress — indexes every heading and paragraph
      // at build time and ships as a static index, so search keeps working on
      // GitHub Pages with no server and no API key.
      search: {
        provider: 'local',
        options: {
          detailedView: true,
          miniSearch: {
            searchOptions: {
              fuzzy: 0.2,
              prefix: true,
              boost: { title: 4, titles: 2, text: 1 },
            },
          },
        },
      },

      nav: [
        { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
        { text: 'Reference', link: '/reference/settings', activeMatch: '/reference/' },
        { text: 'Releases', link: '/releases', activeMatch: '/releases' },
        {
          text: 'Download',
          link: 'https://github.com/AshirwadRai/Fix-Spotify/releases/latest',
        },
      ],

      sidebar: {
        '/': [
          {
            text: 'Getting Started',
            items: [
              { text: 'Introduction', link: '/guide/introduction' },
              { text: 'Installation', link: '/guide/installation' },
              { text: 'Quick Start', link: '/guide/quick-start' },
            ],
          },
          {
            text: 'Core Features',
            items: [
              { text: 'Finding Music', link: '/guide/finding-music' },
              { text: 'The Player', link: '/guide/player' },
              { text: 'Equalizer', link: '/guide/equalizer' },
              { text: 'Lyrics', link: '/guide/lyrics' },
              { text: 'Spotify Import', link: '/guide/spotify-import' },
              { text: 'Your Library', link: '/guide/library' },
              { text: 'Downloads & Offline', link: '/guide/downloads' },
            ],
          },
          {
            text: 'Reference',
            items: [
              { text: 'Settings', link: '/reference/settings' },
              { text: 'Sound & Quality', link: '/reference/sound' },
              { text: 'How It Works', link: '/reference/architecture' },
              { text: 'Troubleshooting', link: '/reference/troubleshooting' },
            ],
          },
          {
            text: 'Project',
            items: [
              { text: 'Releases', link: '/releases' },
              { text: 'Fair Use', link: '/fair-use' },
            ],
          },
        ],
      },

      socialLinks: [
        { icon: 'github', link: 'https://github.com/AshirwadRai/Fix-Spotify' },
      ],

      editLink: {
        pattern:
          'https://github.com/AshirwadRai/Fix-Spotify/edit/main/docs/:path',
        text: 'Improve this page on GitHub',
      },

      footer: {
        message:
          'For educational and personal use. Support the artists you love — buy their music.',
        copyright: 'GPL v3 · Built with VitePress',
      },

      outline: { level: [2, 3], label: 'On this page' },
      docFooter: { prev: 'Previous', next: 'Next' },
    },

    // Mermaid sizes each node by measuring its label, so it MUST be told the
    // same font the page actually renders in. Left at its default it measures
    // in one face and paints in another, undersizes the box, and clips the last
    // line of every three-line node — which is what ate "downloads",
    // "(Tauri + WebView2)" and "127.0.0.1:8765" in the architecture diagrams.
    mermaid: {
      theme: 'base',
      fontFamily: 'Montserrat, ui-sans-serif, system-ui, sans-serif',
      themeVariables: {
        fontFamily: 'Montserrat, ui-sans-serif, system-ui, sans-serif',
        fontSize: '14px',
      },
      flowchart: { padding: 14, nodeSpacing: 40, rankSpacing: 56, useMaxWidth: true },
    },
  })
);
