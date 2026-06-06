import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, TooltipProvider } from '@byte-v-forge/common-ui';
import { WaPage } from './dashboard/wa-page';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="system" storageKey="byte-v-forge-wa-theme">
      <TooltipProvider>
        <main className="min-h-screen bg-background text-foreground">
          <WaPage />
        </main>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);
