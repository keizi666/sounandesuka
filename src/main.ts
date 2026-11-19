// プレイヤーのエントリポイント（index.html）
import './style.css';
import { startApp } from './app/App';
import { installProblemReporter } from './app/problem';

installProblemReporter();

const root = document.querySelector<HTMLDivElement>('#app');
if (root) startApp(root);
