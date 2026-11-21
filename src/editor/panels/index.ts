/** タブの並び（docs/15 §2: 作業の順番どおり） */
import type { Panel } from './types';
import { areaPanel } from './area';
import { environmentPanel } from './environment';
import { trailsPanel } from './trails';
import { weatherPanel } from './weather';
import { partyPanel } from './party';
import { storyPanel } from './story';
import { testPanel } from './test';
import { jsonPanel } from './json';
import { aiPanel } from './ai';

export const PANELS: Panel[] = [
  areaPanel,
  trailsPanel,
  environmentPanel,
  weatherPanel,
  partyPanel,
  storyPanel,
  testPanel,
  jsonPanel,
  aiPanel,
];
