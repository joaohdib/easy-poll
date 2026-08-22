import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './styles/history.css';
import './styles/stats.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz do EasyPoll não encontrado.');
createRoot(root).render(<App />);
