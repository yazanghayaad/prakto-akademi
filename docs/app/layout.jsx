import { Layout } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import '../styles.css'
import CustomNavbar from '../components/Navbar/Navbar'
import CustomFooter from '../components/Footer/Footer'
import PostHogProvider from '../components/Analytics/PostHogProvider'

export const metadata = {
  title: {
    default: 'Prakto Akademi – Dokumentation',
    template: '%s – Prakto Akademi',
  },
  description:
    'Hjälp och guider för Prakto Akademi: kom igång, ta kurser, skapa kurser och lärvägar, uppgifter, AI-stöd och administration.',
  keywords: ['Prakto', 'Prakto Akademi', 'praktik', 'utbildning', 'dokumentation', 'hjälp'],
  metadataBase: new URL('https://prakto.se/docs/'),
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    locale: 'sv_SE',
    url: 'https://prakto.se/docs',
    siteName: 'Prakto Akademi – Dokumentation',
    description:
      'Hjälp och guider för Prakto Akademi: kom igång, ta kurser, skapa kurser och lärvägar, uppgifter, AI-stöd och administration.',
    images: [
      {
        url: 'https://prakto.se/docs/img/pages/prakto-academy.png',
        alt: 'Prakto Akademi',
        width: 1920,
        height: 1080,
      },
    ],
  },
  icons: {
    icon: [{ url: '/docs/favicons/favicon.png', type: 'image/png' }],
    apple: '/docs/favicons/apple-touch-icon.png',
  },
  manifest: '/docs/favicons/site.webmanifest',
}

export default async function RootLayout({ children }) {
  return (
    <html lang="sv" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Same faces as the academy itself: Source Sans 3 for text, Source Serif 4 for headings. */}
        <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400..700;1,400..700&family=Source+Serif+4:opsz,wght@8..60,500..700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <PostHogProvider>
          <CustomNavbar />
          <Layout
            pageMap={await getPageMap()}
            sidebar={{ defaultMenuCollapseLevel: 2 }}
            editLink={null}
            footer={<></>}
            navbar={<></>}
            nextThemes={{ forcedTheme: 'light', defaultTheme: 'light' }}
          >
            {children}
          </Layout>
          <CustomFooter />
        </PostHogProvider>
      </body>
    </html>
  )
}
