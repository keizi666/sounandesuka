/** タブの並び（docs/15 §2: 作業の順番どおり） */
import type { Panel } from './types';
import { areaPanel } from './area';
import { environmentPanel } from './environment';
import { pointsPanel } from './points';
import { trailsPanel } from './trails';
import { weatherPanel } from './weather';
import { partyPanel } from './party';
import { choicesPanel } from './choices';
import { endingsPanel } from './endings';
import { testPanel } from './test';
import { jsonPanel } from './json';
import { aiPanel } from './ai';

export const PANELS: Panel[] = [
  areaPanel,
  trailsPanel,
  pointsPanel,
  environmentPanel,
  weatherPanel,
  partyPanel,
  choicesPanel,
  endingsPanel,
  testPanel,
  jsonPanel,
  aiPanel,
];
