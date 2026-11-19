// シナリオエディターのエントリポイント（editor.html、docs/15）
import '../style.css';
import './editor.css';
import { installProblemReporter } from '../app/problem';
import { logStartup } from '../app/version';
import { JA } from '../i18n/ja';
import { EditorApp } from './EditorApp';
import { showProjects, type ProjectsHost } from './projects';
import { getProject } from './store/idb';

installProblemReporter();
logStartup('editor');

const root = document.querySelector<HTMLDivElement>('#app');
let current: EditorApp | null = null;

if (root) {
  document.title = JA.editor.title;
  root.className = 'editor-root';
  const host: ProjectsHost = {
    root,
    open(id) {
      void getProject(id).then((p) => {
        if (!p) return void showProjects(host);
        history.replaceState(null, '', `?project=${encodeURIComponent(id)}`);
        current?.dispose();
        current = new EditorApp(root, p, () => {
          current?.dispose();
          current = null;
          history.replaceState(null, '', location.pathname);
          void showProjects(host);
        });
        // 開発時のデバッグ用
        if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)['__ed'] = current;
      });
    },
  };
  const id = new URLSearchParams(location.search).get('project');
  if (id) host.open(id);
  else void showProjects(host);
}
