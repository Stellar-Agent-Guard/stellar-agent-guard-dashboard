import type { Metadata, Viewport } from "next";
import { LayoutShell } from "../components/LayoutShell.tsx";

export const metadata: Metadata = {
  title: "Stellar Agent Guard — operator console",
  description:
    "Configure, watch and freeze stellar-agent-guard smart accounts. Every action is signed in your own wallet and every number is read from the chain.",
  // Ties the document to the web app manifest, which is what makes the page
  // installable as a standalone app on supported browsers.
  manifest: "/manifest.json",
  applicationName: "Stellar Agent Guard",
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    title: "Agent Guard",
    statusBarStyle: "black-translucent",
  },
};

/**
 * `themeColor` lives in the viewport export rather than `metadata` in this
 * version of Next: the browser chrome tint is a viewport concern, and declaring
 * it there is what keeps the installed app's title bar the same dark as the
 * manifest's `theme_color`.
 */
export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var saved = localStorage.getItem('theme');
                if (saved) {
                  document.documentElement.setAttribute('data-theme', saved);
                } else {
                  var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
                  document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark');
                }
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}