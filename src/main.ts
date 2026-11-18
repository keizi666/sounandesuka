// プレイヤーのエントリポイント（index.html）
import './style.css';
import { startApp } from './app/App';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) startApp(root);
