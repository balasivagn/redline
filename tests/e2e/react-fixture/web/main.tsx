import { StrictMode, Suspense, createContext } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginPage } from './src/pages/LoginPage';

const ThemeContext = createContext('light');

function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext value="light">{children}</ThemeContext>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Suspense fallback={null}>
        <LoginPage />
      </Suspense>
    </ThemeProvider>
  </StrictMode>,
);
