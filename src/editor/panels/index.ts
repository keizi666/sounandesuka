/** タブの並び（docs/15 §2: 作業の順番どおり） */
import { el } from '../../ui/dom';
import type { Panel } from './types';
import { areaPanel } from './area';
import { environmentPanel } from './environment';
import { pointsPanel } from './points';
import { trailsPanel } from './trails';

function todo(id: Panel['id'], label: string): Panel {
  return {
    id,
    label,
    render(ed) {
      ed.inspector.replaceChildren(el('h2', {}, label), el('p', { class: 'note' }, '準備中'));
      ed.bottom.replaceChildren();
    },
  };
}

export const PANELS: Panel[] = [
  areaPanel,
  trailsPanel,
  pointsPanel,
  environmentPanel,
  todo('weather', '天候'),
  todo('party', '人と計画'),
  todo('choices', '分岐点'),
  todo('endings', '結末'),
  todo('test', '試走'),
  todo('json', 'JSON'),
];
