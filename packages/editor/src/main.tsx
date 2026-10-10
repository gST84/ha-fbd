import { createRoot } from 'react-dom/client';
import Root from './Root';
import { initTheme } from './theme';
import './styles.css';

initTheme();

createRoot(document.getElementById('root')!).render(<Root />);
