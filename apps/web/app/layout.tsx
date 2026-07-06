import '@afk/component/theme';
import './globals.css';

import { AppProviders } from '@/components/app-providers';

export const metadata = {
  title: 'Open-Agent',
  description:
    'Open-source alternative to Claude Agent SDK, ChatGPT Agents, and Manus.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
