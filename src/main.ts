// プレイヤーのエントリポイント（index.html）
import './style.css';
import { startApp } from './app/App';
import { installProblemReporter } from './app/problem';
import { logStartup } from './app/version';

installProblemReporter();
logStartup('player');

const root = document.querySelector<HTMLDivElement>('#app');
if (root) startApp(root);
